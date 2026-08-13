import { client, withTransaction } from "../db/denopost_conn.ts";
import { sendContactInquiryEmail } from "./emailService.ts";
import { contactNotificationRetryDecision, generateContactReferenceCode, isContactStatusTransitionAllowed, type ContactInquiryInput } from "../shared/contactInquiry.ts";

export type ContactInquiryStatus = "new" | "read" | "resolved" | "spam";
export type ContactNotificationStatus = "pending" | "processing" | "sent" | "failed";

interface InquiryRow {
  id: number | bigint;
  reference_code: string;
  first_name: string;
  last_name: string;
  email: string;
  subject: string;
  message: string;
  status: ContactInquiryStatus;
  notification_status: ContactNotificationStatus;
  created_at: Date | string;
  updated_at: Date | string;
  resolved_at: Date | string | null;
  first_read_at: Date | string | null;
  total_count?: number | bigint;
}

interface JobRow extends InquiryRow {
  job_id: number | bigint;
  attempt_count: number;
}

const SELECT_FIELDS = `
  id, reference_code, first_name, last_name, email, subject, message,
  status, notification_status, created_at, updated_at, resolved_at, first_read_at
`;

export class ContactStatusTransitionError extends Error {}

export async function ensureContactInquiryTablesExist() {
  const migration = await Deno.readTextFile(new URL("../db/migrations/2026-07_contact_inquiries.sql", import.meta.url));
  await client.queryArray(migration);
}

export async function createContactInquiry(input: ContactInquiryInput) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const referenceCode = generateContactReferenceCode();
    try {
      return await withTransaction(async (connection) => {
        const inquiry = await connection.queryObject<{ id: number | bigint }>(`
          INSERT INTO contact_inquiries (
            reference_code, first_name, last_name, email, subject, message
          ) VALUES ($1, $2, $3, $4, $5, $6)
          RETURNING id
        `, [referenceCode, input.firstName, input.lastName, input.email, input.subject, input.message]);
        const inquiryId = inquiry.rows[0].id;
        await connection.queryArray(`
          INSERT INTO contact_notification_jobs (inquiry_id) VALUES ($1)
        `, [inquiryId]);
        return { referenceCode, status: "received" as const };
      });
    } catch (error) {
      if (!isUniqueViolation(error) || attempt === 3) throw error;
    }
  }
  throw new Error("Unable to allocate inquiry reference");
}

export async function listContactInquiries(options: {
  page: number;
  size: number;
  status?: ContactInquiryStatus;
  search?: string;
  sort: "newest" | "oldest";
}) {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (options.status) {
    params.push(options.status);
    clauses.push(`status = $${params.length}`);
  }
  if (options.search) {
    params.push(`%${options.search}%`);
    clauses.push(`(reference_code ILIKE $${params.length} OR subject ILIKE $${params.length} OR email ILIKE $${params.length})`);
  }
  params.push(options.size, (options.page - 1) * options.size);
  const result = await client.queryObject<InquiryRow>(`
    SELECT ${SELECT_FIELDS}, COUNT(*) OVER() AS total_count
    FROM contact_inquiries
    ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
    ORDER BY created_at ${options.sort === "oldest" ? "ASC" : "DESC"}, id ${options.sort === "oldest" ? "ASC" : "DESC"}
    LIMIT $${params.length - 1} OFFSET $${params.length}
  `, params);
  return {
    inquiries: result.rows.map(mapInquiry),
    totalCount: result.rows.length ? Number(result.rows[0].total_count ?? 0) : 0,
  };
}

export async function getContactInquiry(referenceCode: string) {
  const result = await client.queryObject<InquiryRow>(`
    SELECT ${SELECT_FIELDS} FROM contact_inquiries WHERE reference_code = $1 LIMIT 1
  `, [referenceCode]);
  return result.rows[0] ? mapInquiry(result.rows[0]) : null;
}

export async function updateContactInquiryStatus(referenceCode: string, status: ContactInquiryStatus, administratorId: string) {
  return await withTransaction(async (connection) => {
    const current = await connection.queryObject<{ id: number | bigint; status: ContactInquiryStatus }>(`
      SELECT id, status FROM contact_inquiries WHERE reference_code = $1 FOR UPDATE
    `, [referenceCode]);
    if (!current.rows[0]) return null;
    const previous = current.rows[0].status;
    if (previous === status) return await getContactInquiry(referenceCode);
    if (!isContactStatusTransitionAllowed(previous, status)) {
      throw new ContactStatusTransitionError(`Cannot move an inquiry from ${previous} to ${status}`);
    }
    const updated = await connection.queryObject<InquiryRow>(`
      UPDATE contact_inquiries
      SET status = $2::varchar,
          first_read_at = CASE WHEN $2::varchar = 'read' THEN COALESCE(first_read_at, CURRENT_TIMESTAMP) ELSE first_read_at END,
          resolved_at = CASE WHEN $2::varchar = 'resolved' THEN CURRENT_TIMESTAMP ELSE NULL END,
          updated_at = CURRENT_TIMESTAMP
      WHERE reference_code = $1
      RETURNING ${SELECT_FIELDS}
    `, [referenceCode, status]);
    await connection.queryArray(`
      INSERT INTO contact_inquiry_status_history (
        inquiry_id, administrator_user_id, previous_status, new_status
      ) VALUES ($1, $2, $3, $4)
    `, [current.rows[0].id, administratorId, previous, status]);
    console.info("Contact inquiry status changed", { referenceCode, administratorId, previous, status });
    return mapInquiry(updated.rows[0]);
  });
}

