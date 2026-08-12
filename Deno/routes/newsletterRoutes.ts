import { Router } from "../deps.ts";
import { isAuthenticated, requireCapability } from "../middleware/authMiddleware.ts";
import { SystemLogsModel } from "../models/systemLogsModel.ts";
import { client } from "../db/denopost_conn.ts";
import {
  adminSubscriptionAction, confirmNewsletter, getManagedNewsletter,
  getNewsletterAdminSummary, getNewsletterCampaign, getNewsletterPublicSettings,
  listNewsletterCampaigns, listNewsletterSubscriptions, queueNewsletterTest,
  requestNewsletterConfirmation, retryNewsletterJob, setNewsletterSettings,
  unsubscribeNewsletter, updateNewsletterPreferences,
} from "../services/newsletterService.ts";
import { NEWSLETTER_CONSENT_VERSION, validateNewsletterInput } from "../shared/newsletter.ts";

const router = new Router();
const manage = requireCapability("newsletter:manage");
const attempts = new Map<string, number[]>();

async function json(ctx: any): Promise<Record<string, any>> {
  const length = Number(ctx.request.headers.get("content-length") || 0);
  if (length > 8192) throw new Error("payload_too_large");
  const value = await ctx.request.body({ type: "json" }).value;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_payload");
  if (new TextEncoder().encode(JSON.stringify(value)).length > 8192) throw new Error("payload_too_large");
  return value;
}

function throttled(key: string, max: number, windowMs: number): boolean {
  const now = Date.now(), recent = (attempts.get(key) || []).filter((time) => now - time < windowMs);
  recent.push(now); attempts.set(key, recent); return recent.length > max;
}

function preferences(body: Record<string, any>) {
  const p = body.preferences || body;
  if ((p.cadence !== "immediate" && p.cadence !== "weekly") || typeof p.news !== "boolean" ||
    typeof p.papers !== "boolean" || (!p.news && !p.papers)) throw new Error("invalid_preferences");
  return { cadence: p.cadence, news: p.news, papers: p.papers };
}

router.get("/api/newsletter/public-settings", async (ctx) => { ctx.response.body = await getNewsletterPublicSettings(); });

router.post("/api/newsletter/subscriptions", async (ctx) => {
  try {
    const body = await json(ctx);
    if (String(body.website || "").trim()) { ctx.response.status = 202; ctx.response.body = { status: "confirmation_required" }; return; }
    const parsed = validateNewsletterInput(body);
    const ip = ctx.request.ip || "unknown";
    if (throttled(`ip:${ip}`, 10, 60 * 60_000) || throttled(`email:${parsed.email}`, 4, 86_400_000)) {
      ctx.response.status = 429; ctx.response.headers.set("Retry-After", "900"); ctx.response.body = { error: "Please try again later." }; return;
    }
    await requestNewsletterConfirmation({ email: parsed.email, preferences: parsed.preferences });
    ctx.response.status = 202; ctx.response.body = { status: "confirmation_required" };
  } catch (error) {
    if (String((error as Error).message) === "signup_disabled") { ctx.response.status = 503; ctx.response.body = { error: "Newsletter signup is temporarily unavailable." }; return; }
    ctx.response.status = 422; ctx.response.body = { error: "Please review the email, preferences, and consent fields." };
  }
});

router.post("/api/newsletter/confirm", async (ctx) => {
  try { const body = await json(ctx); ctx.response.body = await confirmNewsletter(String(body.token || "")); }
  catch { ctx.response.status = 422; ctx.response.body = { error: "This confirmation link is invalid or has expired." }; }
});
router.post("/api/newsletter/manage", async (ctx) => {
  try { const body = await json(ctx); ctx.response.body = await getManagedNewsletter(String(body.token || "")); }
  catch { ctx.response.status = 422; ctx.response.body = { error: "This management link is invalid." }; }
});
router.patch("/api/newsletter/preferences", async (ctx) => {
  try { const body = await json(ctx); ctx.response.body = await updateNewsletterPreferences(String(body.token || ""), preferences(body)); }
  catch { ctx.response.status = 422; ctx.response.body = { error: "The preferences could not be updated." }; }
});
router.post("/api/newsletter/unsubscribe", async (ctx) => {
  try { const body = await json(ctx); ctx.response.body = await unsubscribeNewsletter(String(body.token || "")); }
  catch { ctx.response.body = { status: "unsubscribed" }; }
});
router.post("/api/newsletter/one-click/:token", async (ctx) => {
  const body = await ctx.request.body({ type: "form" }).value.catch(() => new URLSearchParams());
  if (body.get("List-Unsubscribe") !== "One-Click") { ctx.response.status = 400; ctx.response.body = "Invalid request"; return; }
  try { await unsubscribeNewsletter(String(ctx.params.token || ""), true); } catch { /* idempotent and non-enumerating */ }
  ctx.response.status = 200; ctx.response.body = "Unsubscribed";
});

