import { Router } from "../deps.ts";
import { createHash } from "node:crypto";
import { client } from "../db/denopost_conn.ts";
import { isAuthenticated } from "../middleware/authMiddleware.ts";
import { DocumentModel } from "../models/documentModel.ts";
import { DocumentAnnotationModel, type AnnotationInput } from "../models/documentAnnotationModel.ts";
import { canViewDocument } from "../services/contentAuthorizationService.ts";
import { renderPaperPageAsWebp } from "../services/paperViewerService.ts";

const router = new Router();
const digestCache = new Map<string, { signature: string; digest: string }>();

function annotationFeatureEnabled() {
  const runtimeEnv = (Deno.env.get("DENO_ENV") ?? Deno.env.get("NODE_ENV") ?? "development").toLowerCase();
  return runtimeEnv === "production"
    ? Deno.env.get("DOCUMENT_ANNOTATIONS_ENABLED") === "true"
    : Deno.env.get("DOCUMENT_ANNOTATIONS_ENABLED") !== "false";
}

router.use(async (ctx, next) => {
  if (ctx.request.url.pathname === "/api/user/annotation-capabilities") {
    await next();
    return;
  }
  if (!annotationFeatureEnabled()) {
    ctx.response.status = 404;
    ctx.response.body = { error: "Document annotations are unavailable" };
    return;
  }
  await next();
});

router.get("/api/user/annotation-capabilities", isAuthenticated, async (ctx) => {
  privateResponse(ctx);
  ctx.response.body = {
    success: true,
    enabled: annotationFeatureEnabled(),
  };
});

router.get("/api/user/documents/:id/annotation-context", isAuthenticated, async (ctx) => {
  const documentId = positiveInteger(ctx.params.id);
  if (!documentId) return fail(ctx, 400, "A valid document ID is required");
  const page = queryPositiveInteger(ctx.request.url.searchParams.get("page"), 1);
  if (page === null) return fail(ctx, 400, "A valid page is required");
  const source = await resolveSource(ctx, documentId);
  if (!source) return fail(ctx, 404, "Document not found or unavailable");
  if (source.pageCount > 0 && page > source.pageCount) return fail(ctx, 400, "Page is outside the document");
  const context = await DocumentAnnotationModel.context(String(ctx.state.user.id), documentId, source.id, page);
  privateResponse(ctx);
  ctx.response.body = { success: true, source: { id: source.id, pageCount: source.pageCount }, page, ...context };
});

router.get("/api/user/documents/:id/annotations", isAuthenticated, async (ctx) => {
  const documentId = positiveInteger(ctx.params.id);
  if (!documentId) return fail(ctx, 400, "A valid document ID is required");
  const page = queryPositiveInteger(ctx.request.url.searchParams.get("page"), 1);
  const size = queryPositiveInteger(ctx.request.url.searchParams.get("size"), 20);
  if (page === null || size === null || size > 50) return fail(ctx, 400, "Invalid annotation pagination");
  const type = queryEnum(ctx.request.url.searchParams.get("type"), ["bookmark", "highlight", "note"] as const);
  const review = queryEnum(ctx.request.url.searchParams.get("review"), ["current", "needs-review", "all"] as const);
  const tag = boundedQuery(ctx.request.url.searchParams.get("tag"), 40);
  if (type === null || review === null || tag === null) return fail(ctx, 400, "Invalid annotation filter");
  const source = await resolveSource(ctx, documentId);
  if (!source) return fail(ctx, 404, "Document not found or unavailable");
  const result = await DocumentAnnotationModel.panel(String(ctx.state.user.id), documentId, source.id, {
    page,
    size,
    type: type || undefined,
    tag: tag || undefined,
    review: review || "all",
  });
  privateResponse(ctx);
  ctx.response.body = { success: true, ...result, totalPages: Math.ceil(result.totalCount / result.size) };
});

router.post("/api/user/documents/:id/annotations", isAuthenticated, async (ctx) => {
  const documentId = positiveInteger(ctx.params.id);
  if (!documentId) return fail(ctx, 400, "A valid document ID is required");
  const source = await resolveSource(ctx, documentId);
  if (!source) return fail(ctx, 404, "Document not found or unavailable");
  const body = await readJson(ctx);
  if (!body) return fail(ctx, 400, "Invalid JSON body");
  const input = validateInput(body, source.id, source.pageCount);
  if (!input) return fail(ctx, 400, "Invalid annotation data");
  const result = await DocumentAnnotationModel.create(String(ctx.state.user.id), documentId, input);
  if (!result) return fail(ctx, 409, "Annotation could not be created");
  privateResponse(ctx);
  ctx.response.status = result.created ? 201 : 200;
  ctx.response.body = { success: true, created: result.created, annotation: result.annotation };
});