export async function listContactInquiryNotes(referenceCode: string) {
  const result = await client.queryObject<{ id: number | bigint; administrator_user_id: string; note: string; created_at: Date | string }>(`
    SELECT n.id, n.administrator_user_id, n.note, n.created_at
    FROM contact_inquiry_notes n
    JOIN contact_inquiries i ON i.id = n.inquiry_id
    WHERE i.reference_code = $1
    ORDER BY n.created_at ASC, n.id ASC
  `, [referenceCode]);
  return result.rows.map((row) => ({
    id: Number(row.id), administratorUserId: row.administrator_user_id, note: row.note,
    createdAt: toIso(row.created_at),
  }));
}

export async function addContactInquiryNote(referenceCode: string, administratorId: string, note: string) {
  const result = await client.queryObject<{ id: number | bigint; administrator_user_id: string; note: string; created_at: Date | string }>(`
    INSERT INTO contact_inquiry_notes (inquiry_id, administrator_user_id, note)
    SELECT id, $2, $3 FROM contact_inquiries WHERE reference_code = $1
    RETURNING id, administrator_user_id, note, created_at
  `, [referenceCode, administratorId, note]);
  const row = result.rows[0];
  return row ? { id: Number(row.id), administratorUserId: row.administrator_user_id, note: row.note, createdAt: toIso(row.created_at) } : null;
}

export async function getContactInquirySummary() {
  const counts = await client.queryObject<{ status: ContactInquiryStatus; count: number | bigint }>(`
    SELECT status, COUNT(*) AS count FROM contact_inquiries GROUP BY status
  `);
  const failed = await client.queryObject<{ count: number | bigint }>(`
    SELECT COUNT(*) AS count FROM contact_notification_jobs WHERE status = 'failed'
  `);
  const byStatus: Record<ContactInquiryStatus, number> = { new: 0, read: 0, resolved: 0, spam: 0 };
  for (const row of counts.rows) byStatus[row.status] = Number(row.count);
  return { byStatus, failedNotifications: Number(failed.rows[0]?.count ?? 0), recipientConfigured: getContactNotificationConfiguration().configured };
}

export function getContactNotificationConfiguration() {
  const recipient = Deno.env.get("CONTACT_RECIPIENT_EMAIL")?.trim() ?? "";
  const configured = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient);
  return {
    configured,
    status: configured ? "ready" : "configuration_required",
    diagnosticCode: configured ? null : "CONTACT_RECIPIENT_EMAIL_NOT_CONFIGURED",
    recipient: configured ? recipient : null,
  } as const;
}

export async function retryContactNotification(referenceCode: string) {
  return await withTransaction(async (connection) => {
    const result = await connection.queryObject<{ id: number | bigint }>(`
      UPDATE contact_notification_jobs j
      SET status = 'pending', attempt_count = 0, next_attempt_at = CURRENT_TIMESTAMP,
          last_error = NULL, processing_started_at = NULL, updated_at = CURRENT_TIMESTAMP
      FROM contact_inquiries i
      WHERE j.inquiry_id = i.id AND i.reference_code = $1 AND j.status = 'failed'
      RETURNING j.id
    `, [referenceCode]);
    if (result.rows.length) {
      await connection.queryArray(`UPDATE contact_inquiries SET notification_status = 'pending', updated_at = CURRENT_TIMESTAMP WHERE reference_code = $1`, [referenceCode]);
    }
    return result.rows.length > 0;
  });
}

export async function recoverStuckContactNotificationJobs() {
  return await withTransaction(async (connection) => {
    const result = await connection.queryObject<{ id: number | bigint; inquiry_id: number | bigint }>(`
      UPDATE contact_notification_jobs
      SET status = 'pending', processing_started_at = NULL, next_attempt_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE status = 'processing' AND processing_started_at < CURRENT_TIMESTAMP - INTERVAL '10 minutes'
      RETURNING id, inquiry_id
    `);
    if (result.rows.length) {
      await connection.queryArray(`
        UPDATE contact_inquiries SET notification_status = 'pending', updated_at = CURRENT_TIMESTAMP
        WHERE id = ANY($1::bigint[])
      `, [result.rows.map((row) => String(row.inquiry_id))]);
    }
    return result.rows.length;
  });
}

