import { client, withTransaction } from "../db/denopost_conn.ts";
import { sendNewsletterMessage } from "./emailService.ts";
import {
  escapeNewsletterHtml, latestManilaMondayCutoff, maskNewsletterEmail,
  NEWSLETTER_CONSENT_VERSION, type NewsletterPreferences,
  signNewsletterToken, verifyNewsletterToken,
} from "../shared/newsletter.ts";

type Row = Record<string, any>;
const PUBLIC_APP_URL = (Deno.env.get("PUBLIC_APP_URL") || "http://localhost:8000").replace(/\/$/, "");
const retryMinutes = [1, 5, 15, 60];

function ensurePublicUrl(): void {
  if ((Deno.env.get("DENO_ENV") || Deno.env.get("NODE_ENV")) === "production" &&
    !PUBLIC_APP_URL.startsWith("https://")) throw new Error("PUBLIC_APP_URL must use HTTPS in production");
}

export async function getNewsletterPublicSettings() {
  const result = await client.queryObject<Row>(
    "SELECT signup_enabled FROM newsletter_settings WHERE id = true",
  );
  return {
    signupEnabled: Boolean(result.rows[0]?.signup_enabled),
    cadence: ["immediate", "weekly"], contentTypes: ["news", "papers"],
    weeklySchedule: "Monday at 9:00 AM", timezone: "Asia/Manila",
    consentNoticeVersion: NEWSLETTER_CONSENT_VERSION,
  };
}

export async function requestNewsletterConfirmation(input: {
  email: string; preferences: NewsletterPreferences;
}): Promise<void> {
  await withTransaction(async (db) => {
    const settings = await db.queryObject<Row>("SELECT signup_enabled FROM newsletter_settings WHERE id = true FOR SHARE");
    if (!settings.rows[0]?.signup_enabled) throw new Error("signup_disabled");
    const existing = await db.queryObject<Row>(
      "SELECT * FROM newsletter_subscriptions WHERE email_normalized = $1 FOR UPDATE", [input.email],
    );
    let subscription = existing.rows[0];
    if (subscription?.status === "active" && subscription.cadence === input.preferences.cadence &&
      subscription.wants_news === input.preferences.news && subscription.wants_papers === input.preferences.papers) return;
    if (subscription?.status === "suppressed") return;
    if (subscription?.last_confirmation_sent_at &&
      Date.now() - new Date(subscription.last_confirmation_sent_at).getTime() < 15 * 60_000) return;
    if (subscription?.confirmation_window_started_at &&
      Date.now() - new Date(subscription.confirmation_window_started_at).getTime() < 86_400_000 &&
      Number(subscription.confirmation_window_count) >= 3) return;
    if (!subscription) {
      const created = await db.queryObject<Row>(`INSERT INTO newsletter_subscriptions
        (email,email_normalized,cadence,wants_news,wants_papers)
        VALUES ($1,$1,$2,$3,$4) RETURNING *`,
        [input.email, input.preferences.cadence, input.preferences.news, input.preferences.papers]);
      subscription = created.rows[0];
    }
    const verification = await db.queryObject<Row>(`INSERT INTO newsletter_verification_requests
      (subscription_id,requested_cadence,requested_news,requested_papers,consent_notice_version,expires_at)
      VALUES ($1,$2,$3,$4,$5,clock_timestamp() + interval '24 hours') RETURNING id`,
      [subscription.id, input.preferences.cadence, input.preferences.news, input.preferences.papers, NEWSLETTER_CONSENT_VERSION]);
    await db.queryArray(`INSERT INTO newsletter_mail_jobs
      (kind,subscription_id,verification_request_id) VALUES ('confirmation',$1,$2)`,
      [subscription.id, verification.rows[0].id]);
    await db.queryArray(`UPDATE newsletter_subscriptions SET
      last_confirmation_sent_at=clock_timestamp(),
      confirmation_window_started_at=CASE WHEN confirmation_window_started_at IS NULL OR confirmation_window_started_at < clock_timestamp()-interval '24 hours' THEN clock_timestamp() ELSE confirmation_window_started_at END,
      confirmation_window_count=CASE WHEN confirmation_window_started_at IS NULL OR confirmation_window_started_at < clock_timestamp()-interval '24 hours' THEN 1 ELSE confirmation_window_count+1 END
      WHERE id=$1`, [subscription.id]);
  });
}

