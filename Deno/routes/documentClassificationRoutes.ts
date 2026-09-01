import { Router } from "../deps.ts";
import { isAuthenticated, isAdmin, requireCapability } from "../middleware/authMiddleware.ts";
import { canModifyPendingUpload, canViewDocument } from "../services/contentAuthorizationService.ts";
import {
  ClassificationValidationError,
  createResearchAgenda,
  createTopic,
  getDocumentClassification,
  getPublicTopic,
  listAdminResearchAgendas,
  listAdminKeywords,
  listPublicResearchAgendas,
  listResearchAgendas,
  listTopics,
  mergeTopics,
  normalizeClassificationTerm,
  reorderResearchAgendas,
  replaceDocumentClassification,
  reviewTopic,
  searchKeywords,
  searchTopics,
  updateKeyword,
  updateResearchAgenda,
} from "../services/documentClassificationService.ts";
import { getSessionFromHeaders } from "../services/sessionService.ts";
import { SystemLogsModel } from "../models/systemLogsModel.ts";
import { client, withTransaction } from "../db/denopost_conn.ts";

const router = new Router();
const requireUpload = requireCapability("documents:upload");

function actorFromContext(ctx: any) {
  return { id: String(ctx.state.user.id), role: String(ctx.state.user.role) };
}

async function createImmediateTopic(ctx: any) {
  try {
    const body = await ctx.request.body({ type: "json" }).value;
    const topic = await createTopic(String(body?.name ?? ""), actorFromContext(ctx), "approved");
    ctx.response.status = 201;
    ctx.response.body = topic;
  } catch (error) {
    validationResponse(ctx, error);
  }
}

function validationResponse(ctx: any, error: unknown) {
  if (error instanceof ClassificationValidationError) {
    ctx.response.status = 422;
    ctx.response.body = { error: error.message, fieldErrors: error.fieldErrors };
    return;
  }
  ctx.response.status = 500;
  ctx.response.body = { error: error instanceof Error ? error.message : "Internal server error" };
}

router.get("/api/research-agendas", async (ctx) => {
  try {
    const session = await getSessionFromHeaders(ctx.request.headers);
    const includeInactive = ctx.request.url.searchParams.get("include_inactive") === "true" && session?.role === "admin";
    const includeHistorical = ctx.request.url.searchParams.get("include_historical") === "true";
    ctx.response.body = includeInactive ? await listResearchAgendas(true) : await listPublicResearchAgendas(includeHistorical);
  } catch (error) {
    validationResponse(ctx, error);
  }
});

router.post("/api/admin/research-agendas", isAuthenticated, isAdmin, async (ctx) => {
  try {
    const body = await ctx.request.body({ type: "json" }).value;
    const agenda = await createResearchAgenda(body ?? {});
    void SystemLogsModel.createLog({
      log_type: "classification_management",
      user_id: String(ctx.state.user.id),
      username: String(ctx.state.user.id),
      action: "research_agenda_created",
      related_id: String(agenda.id),
      details: { after: agenda },
    }).catch(() => undefined);
    ctx.response.status = 201;
    ctx.response.body = agenda;
  } catch (error) {
    validationResponse(ctx, error);
  }
});

router.get("/api/admin/research-agendas", isAuthenticated, isAdmin, async (ctx) => {
  try {
    ctx.response.body = await listAdminResearchAgendas();
  } catch (error) {
    validationResponse(ctx, error);
  }
});

router.put("/api/admin/research-agendas/order", isAuthenticated, isAdmin, async (ctx) => {
  try {
    const body = await ctx.request.body({ type: "json" }).value;
    const before = await listAdminResearchAgendas();
    await reorderResearchAgendas(body?.agendaIds);
    const after = await listAdminResearchAgendas();
    void SystemLogsModel.createLog({
      log_type: "classification_management",
      user_id: String(ctx.state.user.id),
      username: String(ctx.state.user.id),
      action: "research_agendas_reordered",
      details: { before: before.map((item) => item.id), after: after.map((item) => item.id) },
    }).catch(() => undefined);
    ctx.response.body = after;
  } catch (error) {
    validationResponse(ctx, error);
  }
});

