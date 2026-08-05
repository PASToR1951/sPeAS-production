import { client } from "../db/denopost_conn.ts";

export async function ensureAuthorNotificationTablesExist() {
  const migration = await Deno.readTextFile(new URL("../db/migrations/2026-08_author_profile_notifications.sql", import.meta.url));
  await client.queryArray(migration);
}

export async function ensureIncompleteAuthorNotifications() {
  await client.queryArray(`
    INSERT INTO admin_notifications (
      notification_type, entity_type, entity_id, severity, title, message, action_path
    )
    SELECT
      'author_profile_incomplete', 'author', a.id::text, 'urgent',
      'Complete author profile',
      a.full_name || ' is missing directory information.',
      '/admin/Components/author-list.html?author=' || a.id::text || '&action=complete'
    FROM authors a
    WHERE NOT (
      (NULLIF(BTRIM(a.department), '') IS NOT NULL OR NULLIF(BTRIM(a.affiliation), '') IS NOT NULL)
    )
    ON CONFLICT (notification_type, entity_type, entity_id) DO UPDATE
      SET title = EXCLUDED.title,
          message = EXCLUDED.message,
          action_path = EXCLUDED.action_path,
          is_read = CASE WHEN admin_notifications.resolved_at IS NOT NULL THEN FALSE ELSE admin_notifications.is_read END,
          updated_at = CURRENT_TIMESTAMP,
          dismissed_at = CASE WHEN admin_notifications.resolved_at IS NOT NULL THEN NULL ELSE admin_notifications.dismissed_at END,
          resolved_at = NULL;
  `);

  // Reconcile notifications created under the former identifier/contact rule.
  // Department or affiliation is now the only completion criterion.
  await client.queryArray(`
    UPDATE admin_notifications n
    SET resolved_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    FROM authors a
    WHERE n.notification_type = 'author_profile_incomplete'
      AND n.entity_type = 'author'
      AND n.entity_id = a.id::text
      AND n.resolved_at IS NULL
      AND (NULLIF(BTRIM(a.department), '') IS NOT NULL OR NULLIF(BTRIM(a.affiliation), '') IS NOT NULL)
  `);
}

export async function createIncompleteAuthorNotification(authorId: string, fullName: string) {
  await client.queryArray(`
    INSERT INTO admin_notifications (
      notification_type, entity_type, entity_id, severity, title, message, action_path
    ) VALUES (
      'author_profile_incomplete', 'author', $1, 'urgent',
      'Complete author profile', $2,
      '/admin/Components/author-list.html?author=' || $1 || '&action=complete'
    )
    ON CONFLICT (notification_type, entity_type, entity_id) DO UPDATE
      SET message = EXCLUDED.message,
          is_read = CASE WHEN admin_notifications.resolved_at IS NOT NULL THEN FALSE ELSE admin_notifications.is_read END,
          dismissed_at = CASE WHEN admin_notifications.resolved_at IS NOT NULL THEN NULL ELSE admin_notifications.dismissed_at END,
          resolved_at = NULL,
          updated_at = CURRENT_TIMESTAMP
  `, [authorId, `${fullName} is missing directory information.`]);
}

export async function syncAuthorProfileNotification(authorId: string, fullName: string, profileComplete: boolean) {
  if (profileComplete) {
    await client.queryArray(`
      UPDATE admin_notifications
      SET resolved_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE notification_type = 'author_profile_incomplete' AND entity_type = 'author' AND entity_id = $1
    `, [authorId]);
    return;
  }
  await createIncompleteAuthorNotification(authorId, fullName);
}