export async function confirmNewsletter(token: string) {
  const verified = await verifyNewsletterToken(token, "confirm");
  return await withTransaction(async (db) => {
    const request = await db.queryObject<Row>(`SELECT v.*,s.status,s.token_version
      FROM newsletter_verification_requests v JOIN newsletter_subscriptions s ON s.id=v.subscription_id
      WHERE v.id=$1 FOR UPDATE OF v,s`, [verified.id]);
    const row = request.rows[0];
    if (!row || row.used_at || new Date(row.expires_at) < new Date() || row.status === "suppressed") throw new Error("invalid_confirmation");
    const now = new Date();
    const reactivating = row.status === "unsubscribed";
    await db.queryArray(`UPDATE newsletter_subscriptions SET status='active',cadence=$2,wants_news=$3,wants_papers=$4,
      news_opted_in_at=CASE WHEN $3 THEN clock_timestamp() ELSE NULL END,
      papers_opted_in_at=CASE WHEN $4 THEN clock_timestamp() ELSE NULL END,
      cadence_changed_at=clock_timestamp(),consent_notice_version=$5,consented_at=clock_timestamp(),
      confirmed_at=COALESCE(confirmed_at,clock_timestamp()),unsubscribed_at=NULL,
      token_version=token_version+CASE WHEN $6 THEN 1 ELSE 0 END WHERE id=$1`,
      [row.subscription_id, row.requested_cadence, row.requested_news, row.requested_papers, row.consent_notice_version, reactivating]);
    await db.queryArray("UPDATE newsletter_verification_requests SET used_at=clock_timestamp() WHERE id=$1", [row.id]);
    await db.queryArray(`INSERT INTO newsletter_consent_events(subscription_id,event_type,consent_notice_version,details)
      VALUES ($1,$2,$3,$4::jsonb)`, [row.subscription_id, reactivating ? "reactivated" : "confirmed", row.consent_notice_version,
      JSON.stringify({ cadence: row.requested_cadence, news: row.requested_news, papers: row.requested_papers })]);
    return { status: "active", confirmedAt: now.toISOString() };
  });
}

async function subscriptionFromToken(token: string, purpose: "manage" | "unsubscribe" | "one-click", lock = false) {
  const verified = await verifyNewsletterToken(token, purpose);
  const result = await client.queryObject<Row>(`SELECT * FROM newsletter_subscriptions WHERE id=$1 AND token_version=$2${lock ? " FOR UPDATE" : ""}`,
    [verified.id, verified.version]);
  if (!result.rows[0]) throw new Error("invalid_token");
  return result.rows[0];
}

export async function getManagedNewsletter(token: string) {
  const row = await subscriptionFromToken(token, "manage");
  return { email: maskNewsletterEmail(row.email), status: row.status,
    preferences: { cadence: row.cadence, news: row.wants_news, papers: row.wants_papers },
    weeklySchedule: "Monday at 9:00 AM Asia/Manila" };
}

export async function updateNewsletterPreferences(token: string, preferences: NewsletterPreferences) {
  const verified = await verifyNewsletterToken(token, "manage");
  return await withTransaction(async (db) => {
    const found = await db.queryObject<Row>("SELECT * FROM newsletter_subscriptions WHERE id=$1 AND token_version=$2 FOR UPDATE", [verified.id, verified.version]);
    const row = found.rows[0];
    if (!row || row.status !== "active") throw new Error("invalid_token");
    await db.queryArray(`UPDATE newsletter_subscriptions SET cadence=$2,wants_news=$3,wants_papers=$4,
      news_opted_in_at=CASE WHEN $3 AND NOT wants_news THEN clock_timestamp() WHEN $3 THEN news_opted_in_at ELSE NULL END,
      papers_opted_in_at=CASE WHEN $4 AND NOT wants_papers THEN clock_timestamp() WHEN $4 THEN papers_opted_in_at ELSE NULL END,
      cadence_changed_at=CASE WHEN cadence<>$2 THEN clock_timestamp() ELSE cadence_changed_at END WHERE id=$1`,
      [row.id, preferences.cadence, preferences.news, preferences.papers]);
    await db.queryArray(`INSERT INTO newsletter_consent_events(subscription_id,event_type,consent_notice_version,details)
      VALUES($1,'preferences_changed',$2,$3::jsonb)`, [row.id, row.consent_notice_version,
      JSON.stringify(preferences)]);
    return { success: true };
  });
}