router.put("/api/admin/research-agendas/:id", isAuthenticated, isAdmin, async (ctx) => {
  try {
    const body = await ctx.request.body({ type: "json" }).value;
    const id = Number(ctx.params.id);
    const before = (await listAdminResearchAgendas()).find((item) => item.id === id);
    if (!before) throw new ClassificationValidationError("Official research agenda not found");
    const agenda = await updateResearchAgenda(id, body ?? {});
    const after = (await listAdminResearchAgendas()).find((item) => item.id === id) ?? agenda;
    const action = body?.isActive === false ? "research_agenda_retired" : body?.isActive === true ? "research_agenda_reactivated" : "research_agenda_updated";
    void SystemLogsModel.createLog({
      log_type: "classification_management",
      user_id: String(ctx.state.user.id),
      username: String(ctx.state.user.id),
      action,
      related_id: String(id),
      details: { before, after },
    }).catch(() => undefined);
    ctx.response.body = after;
  } catch (error) {
    validationResponse(ctx, error);
  }
});

router.get("/api/topics", async (ctx) => {
  try {
    ctx.response.body = await searchTopics(ctx.request.url.searchParams.get("q") ?? "", false);
  } catch (error) {
    validationResponse(ctx, error);
  }
});

router.post("/api/topics", isAuthenticated, requireUpload, createImmediateTopic);

router.get("/api/topics/:id", async (ctx) => {
  try {
    const topic = await getPublicTopic(Number(ctx.params.id));
    if (!topic) {
      ctx.response.status = 404;
      ctx.response.body = { error: "Topic not found" };
      return;
    }
    ctx.response.body = topic;
  } catch (error) {
    validationResponse(ctx, error);
  }
});

router.get("/api/admin/topics", isAuthenticated, isAdmin, async (ctx) => {
  try {
    const requested = ctx.request.url.searchParams.get("status") ?? "all";
    const status = requested === "pending" || requested === "approved" || requested === "retired" ? requested : "all";
    ctx.response.body = await listTopics(status);
  } catch (error) {
    validationResponse(ctx, error);
  }
});

router.get("/api/admin/keywords", isAuthenticated, isAdmin, async (ctx) => {
  try {
    ctx.response.body = await listAdminKeywords(ctx.request.url.searchParams.get("q") ?? "");
  } catch (error) {
    validationResponse(ctx, error);
  }
});

router.put("/api/admin/keywords/:id", isAuthenticated, isAdmin, async (ctx) => {
  try {
    const id = Number(ctx.params.id);
    const before = (await listAdminKeywords()).find((item) => item.id === id);
    if (!before) throw new ClassificationValidationError("Keyword not found", { keywordId: "Keyword not found" });
    const body = await ctx.request.body({ type: "json" }).value;
    const after = await updateKeyword(id, body?.term);
    void SystemLogsModel.createLog({
      log_type: "classification_management",
      user_id: String(ctx.state.user.id),
      username: String(ctx.state.user.id),
      action: "keyword_updated",
      related_id: String(id),
      details: { before, after },
    }).catch(() => undefined);
    ctx.response.body = after;
  } catch (error) {
    validationResponse(ctx, error);
  }
});

router.get("/api/admin/classification/summary", isAuthenticated, isAdmin, async (ctx) => {
  try {
    const result = await client.queryObject<{ missing_documents: number | bigint; pending_migration: number | bigint }>(`
      SELECT
        (SELECT COUNT(*) FROM documents d
         WHERE d.deleted_at IS NULL AND d.review_status = 'approved' AND d.is_public IS TRUE
           AND NOT EXISTS (SELECT 1 FROM document_topics dt JOIN topics t ON t.id = dt.topic_id WHERE dt.document_id = d.id AND t.status = 'approved')) AS missing_documents,
        (SELECT COUNT(*) FROM classification_migration_review WHERE status = 'pending') AS pending_migration
    `);
    const row = result.rows[0];
    ctx.response.body = { missingDocuments: Number(row?.missing_documents ?? 0), pendingMigration: Number(row?.pending_migration ?? 0) };
  } catch (error) {
    validationResponse(ctx, error);
  }
});

router.get("/api/admin/classification/migration-review", isAuthenticated, isAdmin, async (ctx) => {
  try {
    const status = ctx.request.url.searchParams.get("status") === "resolved" ? "resolved" : "pending";
    const result = await client.queryObject(`
      SELECT r.document_id, r.legacy_research_agenda_id, r.legacy_value, r.suggested_type, r.decision, r.target_id, r.status, r.notes, d.title AS document_title
      FROM classification_migration_review r
      JOIN documents d ON d.id = r.document_id
      WHERE r.status = $1
      ORDER BY r.document_id ASC, r.legacy_research_agenda_id ASC
      LIMIT 500
    `, [status]);
    ctx.response.body = result.rows;
  } catch (error) {
    validationResponse(ctx, error);
  }
});

