import { Router } from "https://deno.land/x/oak@v12.6.1/mod.ts";
import { isAdmin, isAuthenticated } from "../middleware/authMiddleware.ts";
import { rateLimit } from "../middleware/rateLimit.ts";
import {
  addContactInquiryNote,
  createContactInquiry,
  getContactInquiry,
  getContactInquirySummary,
  listContactInquiries,
  listContactInquiryNotes,
  retryContactNotification,
  updateContactInquiryStatus,
  ContactStatusTransitionError,
  type ContactInquiryStatus,
} from "../services/contactInquiryService.ts";
import { validateContactInquiry } from "../shared/contactInquiry.ts";

const router = new Router();
const statuses = new Set<ContactInquiryStatus>(["new", "read", "resolved", "spam"]);
const publicContactRateLimit = rateLimit({
  windowMs: 15 * 60_000,
  max: 5,
  name: "contact-inquiries",
  message: "Too many inquiries were submitted from this connection. Please try again later.",
});

router.post("/api/contact-inquiries", publicContactRateLimit, async (ctx) => {
  const declaredSize = Number(ctx.request.headers.get("content-length") || 0);
  if (declaredSize > 16 * 1024) return respond(ctx, 413, { error: "Request body must not exceed 16 KB." });

  let body: Record<string, unknown>;
  try {
    const raw = await ctx.request.body({ type: "text" }).value;
    if (new TextEncoder().encode(raw).byteLength > 16 * 1024) return respond(ctx, 413, { error: "Request body must not exceed 16 KB." });
    body = JSON.parse(raw);
  } catch {
    return respond(ctx, 400, { error: "A valid JSON request body is required." });
  }

  if (String(body.website ?? "").trim()) {
    return respond(ctx, 201, { referenceCode: "PEAS-RECEIVED", status: "received" });
  }
  const validation = validateContactInquiry(body);
  if (!validation.success) return respond(ctx, 422, { error: "Please correct the highlighted fields.", fields: validation.errors });

  const receipt = await createContactInquiry(validation.value);
  respond(ctx, 201, receipt);
});

router.get("/api/admin/contact-inquiries/summary", isAuthenticated, isAdmin, async (ctx) => {
  respond(ctx, 200, await getContactInquirySummary());
});

router.get("/api/admin/contact-inquiries", isAuthenticated, isAdmin, async (ctx) => {
  const page = positiveInt(ctx.request.url.searchParams.get("page"), 1);
  const size = Math.min(100, positiveInt(ctx.request.url.searchParams.get("size"), 20));
  const statusValue = ctx.request.url.searchParams.get("status") as ContactInquiryStatus | null;
  if (statusValue && !statuses.has(statusValue)) return respond(ctx, 400, { error: "Invalid inquiry status." });
  const search = ctx.request.url.searchParams.get("search")?.trim().slice(0, 160) || undefined;
  const sort = ctx.request.url.searchParams.get("sort") === "oldest" ? "oldest" : "newest";
  const result = await listContactInquiries({ page, size, status: statusValue || undefined, search, sort });
  respond(ctx, 200, { ...result, page, size, totalPages: Math.ceil(result.totalCount / size) });
});

router.get("/api/admin/contact-inquiries/:referenceCode/notes", isAuthenticated, isAdmin, async (ctx) => {
  const inquiry = await getContactInquiry(ctx.params.referenceCode);
  if (!inquiry) return respond(ctx, 404, { error: "Inquiry not found." });
  respond(ctx, 200, { notes: await listContactInquiryNotes(ctx.params.referenceCode) });
});

router.post("/api/admin/contact-inquiries/:referenceCode/notes", isAuthenticated, isAdmin, async (ctx) => {
  const body = await readJson(ctx);
  const note = typeof body?.note === "string" ? body.note.trim() : "";
  if (!note || note.length > 5000) return respond(ctx, 422, { error: "A note between 1 and 5,000 characters is required." });
  const created = await addContactInquiryNote(ctx.params.referenceCode, String(ctx.state.user.id), note);
  if (!created) return respond(ctx, 404, { error: "Inquiry not found." });
  respond(ctx, 201, created);
});

router.post("/api/admin/contact-inquiries/:referenceCode/retry-notification", isAuthenticated, isAdmin, async (ctx) => {
  const retried = await retryContactNotification(ctx.params.referenceCode);
  if (!retried) return respond(ctx, 409, { error: "Only failed notifications can be retried." });
  console.info("Contact notification manually retried", { referenceCode: ctx.params.referenceCode, administratorId: String(ctx.state.user.id) });
  respond(ctx, 202, { status: "pending" });
});

router.get("/api/admin/contact-inquiries/:referenceCode", isAuthenticated, isAdmin, async (ctx) => {
  const inquiry = await getContactInquiry(ctx.params.referenceCode);
  if (!inquiry) return respond(ctx, 404, { error: "Inquiry not found." });
  respond(ctx, 200, inquiry);
});

router.patch("/api/admin/contact-inquiries/:referenceCode", isAuthenticated, isAdmin, async (ctx) => {
  const body = await readJson(ctx);
  const status = body?.status as ContactInquiryStatus;
  if (!statuses.has(status)) return respond(ctx, 422, { error: "Status must be new, read, resolved, or spam." });
  let inquiry;
  try {
    inquiry = await updateContactInquiryStatus(ctx.params.referenceCode, status, String(ctx.state.user.id));
  } catch (error) {
    if (error instanceof ContactStatusTransitionError) return respond(ctx, 409, { error: error.message });
    throw error;
  }
  if (!inquiry) return respond(ctx, 404, { error: "Inquiry not found." });
  respond(ctx, 200, inquiry);
});

function positiveInt(value: string | null, fallback: number) { const parsed = Number(value); return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback; }
async function readJson(ctx: any): Promise<Record<string, unknown> | null> { try { return await ctx.request.body({ type: "json" }).value; } catch { return null; } }
function respond(ctx: any, status: number, body: unknown) { ctx.response.status = status; ctx.response.type = "json"; ctx.response.body = body; }

export default router;