export async function syncAdminActionNotifications() {
  await ensureIncompleteAuthorNotifications();

  await syncPendingSource({
    insertSql: `
      SELECT 'document_review_pending', 'document', d.id::text, 'warning',
             'Review uploaded document', d.title || ' is waiting for administrator review.',
             '/admin/Components/documents_list.html?status=pending_review'
      FROM documents d
      WHERE d.deleted_at IS NULL AND d.compiled_parent_id IS NULL AND d.review_status = 'pending_review'
    `,
    notificationType: "document_review_pending",
    activeSql: `SELECT 1 FROM documents d WHERE d.id::text = n.entity_id AND d.deleted_at IS NULL AND d.compiled_parent_id IS NULL AND d.review_status = 'pending_review'`,
  });

  await syncPendingSource({
    insertSql: `
      SELECT 'compilation_review_pending', 'compiled_document', cd.id::text, 'warning',
             'Review uploaded publication', COALESCE(NULLIF(BTRIM(cd.category), ''), 'A compiled publication') || ' is waiting for administrator review.',
             '/admin/Components/documents_list.html?status=pending_review'
      FROM compiled_documents cd
      WHERE cd.deleted_at IS NULL AND cd.review_status = 'pending_review'
    `,
    notificationType: "compilation_review_pending",
    activeSql: `SELECT 1 FROM compiled_documents cd WHERE cd.id::text = n.entity_id AND cd.deleted_at IS NULL AND cd.review_status = 'pending_review'`,
  });

  await syncPendingSource({
    insertSql: `
      SELECT 'abstract_review_pending', 'document', d.id::text, 'warning',
             'Review extracted abstract', d.title || ' has an abstract extraction awaiting resolution.',
             '/admin/Components/documents_list.html?status=pending_review'
      FROM documents d
      WHERE d.deleted_at IS NULL AND d.compiled_parent_id IS NULL AND d.review_status = 'pending_review'
        AND EXISTS (
          SELECT 1 FROM abstract_extraction_jobs j
          WHERE j.document_id = d.id AND j.is_current IS TRUE
            AND j.status NOT IN ('accepted', 'unavailable', 'superseded')
        )
      UNION ALL
      SELECT 'abstract_review_pending', 'compiled_document', cd.id::text, 'warning',
             'Review publication abstracts', COALESCE(NULLIF(BTRIM(cd.category), ''), 'This publication') || ' has abstracts awaiting resolution.',
             '/admin/Components/documents_list.html?status=pending_review'
      FROM compiled_documents cd
      WHERE cd.deleted_at IS NULL AND cd.review_status = 'pending_review'
        AND (
          EXISTS (
            SELECT 1 FROM abstract_extraction_jobs j
            WHERE j.compiled_document_id = cd.id AND j.is_current IS TRUE
              AND j.status NOT IN ('accepted', 'unavailable', 'superseded')
          )
          OR EXISTS (
            SELECT 1 FROM documents d
            JOIN abstract_extraction_jobs j ON j.document_id = d.id AND j.is_current IS TRUE
            WHERE d.compiled_parent_id = cd.id AND d.deleted_at IS NULL
              AND j.status NOT IN ('accepted', 'unavailable', 'superseded')
          )
        )
    `,
    notificationType: "abstract_review_pending",
    activeSql: `SELECT 1 FROM (
      SELECT d.id::text AS target_id
      FROM documents d
      JOIN abstract_extraction_jobs j ON j.document_id = d.id AND j.is_current IS TRUE
      WHERE d.id::text = n.entity_id AND d.deleted_at IS NULL AND d.compiled_parent_id IS NULL
        AND d.review_status = 'pending_review'
        AND j.status NOT IN ('accepted', 'unavailable', 'superseded')
      UNION ALL
      SELECT cd.id::text
      FROM compiled_documents cd
      WHERE cd.id::text = n.entity_id AND cd.deleted_at IS NULL AND cd.review_status = 'pending_review'
        AND (
          EXISTS (SELECT 1 FROM abstract_extraction_jobs j WHERE j.compiled_document_id = cd.id AND j.is_current IS TRUE AND j.status NOT IN ('accepted', 'unavailable', 'superseded'))
          OR EXISTS (SELECT 1 FROM documents d JOIN abstract_extraction_jobs j ON j.document_id = d.id AND j.is_current IS TRUE WHERE d.compiled_parent_id = cd.id AND d.deleted_at IS NULL AND j.status NOT IN ('accepted', 'unavailable', 'superseded'))
        )
    ) pending WHERE pending.target_id = n.entity_id`,
  });

  await syncPendingSource({
    insertSql: `
      SELECT 'document_access_request_pending', 'document_request', dr.id::text, 'warning',
             'Review document access request', dr.full_name || ' requested access to a repository document.',
             '/admin/Components/document-permissions.html?status=pending'
      FROM document_requests dr WHERE dr.status = 'pending'
    `,
    notificationType: "document_access_request_pending",
    activeSql: `SELECT 1 FROM document_requests dr WHERE dr.id::text = n.entity_id AND dr.status = 'pending'`,
  });

  await syncPendingSource({
    insertSql: `
      SELECT 'contact_inquiry_new', 'contact_inquiry', i.id::text, 'info',
             'New contact inquiry', i.subject || ' — ' || i.first_name || ' ' || i.last_name,
             '/admin/Components/contact-inquiries.html?status=new'
      FROM contact_inquiries i WHERE i.status = 'new'
    `,
    notificationType: "contact_inquiry_new",
    activeSql: `SELECT 1 FROM contact_inquiries i WHERE i.id::text = n.entity_id AND i.status = 'new'`,
  });

  await syncPendingSource({
    insertSql: `
      SELECT 'contact_delivery_failed', 'contact_inquiry', i.id::text, 'urgent',
             'Contact notification failed', 'Email delivery failed for ' || i.reference_code || '.',
             '/admin/Components/contact-inquiries.html'
      FROM contact_inquiries i WHERE i.notification_status = 'failed'
    `,
    notificationType: "contact_delivery_failed",
    activeSql: `SELECT 1 FROM contact_inquiries i WHERE i.id::text = n.entity_id AND i.notification_status = 'failed'`,
  });

  await syncPendingSource({
    insertSql: `
      SELECT 'topic_proposal_pending', 'topic', t.id::text, 'warning',
             'Review proposed topic', t.name || ' is waiting for approval.',
             '/admin/Components/classification-management.html?topicStatus=pending'
      FROM topics t WHERE t.status = 'pending'
    `,
    notificationType: "topic_proposal_pending",
    activeSql: `SELECT 1 FROM topics t WHERE t.id::text = n.entity_id AND t.status = 'pending'`,
  });

  await syncPendingSource({
    insertSql: `
      SELECT 'classification_migration_pending', 'classification_review',
             r.document_id::text || ':' || r.legacy_research_agenda_id::text, 'warning',
             'Review legacy classification', r.legacy_value || ' needs a classification decision.',
             '/admin/Components/classification-management.html#migration-review'
      FROM classification_migration_review r WHERE r.status = 'pending'
    `,
    notificationType: "classification_migration_pending",
    activeSql: `SELECT 1 FROM classification_migration_review r WHERE r.document_id::text || ':' || r.legacy_research_agenda_id::text = n.entity_id AND r.status = 'pending'`,
  });

  await syncContactRecipientConfiguration();
}