router.patch("/api/user/annotations/:id", isAuthenticated, async (ctx) => {
  if (!validUuid(ctx.params.id)) return fail(ctx, 400, "A valid annotation ID is required");
  const body = await readJson(ctx);
  if (!body) return fail(ctx, 400, "Invalid JSON body");
  const input: Partial<AnnotationInput> = {};
  const nextColor = body.color === undefined ? undefined : normalizeColor(body.color);
  const nextLabel = body.label === undefined ? undefined : boundedText(body.label, 160);
  const nextNote = body.noteText === undefined && body.note_text === undefined ? undefined : boundedText(body.noteText ?? body.note_text, 5000);
  const nextTags = body.tags === undefined ? undefined : normalizeTags(body.tags);
  if (nextColor === false || nextLabel === false || nextNote === false || nextTags === false) return fail(ctx, 400, "Invalid annotation update");
  if (nextColor !== undefined) input.color = nextColor as AnnotationInput["color"];
  if (nextLabel !== undefined) input.label = nextLabel as string | null;
  if (nextNote !== undefined) input.noteText = nextNote as string | null;
  if (nextTags !== undefined) input.tags = nextTags as string[];
  if (!Object.keys(input).length) return fail(ctx, 400, "At least one annotation field is required");
  const annotation = await DocumentAnnotationModel.update(String(ctx.state.user.id), ctx.params.id, input);
  if (!annotation) return fail(ctx, 404, "Annotation not found");
  privateResponse(ctx);
  ctx.response.body = { success: true, annotation };
});

router.delete("/api/user/annotations/:id", isAuthenticated, async (ctx) => {
  if (!validUuid(ctx.params.id)) return fail(ctx, 400, "A valid annotation ID is required");
  const annotation = await DocumentAnnotationModel.remove(String(ctx.state.user.id), ctx.params.id);
  if (!annotation) return fail(ctx, 404, "Annotation not found");
  privateResponse(ctx);
  ctx.response.body = { success: true, removed: true, annotation };
});

router.post("/api/user/annotations/:id/restore", isAuthenticated, async (ctx) => {
  if (!validUuid(ctx.params.id)) return fail(ctx, 400, "A valid annotation ID is required");
  let annotation;
  try {
    annotation = await DocumentAnnotationModel.restore(String(ctx.state.user.id), ctx.params.id);
  } catch (error) {
    if (String((error as { code?: string })?.code) === "23505") return fail(ctx, 409, "A page bookmark already exists");
    throw error;
  }
  if (!annotation) return fail(ctx, 404, "Annotation cannot be restored");
  privateResponse(ctx);
  ctx.response.body = { success: true, annotation };
});

router.post("/api/user/annotations/:id/reanchor", isAuthenticated, async (ctx) => {
  if (!validUuid(ctx.params.id)) return fail(ctx, 400, "A valid annotation ID is required");
  const existing = await DocumentAnnotationModel.getOwned(String(ctx.state.user.id), ctx.params.id);
  if (!existing) return fail(ctx, 404, "Annotation not found");
  const source = await resolveSource(ctx, Number(existing.document_id));
  if (!source) return fail(ctx, 404, "Document not found or unavailable");
  const body = await readJson(ctx);
  if (!body) return fail(ctx, 400, "Invalid JSON body");
  const page = positiveInteger(body.pageNumber);
  const rects = normalizeRects(body.rects);
  const selectedText = boundedText(body.selectedText, 4000);
  const textPrefix = boundedText(body.textPrefix, 256);
  const textSuffix = boundedText(body.textSuffix, 256);
  if (body.confirmed !== true) return fail(ctx, 400, "Re-anchor confirmation is required");
  if (!page || (source.pageCount > 0 && page > source.pageCount) || [selectedText, textPrefix, textSuffix].some((value) => value === false)) return fail(ctx, 400, "Invalid re-anchor data");
  if (existing.anchor_type === "text" && (!selectedText || !rects?.length)) return fail(ctx, 400, "Text annotations require a passage and geometry");
  if (existing.anchor_type === "area" && !rects?.length) return fail(ctx, 400, "Area annotations require geometry");
  if (existing.anchor_type === "page" && (selectedText || rects?.length)) return fail(ctx, 400, "Page annotations cannot contain geometry");
  const annotation = await DocumentAnnotationModel.reanchor(String(ctx.state.user.id), ctx.params.id, source.id, page, selectedText as string | null, textPrefix as string | null, textSuffix as string | null, rects);
  if (!annotation) return fail(ctx, 404, "Annotation not found");
  privateResponse(ctx);
  ctx.response.body = { success: true, annotation };
});