export async function unsubscribeNewsletter(token: string, oneClick = false) {
  const purpose = oneClick ? "one-click" : "unsubscribe";
  const verified = await verifyNewsletterToken(token, purpose);
  return await withTransaction(async (db) => {
    const found = await db.queryObject<Row>("SELECT * FROM newsletter_subscriptions WHERE id=$1 AND token_version=$2 FOR UPDATE", [verified.id, verified.version]);
    const row = found.rows[0];
    if (!row) return { status: "unsubscribed" };
    if (row.status !== "unsubscribed") {
      await db.queryArray("UPDATE newsletter_subscriptions SET status='unsubscribed',unsubscribed_at=clock_timestamp() WHERE id=$1", [row.id]);
      await db.queryArray("UPDATE newsletter_mail_jobs SET status='skipped',terminal_at=clock_timestamp(),error_code='unsubscribed' WHERE subscription_id=$1 AND status='queued'", [row.id]);
      await db.queryArray("INSERT INTO newsletter_consent_events(subscription_id,event_type,consent_notice_version) VALUES($1,'unsubscribed',$2)", [row.id, row.consent_notice_version]);
    }
    return { status: "unsubscribed" };
  });
}

async function snapshotEvent(event: Row): Promise<Row | null> {
  if (event.source_type === "news") {
    const q = await client.queryObject<Row>(`SELECT 'news' source_type,n.id source_id,n.title,n.excerpt,n.author_name authors,
      n.published_at publication_date,'Department News' category,NULL::text department,
      $2||'/news.html?slug='||n.slug url
      FROM news_posts n WHERE n.id=$1 AND n.status='published' AND n.published_at<=clock_timestamp() AND n.deleted_at IS NULL`, [event.source_id, PUBLIC_APP_URL]);
    return q.rows[0] ?? null;
  }
  if (event.source_type === "document") {
    const q = await client.queryObject<Row>(`SELECT 'document' source_type,d.id source_id,d.title,
      COALESCE(d.abstract,d.description,'') excerpt,COALESCE(string_agg(DISTINCT a.full_name,', '),'') authors,
      d.publication_date,c.category_name category,dep.department_name department,$2||'/pages/guest-single.html?id='||d.id url
      FROM documents d LEFT JOIN document_authors da ON da.document_id=d.id LEFT JOIN authors a ON a.id=da.author_id
      LEFT JOIN categories c ON c.id=d.category_id LEFT JOIN departments dep ON dep.id=d.department_id
      WHERE d.id=$1 AND d.review_status='approved' AND d.is_public=true AND d.deleted_at IS NULL
      AND d.compiled_parent_id IS NULL AND NOT EXISTS(SELECT 1 FROM compiled_document_items i WHERE i.document_id=d.id)
      GROUP BY d.id,c.category_name,dep.department_name`, [event.source_id, PUBLIC_APP_URL]);
    return q.rows[0] ?? null;
  }
  const q = await client.queryObject<Row>(`SELECT 'compilation' source_type,c.id source_id,
    COALESCE(c.category,'Compiled publication')||' '||COALESCE(c.start_year::text,'') title,
    COALESCE(c.abstract_foreword,'') excerpt,'' authors,c.start_year publication_date,c.category,c.department,
    COUNT(DISTINCT d.id) child_count,$2||'/pages/guest-compiled.html?id='||c.id url
    FROM compiled_documents c JOIN documents d ON d.compiled_parent_id=c.id
      OR EXISTS(SELECT 1 FROM compiled_document_items i WHERE i.compiled_document_id=c.id AND i.document_id=d.id)
    WHERE c.id=$1 AND c.review_status='approved' AND c.deleted_at IS NULL
      AND d.review_status='approved' AND d.is_public=true AND d.deleted_at IS NULL GROUP BY c.id`, [event.source_id, PUBLIC_APP_URL]);
  return q.rows[0] ?? null;
}