router.post("/api/admin/classification/migration-review/:documentId/:legacyId/resolve", isAuthenticated, isAdmin, async (ctx) => {
  try {
    const documentId = Number(ctx.params.documentId);
    const legacyId = Number(ctx.params.legacyId);
    const body = await ctx.request.body({ type: "json" }).value;
    const decision = body?.decision;
    const targetId = Number(body?.targetId ?? 0);
    if (!Number.isInteger(documentId) || !Number.isInteger(legacyId) || !["agenda", "topic", "keyword", "discard"].includes(decision)) throw new ClassificationValidationError("A valid migration decision is required");
    if (decision === "discard" && !String(body?.notes ?? "").trim()) throw new ClassificationValidationError("Discard decisions require a reason", { notes: "Enter a reason before discarding" });
    await withTransaction(async (connection) => {
      const review = await connection.queryObject<{ legacy_value: string; status: string }>(`SELECT legacy_value, status FROM classification_migration_review WHERE document_id = $1 AND legacy_research_agenda_id = $2 FOR UPDATE`, [documentId, legacyId]);
      if (!review.rows[0]) throw new ClassificationValidationError("Migration-review row not found");
      if (review.rows[0].status === "resolved") throw new ClassificationValidationError("Migration-review row is already resolved");
      const primary = await connection.queryObject<{ is_primary: boolean }>(`SELECT is_primary FROM document_research_agenda WHERE document_id = $1 AND research_agenda_id = $2`, [documentId, legacyId]);
      const isPrimary = Boolean(primary.rows[0]?.is_primary);
      if (decision === "agenda") {
        const target = await connection.queryObject(`SELECT id FROM research_agenda WHERE id = $1 AND is_official = TRUE AND is_active = TRUE`, [targetId]);
        if (!target.rows[0]) throw new ClassificationValidationError("Agenda target must be an active official agenda");
        await connection.queryArray(`DELETE FROM document_research_agenda WHERE document_id = $1 AND research_agenda_id = $2`, [documentId, legacyId]);
        await connection.queryArray(`INSERT INTO document_research_agenda (document_id, research_agenda_id, is_primary, assigned_by) VALUES ($1, $2, $3, $4) ON CONFLICT (document_id, research_agenda_id) DO UPDATE SET is_primary = EXCLUDED.is_primary`, [documentId, targetId, isPrimary, String(ctx.state.user.id)]);
      } else if (decision === "topic") {
        const target = await connection.queryObject(`SELECT id FROM topics WHERE id = $1 AND status = 'approved'`, [targetId]);
        if (!target.rows[0]) throw new ClassificationValidationError("Topic target must be approved");
        await connection.queryArray(`INSERT INTO document_topics (document_id, topic_id, topic_order, assigned_by) SELECT $1, $2, COALESCE(MAX(topic_order), 0) + 1, $3 FROM document_topics WHERE document_id = $1 ON CONFLICT DO NOTHING`, [documentId, targetId, String(ctx.state.user.id)]);
        await connection.queryArray(`DELETE FROM document_research_agenda WHERE document_id = $1 AND research_agenda_id = $2`, [documentId, legacyId]);
      } else if (decision === "keyword") {
        const term = review.rows[0].legacy_value.trim().replace(/\s+/gu, " ");
        const keyword = targetId ? await connection.queryObject<{ id: number }>(`SELECT id FROM keywords WHERE id = $1`, [targetId]) : await connection.queryObject<{ id: number }>(`INSERT INTO keywords (term, normalized_term) VALUES ($1, $2) ON CONFLICT (normalized_term) DO UPDATE SET term = keywords.term RETURNING id`, [term, normalizeClassificationTerm(term)]);
        if (!keyword.rows[0]) throw new ClassificationValidationError("Keyword target was not found");
        await connection.queryArray(`INSERT INTO document_keywords (document_id, keyword_id, keyword_order, assigned_by) SELECT $1, $2, COALESCE(MAX(keyword_order), 0) + 1, $3 FROM document_keywords WHERE document_id = $1 ON CONFLICT DO NOTHING`, [documentId, Number(keyword.rows[0].id), String(ctx.state.user.id)]);
        await connection.queryArray(`DELETE FROM document_research_agenda WHERE document_id = $1 AND research_agenda_id = $2`, [documentId, legacyId]);
      } else {
        await connection.queryArray(`DELETE FROM document_research_agenda WHERE document_id = $1 AND research_agenda_id = $2`, [documentId, legacyId]);
      }
      await connection.queryArray(`UPDATE classification_migration_review SET decision = $3, target_id = NULLIF($4, 0), status = 'resolved', reviewed_by = $5, reviewed_at = CURRENT_TIMESTAMP, notes = $6 WHERE document_id = $1 AND legacy_research_agenda_id = $2`, [documentId, legacyId, decision, targetId, String(ctx.state.user.id), String(body?.notes ?? "").trim() || null]);
    });
    ctx.response.body = { success: true, documentId, legacyId, decision };
  } catch (error) {
    validationResponse(ctx, error);
  }
});