router.put("/api/user/documents/:id/progress", isAuthenticated, async (ctx) => {
  const documentId = positiveInteger(ctx.params.id);
  if (!documentId) return fail(ctx, 400, "A valid document ID is required");
  const source = await resolveSource(ctx, documentId);
  if (!source) return fail(ctx, 404, "Document not found or unavailable");
  const body = await readJson(ctx);
  if (!body) return fail(ctx, 400, "Invalid JSON body");
  const page = positiveInteger(body.page);
  if (!page || (source.pageCount > 0 && page > source.pageCount)) return fail(ctx, 400, "A valid page is required");
  const updatedAt = await DocumentAnnotationModel.updateProgress(String(ctx.state.user.id), documentId, source.id, page, source.pageCount);
  privateResponse(ctx);
  ctx.response.body = { success: true, lastPage: page, pageCount: source.pageCount, updatedAt };
});

router.get("/api/user/annotations", isAuthenticated, async (ctx) => {
  const view = queryEnum(ctx.request.url.searchParams.get("view"), ["items", "documents"] as const);
  if (view === null) return fail(ctx, 400, "Invalid annotation view");
  const documentId = positiveInteger(ctx.request.url.searchParams.get("documentId"));
  if (ctx.request.url.searchParams.get("documentId") && !documentId) return fail(ctx, 400, "A valid document ID is required");
  const page = queryPositiveInteger(ctx.request.url.searchParams.get("page"), 1);
  const size = queryPositiveInteger(ctx.request.url.searchParams.get("size"), 20);
  if (page === null || size === null || size > 50) return fail(ctx, 400, "Invalid annotation pagination");
  const type = queryEnum(ctx.request.url.searchParams.get("type"), ["bookmark", "highlight", "note"] as const);
  const sort = queryEnum(ctx.request.url.searchParams.get("sort"), ["updated-newest", "updated-oldest", "title-asc", "page-asc"] as const);
  const tag = boundedQuery(ctx.request.url.searchParams.get("tag"), 40);
  const q = boundedQuery(ctx.request.url.searchParams.get("q"), 120);
  const readStatus = queryEnum(ctx.request.url.searchParams.get("readStatus"), ["read", "unread"] as const);
  const updatedFrom = queryDate(ctx.request.url.searchParams.get("updatedFrom"));
  const updatedTo = queryDate(ctx.request.url.searchParams.get("updatedTo"), true);
  if (type === null || sort === null || tag === null || q === null || readStatus === null || updatedFrom === null || updatedTo === null) return fail(ctx, 400, "Invalid annotation filter");
  const actor = { id: String(ctx.state.user.id), role: String(ctx.state.user.role ?? "user") };
  const query = {
    page,
    size,
    q: q || "",
    type: type || "",
    tag: tag || "",
    documentId: documentId ?? undefined,
    sort: sort || "updated-newest",
    readStatus: readStatus || undefined,
    updatedFrom: updatedFrom || undefined,
    updatedTo: updatedTo || undefined,
    view: view === "documents" ? "documents" as const : "items" as const,
  };
  const result = view === "documents"
    ? await DocumentAnnotationModel.listDocumentGroups(String(ctx.state.user.id), query, actor)
    : await DocumentAnnotationModel.list(String(ctx.state.user.id), query, actor);
  privateResponse(ctx);
  ctx.response.body = { success: true, ...result, totalPages: Math.ceil(result.totalCount / result.size) };
});