export async function dispatchNewsletterCampaigns(): Promise<void> {
  ensurePublicUrl();
  await client.queryArray("UPDATE newsletter_settings SET worker_heartbeat_at=clock_timestamp() WHERE id=true");
  const settings = (await client.queryObject<Row>("SELECT * FROM newsletter_settings WHERE id=true")).rows[0];
  if (settings.delivery_paused) return;
  const due = await client.queryObject<Row>(`SELECT e.* FROM newsletter_publication_events e
    WHERE e.state='active' AND e.eligible_at<=clock_timestamp()
      AND NOT EXISTS(SELECT 1 FROM newsletter_campaigns c WHERE c.kind='immediate' AND c.publication_event_id=e.id)
    ORDER BY e.first_published_at LIMIT 50`);
  for (const event of due.rows) await createImmediateCampaign(event);
  const cutoff = latestManilaMondayCutoff();
  const last = settings.last_weekly_cutoff ? new Date(settings.last_weekly_cutoff) : new Date(settings.launch_at);
  if (cutoff > last) await createWeeklyCampaign(last, cutoff);
}

async function createImmediateCampaign(event: Row): Promise<void> {
  const snapshot = await snapshotEvent(event);
  if (!snapshot) { await client.queryArray("UPDATE newsletter_publication_events SET state='void',voided_at=clock_timestamp() WHERE id=$1 AND delivered_once=false", [event.id]); return; }
  await withTransaction(async (db) => {
    const campaign = await db.queryObject<Row>(`INSERT INTO newsletter_campaigns(kind,publication_event_id)
      VALUES('immediate',$1) ON CONFLICT DO NOTHING RETURNING id`, [event.id]);
    if (!campaign.rows[0]) return;
    const id = campaign.rows[0].id;
    await db.queryArray("INSERT INTO newsletter_campaign_items(campaign_id,publication_event_id,snapshot) VALUES($1,$2,$3::jsonb)", [id, event.id, JSON.stringify(snapshot)]);
    await db.queryArray(`INSERT INTO newsletter_mail_jobs(kind,subscription_id,campaign_id)
      SELECT 'campaign',s.id,$1 FROM newsletter_subscriptions s WHERE s.status='active' AND s.cadence='immediate'
      AND s.confirmed_at<= $2 AND s.cadence_changed_at<= $2
      AND (($3='news' AND s.wants_news AND s.news_opted_in_at<=$2) OR ($3='papers' AND s.wants_papers AND s.papers_opted_in_at<=$2))
      ON CONFLICT DO NOTHING`, [id, event.first_published_at, event.content_type]);
    await db.queryArray("UPDATE newsletter_campaigns SET queued_count=(SELECT count(*) FROM newsletter_mail_jobs WHERE campaign_id=$1) WHERE id=$1", [id]);
  });
}

async function createWeeklyCampaign(start: Date, end: Date): Promise<void> {
  await withTransaction(async (db) => {
    const campaign = await db.queryObject<Row>(`INSERT INTO newsletter_campaigns(kind,period_start,period_end)
      VALUES('weekly',$1,$2) ON CONFLICT DO NOTHING RETURNING id`, [start, end]);
    if (!campaign.rows[0]) return;
    const id = campaign.rows[0].id;
    const events = await db.queryObject<Row>(`SELECT * FROM newsletter_publication_events WHERE state='active'
      AND first_published_at>$1 AND first_published_at<=$2 ORDER BY first_published_at DESC`, [start, end]);
    for (const event of events.rows) {
      const snapshot = await snapshotEvent(event);
      if (snapshot) await db.queryArray("INSERT INTO newsletter_campaign_items(campaign_id,publication_event_id,snapshot) VALUES($1,$2,$3::jsonb)", [id, event.id, JSON.stringify(snapshot)]);
    }
    await db.queryArray(`INSERT INTO newsletter_mail_jobs(kind,subscription_id,campaign_id)
      SELECT DISTINCT 'campaign',s.id,$1 FROM newsletter_subscriptions s JOIN newsletter_campaign_items ci ON ci.campaign_id=$1
      JOIN newsletter_publication_events e ON e.id=ci.publication_event_id WHERE s.status='active' AND s.cadence='weekly'
      AND e.first_published_at>=s.confirmed_at AND e.first_published_at>=s.cadence_changed_at
      AND ((e.content_type='news' AND s.wants_news AND e.first_published_at>=s.news_opted_in_at) OR
           (e.content_type='papers' AND s.wants_papers AND e.first_published_at>=s.papers_opted_in_at)) ON CONFLICT DO NOTHING`, [id]);
    await db.queryArray("UPDATE newsletter_campaigns SET queued_count=(SELECT count(*) FROM newsletter_mail_jobs WHERE campaign_id=$1) WHERE id=$1", [id]);
    await db.queryArray("UPDATE newsletter_settings SET last_weekly_cutoff=$1 WHERE id=true", [end]);
  });
}