router.get("/api/admin/newsletter/summary", isAuthenticated, manage, async (ctx) => { ctx.response.body = await getNewsletterAdminSummary(); });
router.get("/api/admin/newsletter/subscriptions", isAuthenticated, manage, async (ctx) => { ctx.response.body = await listNewsletterSubscriptions(ctx.request.url.searchParams); });
router.get("/api/admin/newsletter/campaigns", isAuthenticated, manage, async (ctx) => { ctx.response.body = await listNewsletterCampaigns(ctx.request.url.searchParams); });
router.get("/api/admin/newsletter/campaigns/:id", isAuthenticated, manage, async (ctx) => {
  const result = await getNewsletterCampaign(Number(ctx.params.id)); if (!result) ctx.response.status = 404; else ctx.response.body = result;
});
router.get("/api/admin/newsletter/preview", isAuthenticated, manage, async (ctx) => { ctx.response.body = { subject: "PeAS Repository Updates", consentNoticeVersion: NEWSLETTER_CONSENT_VERSION, tracking: false, attachments: false }; });
router.patch("/api/admin/newsletter/settings", isAuthenticated, manage, async (ctx) => {
  const body = await json(ctx); await setNewsletterSettings(body, String(ctx.state.user.id));
  await audit(ctx, "newsletter_settings_updated", null, { signupEnabled: body.signupEnabled, deliveryPaused: body.deliveryPaused }); ctx.response.body = { success: true };
});
for (const [path, action] of [["resend-confirmation", "resend"], ["suppress", "suppress"], ["allow-reverification", "allow"]] as const) {
  router.post(`/api/admin/newsletter/subscriptions/:id/${path}`, isAuthenticated, manage, async (ctx) => {
    const body: Record<string, any> = path === "suppress" ? await json(ctx).catch(() => ({})) : {};
    await adminSubscriptionAction(ctx.params.id!, action, body.reason); await audit(ctx, `newsletter_${action}`, ctx.params.id!); ctx.response.body = { success: true };
  });
}
router.delete("/api/admin/newsletter/subscriptions/:id", isAuthenticated, manage, async (ctx) => {
  await adminSubscriptionAction(ctx.params.id!, "delete"); await audit(ctx, "newsletter_delete", ctx.params.id!); ctx.response.body = { success: true };
});
router.post("/api/admin/newsletter/jobs/:id/retry", isAuthenticated, manage, async (ctx) => {
  await retryNewsletterJob(Number(ctx.params.id)); await audit(ctx, "newsletter_retry", ctx.params.id!); ctx.response.body = { success: true };
});
router.post("/api/admin/newsletter/test", isAuthenticated, manage, async (ctx) => {
  const result = await client.queryObject<{ email: string }>("SELECT email FROM users WHERE id=$1", [String(ctx.state.user.id)]);
  if (!result.rows[0]?.email) { ctx.response.status = 422; ctx.response.body = { error: "Your administrator account has no email address." }; return; }
  await queueNewsletterTest(result.rows[0].email); await audit(ctx, "newsletter_test", null); ctx.response.status = 202; ctx.response.body = { success: true };
});

async function audit(ctx: any, action: string, relatedId: string | null, details: Record<string, unknown> = {}) {
  await SystemLogsModel.createLog({ log_type: "newsletter", user_id: String(ctx.state.user.id), action, related_id: relatedId, details });
}
export default router;