router.get("/api/user/annotations/export", isAuthenticated, async (ctx) => {
  const format = ctx.request.url.searchParams.get("format") ?? "markdown";
  const documentId = positiveInteger(ctx.request.url.searchParams.get("documentId"));
  if (ctx.request.url.searchParams.get("documentId") && !documentId) return fail(ctx, 400, "A valid document ID is required");
  if (format !== "json" && format !== "markdown") return fail(ctx, 400, "Unsupported export format");
  const type = queryEnum(ctx.request.url.searchParams.get("type"), ["bookmark", "highlight", "note"] as const);
  const sort = queryEnum(ctx.request.url.searchParams.get("sort"), ["updated-newest", "updated-oldest", "title-asc", "page-asc"] as const);
  const tag = boundedQuery(ctx.request.url.searchParams.get("tag"), 40);
  const q = boundedQuery(ctx.request.url.searchParams.get("q"), 120);
  const readStatus = queryEnum(ctx.request.url.searchParams.get("readStatus"), ["read", "unread"] as const);
  const updatedFrom = queryDate(ctx.request.url.searchParams.get("updatedFrom"));
  const updatedTo = queryDate(ctx.request.url.searchParams.get("updatedTo"), true);
  if (type === null || sort === null || tag === null || q === null || readStatus === null || updatedFrom === null || updatedTo === null) return fail(ctx, 400, "Invalid export filter");
  const filters = {
    q: q || "",
    type: type || "",
    tag: tag || "",
    documentId: documentId ?? undefined,
    sort: sort || "updated-newest",
    readStatus: readStatus || undefined,
    updatedFrom: updatedFrom || undefined,
    updatedTo: updatedTo || undefined,
  };
  const actor = { id: String(ctx.state.user.id), role: String(ctx.state.user.role ?? "user") };
  const first = await DocumentAnnotationModel.list(String(ctx.state.user.id), { ...filters, page: 1, size: 50 }, actor);
  const totalPages = Math.ceil(first.totalCount / first.size);
  privateResponse(ctx);
  ctx.response.headers.set("Content-Disposition", `attachment; filename="peas-annotations.${format === "json" ? "json" : "md"}"`);
  ctx.response.headers.set("Content-Type", format === "json" ? "application/json; charset=utf-8" : "text/markdown; charset=utf-8");
  ctx.response.body = annotationExportStream(format, first.items, totalPages, filters, actor, String(ctx.state.user.id));
});

router.get("/api/user/annotations/:id", isAuthenticated, async (ctx) => {
  if (!validUuid(ctx.params.id)) return fail(ctx, 400, "A valid annotation ID is required");
  const annotation = await DocumentAnnotationModel.getOwned(String(ctx.state.user.id), ctx.params.id);
  if (!annotation) return fail(ctx, 404, "Annotation not found");
  const available = await canViewDocument({ id: String(ctx.state.user.id), role: String(ctx.state.user.role ?? "user") }, Number(annotation.document_id));
  const currentSource = available ? await resolveSource(ctx, Number(annotation.document_id)) : null;
  privateResponse(ctx);
  ctx.response.body = {
    success: true,
    annotation: available
      ? { ...annotation, document_available: true, needs_review: Boolean(currentSource && currentSource.id !== annotation.source_id) }
      : {
        ...annotation,
        source_id: "",
        selected_text: null,
        text_prefix: null,
        text_suffix: null,
        rects: null,
        document_available: false,
        needs_review: false,
      },
  };
});

export default router;

async function resolveSource(ctx: any, documentId: number) {
  const actor = { id: String(ctx.state.user.id), role: String(ctx.state.user.role) };
  if (!await canViewDocument(actor, documentId)) return null;
  const document = await DocumentModel.getById(documentId);
  const pdfPath = await DocumentModel.getDocumentPath(documentId);
  if (!document || !pdfPath) return null;
  let stat: Deno.FileInfo;
  try { stat = await Deno.stat(pdfPath); } catch { return null; }
  const fingerprint = await getContentDigest(pdfPath, stat);
  // Persist the server-derived digest on the document as a lazy repair for
  // legacy rows and as a replacement detector for future file changes. The
  // client never supplies or controls this value.
  if (String(document.content_sha256 ?? "") !== fingerprint) {
    await client.queryArray(
      `UPDATE documents SET content_sha256 = $2, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND deleted_at IS NULL`,
      [documentId, fingerprint],
    );
  }
  let pageCount = Number(document.pages ?? 0);
  if (!pageCount) {
    try { pageCount = (await renderPaperPageAsWebp(documentId, pdfPath, 1)).pageCount; } catch { pageCount = 0; }
  }
  const source = await DocumentAnnotationModel.getSource(documentId, fingerprint, pageCount);
  return { id: source.id, pageCount: source.pageCount };
}