async function claimJob(): Promise<Row | null> {
  return await withTransaction(async (db) => {
    await db.queryArray(`UPDATE newsletter_mail_jobs SET status='queued',locked_at=NULL,error_code='worker_timeout'
      WHERE status='processing' AND locked_at<clock_timestamp()-interval '15 minutes'`);
    const result = await db.queryObject<Row>(`WITH candidate AS (
      SELECT j.id FROM newsletter_mail_jobs j CROSS JOIN newsletter_settings s
      WHERE j.status='queued' AND j.available_at<=clock_timestamp()
        AND (j.kind<>'campaign' OR s.delivery_paused=false) ORDER BY CASE WHEN j.kind='campaign' THEN 1 ELSE 0 END,j.id
      FOR UPDATE OF j SKIP LOCKED LIMIT 1)
      UPDATE newsletter_mail_jobs j SET status='processing',locked_at=clock_timestamp(),attempts=attempts+1
      FROM candidate WHERE j.id=candidate.id RETURNING j.*`);
    return result.rows[0] ?? null;
  });
}

function links(subscription: Row) {
  return Promise.all([
    signNewsletterToken({ id: subscription.id, purpose: "manage", version: subscription.token_version }),
    signNewsletterToken({ id: subscription.id, purpose: "unsubscribe", version: subscription.token_version }),
    signNewsletterToken({ id: subscription.id, purpose: "one-click", version: subscription.token_version }),
  ]).then(([manage, unsubscribe, oneClick]) => ({
    manageUrl: `${PUBLIC_APP_URL}/newsletter.html#manage=${manage}`,
    unsubscribeUrl: `${PUBLIC_APP_URL}/newsletter.html#unsubscribe=${unsubscribe}`,
    oneClickUrl: `${PUBLIC_APP_URL}/api/newsletter/one-click/${oneClick}`,
  }));
}

function renderItems(items: Row[], weekly: boolean) {
  const selected = weekly ? [
    ...items.filter((i) => i.content_type === "news").slice(0, 10),
    ...items.filter((i) => i.content_type === "papers").slice(0, 10),
  ] : items;
  const text = selected.map((item) => `${item.snapshot.title}\n${item.snapshot.excerpt || ""}\n${item.snapshot.url}`).join("\n\n");
  const html = selected.map((item) => `<article><h2>${escapeNewsletterHtml(item.snapshot.title)}</h2><p>${escapeNewsletterHtml(item.snapshot.excerpt || "")}</p><p><a href="${escapeNewsletterHtml(item.snapshot.url)}">${item.content_type === "news" ? "Read the update" : "View repository record"}</a></p></article>`).join("");
  return { selected, text, html };
}