async function syncPendingSource({ insertSql, notificationType, activeSql }: { insertSql: string; notificationType: string; activeSql: string }) {
  await client.queryArray(`
    INSERT INTO admin_notifications (
      notification_type, entity_type, entity_id, severity, title, message, action_path
    )
    ${insertSql}
    ON CONFLICT (notification_type, entity_type, entity_id) DO UPDATE
      SET severity = EXCLUDED.severity,
          title = EXCLUDED.title,
          message = EXCLUDED.message,
          action_path = EXCLUDED.action_path,
          is_read = CASE WHEN admin_notifications.resolved_at IS NOT NULL THEN FALSE ELSE admin_notifications.is_read END,
          dismissed_at = CASE WHEN admin_notifications.resolved_at IS NOT NULL THEN NULL ELSE admin_notifications.dismissed_at END,
          resolved_at = NULL,
          updated_at = CURRENT_TIMESTAMP;
  `);
  await client.queryArray(`
    UPDATE admin_notifications n
    SET resolved_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE n.notification_type = $1 AND n.resolved_at IS NULL
      AND NOT EXISTS (${activeSql})
  `, [notificationType]);
}

async function syncContactRecipientConfiguration() {
  const recipient = Deno.env.get("CONTACT_RECIPIENT_EMAIL")?.trim() ?? "";
  const configured = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient);
  const type = "contact_recipient_not_configured";
  if (configured) {
    await client.queryArray(`
      UPDATE admin_notifications SET resolved_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE notification_type = $1 AND resolved_at IS NULL
    `, [type]);
    return;
  }
  await client.queryArray(`
    INSERT INTO admin_notifications (
      notification_type, entity_type, entity_id, severity, title, message, action_path
    ) VALUES (
      $1, 'system_configuration', 'contact-recipient-email', 'urgent',
      'Configure contact email notifications',
      'Contact inquiries are stored, but administrator email delivery is paused.',
      '/admin/Components/contact-inquiries.html'
    )
    ON CONFLICT (notification_type, entity_type, entity_id) DO UPDATE
      SET is_read = CASE WHEN admin_notifications.resolved_at IS NOT NULL THEN FALSE ELSE admin_notifications.is_read END,
          dismissed_at = CASE WHEN admin_notifications.resolved_at IS NOT NULL THEN NULL ELSE admin_notifications.dismissed_at END,
          resolved_at = NULL,
          updated_at = CURRENT_TIMESTAMP
  `, [type]);
}