export function validateInput(body: Record<string, unknown>, sourceId: string, pageCount: number): AnnotationInput | null {
  const rawAnnotationType = body.annotationType ?? body.annotation_type;
  const rawAnchorType = body.anchorType ?? body.anchor_type;
  const annotationType = rawAnnotationType === "bookmark" || rawAnnotationType === "highlight" || rawAnnotationType === "note" ? rawAnnotationType : null;
  const anchorType = rawAnchorType === "page" || rawAnchorType === "text" || rawAnchorType === "area" ? rawAnchorType : null;
  const pageNumber = positiveInteger(body.pageNumber ?? body.page_number);
  if (!annotationType || !anchorType || !pageNumber || (pageCount > 0 && pageNumber > pageCount)) return null;
  if (annotationType === "bookmark" && anchorType !== "page") return null;
  if (annotationType === "highlight" && anchorType === "page") return null;
  const rects = normalizeRects(body.rects);
  if ((anchorType === "area" || anchorType === "text") && !rects?.length) return null;
  const selectedText = body.selectedText === undefined && body.selected_text === undefined ? null : boundedText(body.selectedText ?? body.selected_text, 4000);
  const label = body.label === undefined ? null : boundedText(body.label, 160);
  const noteText = body.noteText === undefined && body.note_text === undefined ? null : boundedText(body.noteText ?? body.note_text, 5000);
  const color = normalizeColor(body.color ?? "yellow");
  const tags = normalizeTags(body.tags);
  const textPrefix = boundedText(body.textPrefix, 256);
  const textSuffix = boundedText(body.textSuffix, 256);
  const clientRequestId = body.clientRequestId ?? body.client_request_id;
  if (!validUuid(clientRequestId) || [selectedText, label, noteText, textPrefix, textSuffix, color, tags].some((value) => value === false)) return null;
  if (anchorType === "text" && (!selectedText || !String(selectedText).trim())) return null;
  if (annotationType === "highlight" && anchorType === "area" && selectedText) return null;
  if (annotationType === "bookmark" && (selectedText || rects?.length || noteText || textPrefix || textSuffix)) return null;
  if (annotationType === "note" && anchorType === "page" && (selectedText || rects?.length || textPrefix || textSuffix)) return null;
  // A note without any user-visible content is not a usable annotation,
  // regardless of whether it is page-level or attached to a highlight.
  if (annotationType === "note" && !noteText && !label) return null;
  return { sourceId, annotationType, anchorType, pageNumber, selectedText: selectedText as string | null, textPrefix: textPrefix as string | null, textSuffix: textSuffix as string | null, rects, color: color as any, label: label as string | null, noteText: noteText as string | null, tags: tags as string[], clientRequestId: String(clientRequestId) };
}

export function normalizeRects(value: unknown) {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value) || value.length > 100) return null;
  const rects = value.map((item) => {
    if (!item || typeof item !== "object") return null;
    const row = item as Record<string, unknown>;
    const values = [row.x, row.y, row.width, row.height].map(Number);
    if (values.some((number) => !Number.isFinite(number)) || values[0] < 0 || values[1] < 0 || values[2] <= 0 || values[3] <= 0 || values[0] + values[2] > 1.001 || values[1] + values[3] > 1.001) return null;
    return { x: values[0], y: values[1], width: values[2], height: values[3] };
  });
  return rects.some((value) => !value) ? null : rects as Array<{ x: number; y: number; width: number; height: number }>;
}

function normalizeTags(value: unknown): string[] | false {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 10) return false;
  if (value.some((tag) => typeof tag !== "string")) return false;
  const tags = [...new Set(value.map((tag) => tag.trim().replace(/\s+/g, " ")).filter(Boolean))];
  return tags.every((tag) => tag.length <= 40) ? tags : false;
}

function boundedText(value: unknown, max: number): string | null | false {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") return false;
  const text = value.trim();
  return text.length <= max ? text : false;
}