export async function processNewsletterMailJob(): Promise<boolean> {
  const job = await claimJob();
  if (!job) return false;
  try {
    if (job.kind === "confirmation") {
      const q = await client.queryObject<Row>(`SELECT s.*,v.expires_at FROM newsletter_subscriptions s JOIN newsletter_verification_requests v ON v.subscription_id=s.id WHERE v.id=$1 AND v.used_at IS NULL`, [job.verification_request_id]);
      const row = q.rows[0]; if (!row) return await skipJob(job.id, "verification_unavailable"), true;
      const token = await signNewsletterToken({ id: job.verification_request_id, purpose: "confirm", expiresAt: new Date(row.expires_at) });
      const url = `${PUBLIC_APP_URL}/newsletter.html#confirm=${token}`;
      const pendingLinks = await links(row);
      await sendNewsletterMessage({ recipient: row.email, subject: "Confirm your PeAS Repository Updates subscription",
        text: `Confirm your subscription within 24 hours:\n${url}`, html: `<h1>Confirm PeAS Repository Updates</h1><p><a href="${escapeNewsletterHtml(url)}">Confirm subscription</a></p><p>This link expires in 24 hours.</p>`,
        ...pendingLinks });
    } else if (job.kind === "test") {
      await sendNewsletterMessage({ recipient: job.recipient_email, subject: "PeAS Repository Updates — test",
        text: "This is a newsletter delivery test.", html: "<h1>PeAS Repository Updates</h1><p>This is a newsletter delivery test.</p>",
      });
    } else {
      const sub = (await client.queryObject<Row>("SELECT * FROM newsletter_subscriptions WHERE id=$1", [job.subscription_id])).rows[0];
      if (!sub || sub.status !== "active") return await skipJob(job.id, "subscription_inactive"), true;
      const campaign = (await client.queryObject<Row>("SELECT * FROM newsletter_campaigns WHERE id=$1", [job.campaign_id])).rows[0];
      if (!campaign || sub.cadence !== campaign.kind && !(campaign.kind === "immediate" && sub.cadence === "immediate")) return await skipJob(job.id, "preferences_changed"), true;
      const rows = await client.queryObject<Row>(`SELECT ci.snapshot,e.content_type,e.first_published_at,e.source_type,e.source_id
        FROM newsletter_campaign_items ci JOIN newsletter_publication_events e ON e.id=ci.publication_event_id
        WHERE ci.campaign_id=$1 AND e.state='active' AND ((e.content_type='news' AND $2 AND e.first_published_at>=$4) OR
          (e.content_type='papers' AND $3 AND e.first_published_at>=$5)) ORDER BY e.first_published_at DESC`,
        [campaign.id, sub.wants_news, sub.wants_papers, sub.news_opted_in_at, sub.papers_opted_in_at]);
      const rendered = renderItems(rows.rows, campaign.kind === "weekly");
      if (!rendered.selected.length) return await skipJob(job.id, "no_eligible_content"), true;
      const messageLinks = await links(sub);
      const subject = campaign.kind === "weekly" ? `PeAS Repository Updates — Week of ${new Date(campaign.period_end).toLocaleDateString("en-PH")}`
        : `${rows.rows[0].content_type === "news" ? "New from PeAS" : "New paper in PeAS"}: ${rows.rows[0].snapshot.title}`;
      const footerText = `\n\nManage preferences: ${messageLinks.manageUrl}\nUnsubscribe: ${messageLinks.unsubscribeUrl}`;
      const footerHtml = `<hr><p><a href="${escapeNewsletterHtml(messageLinks.manageUrl)}">Manage preferences</a> · <a href="${escapeNewsletterHtml(messageLinks.unsubscribeUrl)}">Unsubscribe</a></p>`;
      await sendNewsletterMessage({ recipient: sub.email, subject, text: rendered.text + footerText, html: `<main><h1>${escapeNewsletterHtml(subject)}</h1>${rendered.html}${footerHtml}</main>`, ...messageLinks });
      await client.queryArray("UPDATE newsletter_subscriptions SET last_delivered_at=clock_timestamp(),consecutive_delivery_failures=0 WHERE id=$1", [sub.id]);
      await client.queryArray("UPDATE newsletter_publication_events SET delivered_once=true WHERE id IN(SELECT publication_event_id FROM newsletter_campaign_items WHERE campaign_id=$1)", [campaign.id]);
    }
    await client.queryArray("UPDATE newsletter_mail_jobs SET status='sent',sent_at=clock_timestamp(),terminal_at=clock_timestamp(),error_code=NULL,error_detail=NULL WHERE id=$1", [job.id]);
    if (job.campaign_id) await refreshCampaign(job.campaign_id);
  } catch (error) { await failJob(job, error); }
  return true;
}