export async function processNextContactNotification() {
  const job = await withTransaction(async (connection) => {
    const selected = await connection.queryObject<JobRow>(`
      SELECT j.id AS job_id, j.attempt_count, ${SELECT_FIELDS.split(",").map((field) => `i.${field.trim()}`).join(", ")}
      FROM contact_notification_jobs j
      JOIN contact_inquiries i ON i.id = j.inquiry_id
      WHERE j.status = 'pending' AND j.next_attempt_at <= CURRENT_TIMESTAMP
      ORDER BY j.next_attempt_at, j.id
      FOR UPDATE OF j SKIP LOCKED
      LIMIT 1
    `);
    if (!selected.rows[0]) return null;
    const row = selected.rows[0];
    await connection.queryArray(`
      UPDATE contact_notification_jobs
      SET status = 'processing', attempt_count = attempt_count + 1,
          processing_started_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
    `, [row.job_id]);
    await connection.queryArray(`UPDATE contact_inquiries SET notification_status = 'processing' WHERE id = $1`, [row.id]);
    return { ...row, attempt_count: row.attempt_count + 1 };
  });
  if (!job) return false;

  const { recipient } = getContactNotificationConfiguration();
  if (!recipient) {
    await failNotificationJob(job, "CONTACT_RECIPIENT_EMAIL_NOT_CONFIGURED", true);
    return true;
  }

  try {
    await sendContactInquiryEmail({
      recipient,
      referenceCode: job.reference_code,
      visitorEmail: job.email,
      visitorName: `${job.first_name} ${job.last_name}`,
      subject: job.subject,
      message: job.message,
    });
    await client.queryArray(`
      UPDATE contact_notification_jobs SET status = 'sent', sent_at = CURRENT_TIMESTAMP,
        processing_started_at = NULL, last_error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1
    `, [job.job_id]);
    await client.queryArray(`UPDATE contact_inquiries SET notification_status = 'sent', updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [job.id]);
    console.info("Contact notification delivered", { referenceCode: job.reference_code, outcome: "sent" });
  } catch (error) {
    await failNotificationJob(job, sanitizeDeliveryError(error), false);
  }
  return true;
}

export async function startContactNotificationWorker() {
  const { maintenanceRequested } = await import("./maintenanceState.ts");
  const notificationConfiguration = getContactNotificationConfiguration();
  if (!notificationConfiguration.configured) {
    console.warn("Contact email notifications require configuration", {
      diagnosticCode: notificationConfiguration.diagnosticCode,
      environmentVariable: "CONTACT_RECIPIENT_EMAIL",
      inquiryStorage: "available",
      notificationDelivery: "paused",
    });
  }
  await recoverStuckContactNotificationJobs();
  let running = false;
  const run = async () => {
    if (running) return;
    if (await maintenanceRequested("contact-worker")) return;
    running = true;
    try {
      for (let processed = 0; processed < 20; processed++) {
        if (!await processNextContactNotification()) break;
      }
    } catch (error) {
      console.error("Contact notification worker cycle failed", sanitizeDeliveryError(error));
    } finally {
      running = false;
    }
  };
  void run();
  const timer = setInterval(() => void run(), 30_000);
  return () => clearInterval(timer);
}

async function failNotificationJob(job: JobRow, reason: string, terminal: boolean) {
  const { failed, retryMinutes } = contactNotificationRetryDecision(job.attempt_count, terminal);
  await client.queryArray(`
    UPDATE contact_notification_jobs
    SET status = $2, next_attempt_at = CASE WHEN $2 = 'pending'
      THEN CURRENT_TIMESTAMP + ($3 * INTERVAL '1 minute') ELSE next_attempt_at END,
      last_error = $4, processing_started_at = NULL, updated_at = CURRENT_TIMESTAMP
    WHERE id = $1
  `, [job.job_id, failed ? "failed" : "pending", retryMinutes, reason]);
  await client.queryArray(`UPDATE contact_inquiries SET notification_status = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [job.id, failed ? "failed" : "pending"]);
  console.info("Contact notification delivery", { referenceCode: job.reference_code, outcome: failed ? "failed" : "retry_scheduled" });
}

function mapInquiry(row: InquiryRow) {
  return {
    id: Number(row.id), referenceCode: row.reference_code, firstName: row.first_name,
    lastName: row.last_name, email: row.email, subject: row.subject, message: row.message,
    status: row.status, notificationStatus: row.notification_status,
    createdAt: toIso(row.created_at), updatedAt: toIso(row.updated_at),
    resolvedAt: row.resolved_at ? toIso(row.resolved_at) : null,
    firstReadAt: row.first_read_at ? toIso(row.first_read_at) : null,
  };
}

function toIso(value: Date | string) { return value instanceof Date ? value.toISOString() : new Date(value).toISOString(); }
function isUniqueViolation(error: unknown) { return typeof error === "object" && error !== null && "fields" in error && String((error as { fields?: { code?: string } }).fields?.code) === "23505"; }
function sanitizeDeliveryError(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (message.includes("timeout")) return "SMTP_TIMEOUT";
  if (message.includes("auth") || message.includes("535")) return "SMTP_AUTHENTICATION_FAILED";
  if (message.includes("connect") || message.includes("unavailable")) return "SMTP_UNAVAILABLE";
  return "SMTP_DELIVERY_FAILED";
}