function normalizeColor(value: unknown) { return ["yellow", "green", "blue", "pink"].includes(String(value)) ? String(value) : false; }
function validUuid(value: unknown) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value)); }
function positiveInteger(value: unknown, fallback?: number) { const number = Number(value); return Number.isSafeInteger(number) && number > 0 ? number : fallback; }
function queryPositiveInteger(value: string | null, fallback: number): number | null { if (value === null) return fallback; return positiveInteger(value) ?? null; }
function queryEnum<T extends readonly string[]>(value: string | null, allowed: T): T[number] | "" | null { if (value === null || value === "") return ""; return allowed.includes(value as T[number]) ? value as T[number] : null; }
function boundedQuery(value: string | null, max: number): string | null { if (value === null || value === "") return ""; return value.length <= max ? value.trim() : null; }
function queryDate(value: string | null, endOfDay = false): string | null {
  if (value === null || value === "") return "";
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const date = new Date(dateOnly ? `${value}T00:00:00.000Z` : value);
  if (Number.isNaN(date.getTime())) return null;
  if (dateOnly && endOfDay) date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString();
}
async function readJson(ctx: any): Promise<Record<string, unknown> | null> { try { const value = await ctx.request.body({ type: "json" }).value; return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; } catch { return null; } }
async function getContentDigest(path: string, stat: Deno.FileInfo): Promise<string> {
  // Include inode/change metadata when the platform exposes it. Size and
  // mtime alone are not a safe identity: a replacement can preserve both.
  const metadata = stat as Deno.FileInfo & { ctime?: Date; dev?: number; ino?: number };
  const signature = [
    metadata.dev ?? "",
    metadata.ino ?? "",
    metadata.size,
    metadata.mtime?.getTime() ?? 0,
    metadata.ctime?.getTime() ?? 0,
  ].join(":");
  const cached = digestCache.get(path);
  if (cached?.signature === signature) return cached.digest;
  // Hash the source incrementally so a large PDF does not consume memory
  // proportional to the file size in the web process.
  const file = await Deno.open(path, { read: true });
  const hash = createHash("sha256");
  try {
    for await (const chunk of file.readable) hash.update(chunk);
  } finally {
    file.close();
  }
  const digest = hash.digest("hex");
  digestCache.set(path, { signature, digest });
  // Keep legacy-source hashing lazy without retaining an unbounded path cache.
  if (digestCache.size > 256) digestCache.delete(digestCache.keys().next().value as string);
  return digest;
}
function fail(ctx: any, status: number, error: string) { ctx.response.status = status; ctx.response.body = { error }; }
function privateResponse(ctx: any) { ctx.response.headers.set("Cache-Control", "private, no-store"); ctx.response.headers.set("Vary", "Cookie"); }
function redactExport(item: any) {
  // Export a stable, public DTO. Internal source IDs, database IDs used only
  // for joins, geometry, and uploader/session fields must not leave the API.
  return {
    title: item.document_available ? item.title || "Untitled document" : null,
    authors: item.document_available && Array.isArray(item.author_names) ? item.author_names : [],
    publicationDate: item.document_available ? item.publication_date ?? null : null,
    page: Number(item.page_number),
    type: item.annotation_type,
    quote: item.document_available ? item.selected_text ?? null : null,
    note: item.note_text ?? null,
    label: item.label ?? null,
    tags: Array.isArray(item.tags) ? item.tags : [],
    needsReview: Boolean(item.needs_review),
    createdAt: new Date(item.created_at).toISOString(),
    updatedAt: new Date(item.updated_at).toISOString(),
  };
}
function toMarkdown(items: any[]) {
  return items.map(markdownItem).join("\n---\n\n");
}
function markdownItem(item: any) {
    const exported = redactExport(item);
    const citation = exported.authors.length ? `\nAuthors: ${exported.authors.join(", ")}` : "";
    return `## ${exported.title || "Unavailable document"}${citation}\n\n- Page: ${exported.page}\n- Type: ${exported.type}\n- Updated: ${exported.updatedAt}\n${exported.quote ? `\n> ${String(exported.quote).replace(/\n/g, " ")}\n` : ""}${exported.note ? `\n${exported.note}\n` : ""}${exported.tags.length ? `\nTags: ${exported.tags.join(", ")}\n` : ""}`;
}

function annotationExportStream(
  format: "json" | "markdown",
  firstItems: any[],
  totalPages: number,
  filters: Record<string, unknown>,
  actor: { id: string; role: string },
  userId: string,
) {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let first = true;
      const write = (value: string) => controller.enqueue(encoder.encode(value));
      try {
        if (format === "json") write("[");
        const emit = (items: any[]) => {
          for (const item of items) {
            if (format === "json") {
              if (!first) write(",\n");
              write(JSON.stringify(redactExport(item)));
            } else {
              if (!first) write("\n---\n\n");
              write(markdownItem(item));
            }
            first = false;
          }
        };
        emit(firstItems);
        for (let page = 2; page <= totalPages; page += 1) {
          const next = await DocumentAnnotationModel.list(userId, { ...filters, page, size: 50 }, actor);
          emit(next.items);
        }
        if (format === "json") write("\n]");
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });
}