async function skipJob(id: number, code: string) {
  await client.queryArray("UPDATE newsletter_mail_jobs SET status='skipped',terminal_at=clock_timestamp(),error_code=$2 WHERE id=$1", [id, code]);
}
async function refreshCampaign(id: number) {
  await client.queryArray(`UPDATE newsletter_campaigns c SET sent_count=x.sent,skipped_count=x.skipped,failed_count=x.failed,
    status=CASE WHEN x.open=0 THEN 'completed' ELSE 'processing' END,started_at=COALESCE(started_at,clock_timestamp()),
    completed_at=CASE WHEN x.open=0 THEN clock_timestamp() ELSE NULL END FROM (
      SELECT count(*) FILTER(WHERE status='sent') sent,count(*) FILTER(WHERE status='skipped') skipped,
      count(*) FILTER(WHERE status='failed') failed,count(*) FILTER(WHERE status IN('queued','processing')) open
      FROM newsletter_mail_jobs WHERE campaign_id=$1) x WHERE c.id=$1`, [id]);
}
async function failJob(job: Row, error: unknown) {
  const raw = String((error as Error)?.message || error).slice(0, 200);
  const configFailure = /auth|tls|certificate|relay|sender/i.test(raw);
  const permanent = /recipient|mailbox|user unknown|5\.1\.[01]/i.test(raw);
  const terminal = permanent || Number(job.attempts) >= 5;
  const delay = retryMinutes[Math.min(Math.max(Number(job.attempts) - 1, 0), retryMinutes.length - 1)];
  await client.queryArray(`UPDATE newsletter_mail_jobs SET status=$2,available_at=clock_timestamp()+($3||' minutes')::interval,
    terminal_at=CASE WHEN $2='failed' THEN clock_timestamp() ELSE NULL END,error_code=$4,error_detail=$5 WHERE id=$1`,
    [job.id, terminal ? "failed" : "queued", delay, configFailure ? "smtp_configuration" : permanent ? "recipient_rejected" : "smtp_transient", raw.replace(/[\w.+-]+@[\w.-]+/g, "[redacted]")]);
  if (permanent && job.subscription_id) await client.queryArray("UPDATE newsletter_subscriptions SET status='suppressed',suppressed_at=clock_timestamp(),suppression_reason='permanent_delivery_rejection' WHERE id=$1", [job.subscription_id]);
  if (configFailure) await client.queryArray("UPDATE newsletter_settings SET delivery_paused=true,pause_reason='SMTP configuration failure' WHERE id=true");
  if (job.campaign_id) await refreshCampaign(job.campaign_id);
}

export async function cleanupNewsletterData(): Promise<void> {
  await withTransaction(async (db) => {
    await db.queryArray("DELETE FROM newsletter_verification_requests WHERE used_at IS NULL AND expires_at<clock_timestamp()-interval '2 days'");
    await db.queryArray("DELETE FROM newsletter_mail_jobs WHERE kind='test' AND created_at<clock_timestamp()-interval '24 hours'");
    // Campaign totals remain on newsletter_campaigns; old recipient-level rows
    // can therefore be removed wholesale without retaining a subscriber link.
    await db.queryArray(`DELETE FROM newsletter_mail_jobs WHERE kind='campaign'
      AND status IN ('sent','failed','skipped') AND created_at<clock_timestamp()-interval '90 days'`);
    await db.queryArray(`DELETE FROM newsletter_subscriptions s WHERE status<>'active'
      AND COALESCE(s.unsubscribed_at,s.suppressed_at,s.created_at)<clock_timestamp()-interval '30 days'
      AND NOT EXISTS(SELECT 1 FROM newsletter_mail_jobs j WHERE j.subscription_id=s.id AND j.status IN('queued','processing'))`);
  });
}

export async function getNewsletterAdminSummary() {
  const counts = (await client.queryObject<Row>(`SELECT count(*) FILTER(WHERE status='active') active,
    count(*) FILTER(WHERE status='pending') pending,count(*) FILTER(WHERE status='active' AND cadence='weekly') weekly,
    count(*) FILTER(WHERE status='active' AND cadence='immediate') immediate,
    count(*) FILTER(WHERE status='active' AND wants_news) news,count(*) FILTER(WHERE status='active' AND wants_papers) papers
    FROM newsletter_subscriptions`)).rows[0];
  const queue = (await client.queryObject<Row>(`SELECT count(*) FILTER(WHERE status='queued') queued,
    count(*) FILTER(WHERE status='failed') failed,min(created_at) FILTER(WHERE status='queued') oldest FROM newsletter_mail_jobs`)).rows[0];
  const settings = (await client.queryObject<Row>("SELECT * FROM newsletter_settings WHERE id=true")).rows[0];
  return { counts, queue, settings, nextWeeklySend: new Date(latestManilaMondayCutoff().getTime() + 7 * 86400000).toISOString() };
}