export async function listAdminNotifications() {
  const result = await client.queryObject<{
    id: number | bigint; notification_type: string; entity_type: string; entity_id: string;
    severity: string; title: string; message: string; action_path: string | null;
    is_read: boolean; resolved_at: Date | string | null; created_at: Date | string;
  }>(`
    SELECT id, notification_type, entity_type, entity_id, severity, title, message,
           action_path, is_read, resolved_at, created_at
    FROM admin_notifications
    WHERE resolved_at IS NULL AND dismissed_at IS NULL
    ORDER BY CASE severity WHEN 'urgent' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
             is_read ASC, created_at DESC, id DESC
    LIMIT 50
  `);
  return result.rows.map((row) => ({
    id: Number(row.id), type: row.notification_type, entityType: row.entity_type,
    entityId: row.entity_id, severity: row.severity, title: row.title, message: row.message,
    actionPath: row.action_path, isRead: row.is_read, resolved: false,
    createdAt: new Date(row.created_at).toISOString(),
  }));
}

export async function getAdminNotificationSummary() {
  const result = await client.queryObject<{ total: number | bigint; unread: number | bigint; urgent: number | bigint }>(`
    SELECT COUNT(*) AS total,
           COUNT(*) FILTER (WHERE NOT is_read) AS unread,
           COUNT(*) FILTER (WHERE severity = 'urgent') AS urgent
    FROM admin_notifications
    WHERE resolved_at IS NULL AND dismissed_at IS NULL
  `);
  const row = result.rows[0];
  return { total: Number(row?.total ?? 0), unread: Number(row?.unread ?? 0), urgent: Number(row?.urgent ?? 0) };
}

export async function markAdminNotificationRead(id: number) {
  const result = await client.queryObject<{ id: number | bigint }>(`
    UPDATE admin_notifications SET is_read = TRUE, updated_at = CURRENT_TIMESTAMP
    WHERE id = $1 AND resolved_at IS NULL AND dismissed_at IS NULL RETURNING id
  `, [id]);
  return Boolean(result.rows[0]);
}

export async function clearAdminNotifications() {
  const result = await client.queryObject<{ id: number | bigint }>(`
    UPDATE admin_notifications
    SET dismissed_at = CURRENT_TIMESTAMP, is_read = TRUE, updated_at = CURRENT_TIMESTAMP
    WHERE resolved_at IS NULL AND dismissed_at IS NULL
    RETURNING id
  `);
  return result.rows.length;
}