router.get("/api/keywords", async (ctx, next) => {
  // The existing keywords router owns the collection/trending endpoints. This
  // route only handles the new typed autocomplete query when one is present.
  if (!ctx.request.url.searchParams.has("q")) return await next();
  try {
    ctx.response.body = await searchKeywords(ctx.request.url.searchParams.get("q") ?? "");
  } catch (error) {
    validationResponse(ctx, error);
  }
});

router.post("/api/topics/proposals", isAuthenticated, requireUpload, async (ctx) => {
  ctx.response.headers.set("Deprecation", "true");
  ctx.response.headers.set("Sunset", "2026-12-31");
  await createImmediateTopic(ctx);
});

router.post("/api/admin/topics", isAuthenticated, isAdmin, async (ctx) => {
  try {
    const body = await ctx.request.body({ type: "json" }).value;
    const topic = await createTopic(String(body?.name ?? ""), actorFromContext(ctx), "approved");
    ctx.response.status = 201;
    ctx.response.body = topic;
  } catch (error) {
    validationResponse(ctx, error);
  }
});

router.post("/api/admin/topics/:id/approve", isAuthenticated, isAdmin, async (ctx) => {
  try {
    ctx.response.body = await reviewTopic(Number(ctx.params.id), "approved", actorFromContext(ctx));
  } catch (error) {
    validationResponse(ctx, error);
  }
});

router.post("/api/admin/topics/:id/reject", isAuthenticated, isAdmin, async (ctx) => {
  try {
    ctx.response.body = await reviewTopic(Number(ctx.params.id), "retired", actorFromContext(ctx));
  } catch (error) {
    validationResponse(ctx, error);
  }
});

router.post("/api/admin/topics/:id/merge", isAuthenticated, isAdmin, async (ctx) => {
  try {
    const body = await ctx.request.body({ type: "json" }).value;
    ctx.response.body = await mergeTopics(Number(ctx.params.id), Number(body?.targetTopicId), actorFromContext(ctx));
  } catch (error) {
    validationResponse(ctx, error);
  }
});

router.get("/api/documents/:id/classification", async (ctx) => {
  try {
    const id = Number(ctx.params.id);
    const session = await getSessionFromHeaders(ctx.request.headers);
    if (!await canViewDocument(session, id)) {
      ctx.response.status = 404;
      ctx.response.body = { error: "Document not found" };
      return;
    }
    const includePending = session?.role === "admin";
    ctx.response.body = { classification: await getDocumentClassification(id, includePending) };
  } catch (error) {
    validationResponse(ctx, error);
  }
});

router.put("/api/documents/:id/classification", isAuthenticated, requireUpload, async (ctx) => {
  try {
    const id = Number(ctx.params.id);
    if (!await canModifyPendingUpload(ctx.state.user, id)) {
      ctx.response.status = 403;
      ctx.response.body = { error: "You cannot change classification for this document" };
      return;
    }
    const body = await ctx.request.body({ type: "json" }).value;
    const input = body?.classification ?? body;
    const statusResult = await client.queryObject<{ review_status: string }>(
      "SELECT review_status FROM documents WHERE id = $1 AND deleted_at IS NULL",
      [id],
    );
    const pendingDocument = statusResult.rows[0]?.review_status === "pending_review";
    const classification = await replaceDocumentClassification(id, input, actorFromContext(ctx), { allowIncomplete: pendingDocument });
    ctx.response.body = { classification };
  } catch (error) {
    validationResponse(ctx, error);
  }
});

export const documentClassificationRoutes = router.routes();
export const documentClassificationAllowedMethods = router.allowedMethods();