export async function listNewsletterSubscriptions(params: URLSearchParams) {
  const page = Math.max(1, Number(params.get("page")) || 1), size = Math.min(100, Math.max(1, Number(params.get("size")) || 25));
  const q = `%${params.get("q")?.trim().toLowerCase() || ""}%`, status = params.get("status") || "", cadence = params.get("cadence") || "";
  const result = await client.queryObject<Row>(`SELECT id,email,status,cadence,wants_news,wants_papers,confirmed_at,last_delivered_at,consecutive_delivery_failures,
    count(*) OVER() total_count FROM newsletter_subscriptions WHERE email_normalized LIKE $1 AND ($2='' OR status=$2) AND ($3='' OR cadence=$3)
    ORDER BY created_at DESC LIMIT $4 OFFSET $5`, [q, status, cadence, size, (page - 1) * size]);
  return { items: result.rows, total: Number(result.rows[0]?.total_count || 0), page, size };
}

export async function listNewsletterCampaigns(params: URLSearchParams) {
  const page = Math.max(1, Number(params.get("page")) || 1), size = 25;
  const result = await client.queryObject<Row>(`SELECT c.*,count(ci.id) item_count,count(*) OVER() total_count FROM newsletter_campaigns c
    LEFT JOIN newsletter_campaign_items ci ON ci.campaign_id=c.id GROUP BY c.id ORDER BY c.created_at DESC LIMIT $1 OFFSET $2`, [size, (page - 1) * size]);
  return { items: result.rows, total: Number(result.rows[0]?.total_count || 0), page, size };
}

export async function getNewsletterCampaign(id: number) {
  const campaign = (await client.queryObject<Row>("SELECT * FROM newsletter_campaigns WHERE id=$1", [id])).rows[0];
  if (!campaign) return null;
  const jobs = await client.queryObject<Row>(`SELECT j.id,j.status,j.attempts,j.error_code,j.sent_at,
    CASE WHEN j.created_at>clock_timestamp()-interval '90 days' THEN s.email ELSE NULL END email
    FROM newsletter_mail_jobs j LEFT JOIN newsletter_subscriptions s ON s.id=j.subscription_id WHERE j.campaign_id=$1 ORDER BY j.id`, [id]);
  return { campaign, jobs: jobs.rows };
}

export async function setNewsletterSettings(input: { signupEnabled?: boolean; deliveryPaused?: boolean; pauseReason?: string }, adminId: string) {
  await client.queryArray(`UPDATE newsletter_settings SET signup_enabled=COALESCE($1,signup_enabled),delivery_paused=COALESCE($2,delivery_paused),
    pause_reason=CASE WHEN COALESCE($2,delivery_paused) THEN COALESCE($3,pause_reason) ELSE NULL END,updated_by=$4 WHERE id=true`,
    [input.signupEnabled ?? null, input.deliveryPaused ?? null, input.pauseReason ?? null, adminId]);
}

export async function adminSubscriptionAction(id: string, action: "suppress" | "allow" | "delete" | "resend", reason?: string) {
  if (action === "delete") { await client.queryArray("DELETE FROM newsletter_subscriptions WHERE id=$1", [id]); return; }
  if (action === "suppress") { await client.queryArray("UPDATE newsletter_subscriptions SET status='suppressed',suppressed_at=clock_timestamp(),suppression_reason=$2 WHERE id=$1", [id, reason || "Administrator suppression"]); return; }
  if (action === "allow") { await client.queryArray("UPDATE newsletter_subscriptions SET status='unsubscribed',suppressed_at=NULL,suppression_reason=NULL,unsubscribed_at=clock_timestamp(),token_version=token_version+1 WHERE id=$1 AND status='suppressed'", [id]); return; }
  const sub = (await client.queryObject<Row>("SELECT * FROM newsletter_subscriptions WHERE id=$1", [id])).rows[0];
  if (!sub || sub.status !== "pending") return;
  await requestNewsletterConfirmation({ email: sub.email, preferences: { cadence: sub.cadence, news: sub.wants_news, papers: sub.wants_papers } });
}

export async function retryNewsletterJob(id: number) {
  await client.queryArray("UPDATE newsletter_mail_jobs SET status='queued',available_at=clock_timestamp(),terminal_at=NULL WHERE id=$1 AND status='failed'", [id]);
}
export async function queueNewsletterTest(email: string) {
  await client.queryArray("INSERT INTO newsletter_mail_jobs(kind,recipient_email) VALUES('test',$1)", [email]);
}
