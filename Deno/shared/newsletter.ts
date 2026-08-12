export const NEWSLETTER_CONSENT_VERSION = "repository-updates-v1" as const;
export type NewsletterCadence = "immediate" | "weekly";
export type NewsletterTokenPurpose = "confirm" | "manage" | "unsubscribe" | "one-click";

export interface NewsletterPreferences {
  cadence: NewsletterCadence;
  news: boolean;
  papers: boolean;
}

export function normalizeNewsletterEmail(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

export function validateNewsletterInput(value: unknown): {
  email: string;
  preferences: NewsletterPreferences;
  consent: true;
} {
  const body = (value && typeof value === "object") ? value as Record<string, unknown> : {};
  const preferences = (body.preferences && typeof body.preferences === "object")
    ? body.preferences as Record<string, unknown>
    : {};
  const email = normalizeNewsletterEmail(body.email);
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("email");
  }
  if (preferences.cadence !== "immediate" && preferences.cadence !== "weekly") {
    throw new Error("cadence");
  }
  if (typeof preferences.news !== "boolean" || typeof preferences.papers !== "boolean" ||
    (!preferences.news && !preferences.papers)) throw new Error("content");
  if (body.consent !== true || body.consentNoticeVersion !== NEWSLETTER_CONSENT_VERSION) {
    throw new Error("consent");
  }
  return {
    email,
    preferences: {
      cadence: preferences.cadence,
      news: preferences.news,
      papers: preferences.papers,
    },
    consent: true,
  };
}

export function maskNewsletterEmail(email: string): string {
  const [local, domain = ""] = email.split("@");
  return `${local.slice(0, 1)}${"*".repeat(Math.max(2, local.length - 1))}@${domain}`;
}

export function escapeNewsletterHtml(value: unknown): string {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function decodeBase64Url(value: string): Uint8Array {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/") + "===".slice((value.length + 3) % 4);
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

function secret(): string {
  const direct = Deno.env.get("NEWSLETTER_TOKEN_SECRET")?.trim();
  if (direct) return direct;
  const path = Deno.env.get("NEWSLETTER_TOKEN_SECRET_FILE");
  if (path) {
    try { return Deno.readTextFileSync(path).trim(); } catch { /* handled below */ }
  }
  throw new Error("NEWSLETTER_TOKEN_SECRET is not configured");
}

async function signature(payload: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret()),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)));
}

export async function signNewsletterToken(input: {
  id: string; purpose: NewsletterTokenPurpose; version?: number; expiresAt?: Date;
}): Promise<string> {
  const payload = `${input.purpose}.${input.id}.${input.version ?? 0}.${input.expiresAt?.getTime() ?? 0}`;
  return `${base64Url(new TextEncoder().encode(payload))}.${base64Url(await signature(payload))}`;
}

export async function verifyNewsletterToken(token: string, expected: NewsletterTokenPurpose): Promise<{
  id: string; version: number; expiresAt: Date | null;
}> {
  const [payloadPart, signaturePart, extra] = String(token ?? "").split(".");
  if (!payloadPart || !signaturePart || extra) throw new Error("invalid_token");
  let payload = "";
  try { payload = new TextDecoder().decode(decodeBase64Url(payloadPart)); } catch { throw new Error("invalid_token"); }
  const actual = decodeBase64Url(signaturePart);
  const expectedSignature = await signature(payload);
  if (actual.length !== expectedSignature.length) throw new Error("invalid_token");
  let difference = 0;
  for (let i = 0; i < actual.length; i++) difference |= actual[i] ^ expectedSignature[i];
  if (difference !== 0) throw new Error("invalid_token");
  const [purpose, id, versionText, expiryText] = payload.split(".");
  if (purpose !== expected || !id) throw new Error("invalid_token");
  const version = Number(versionText);
  const expiry = Number(expiryText);
  if (!Number.isSafeInteger(version) || !Number.isSafeInteger(expiry)) throw new Error("invalid_token");
  if (expiry > 0 && Date.now() > expiry) throw new Error("expired_token");
  return { id, version, expiresAt: expiry > 0 ? new Date(expiry) : null };
}

export function latestManilaMondayCutoff(now = new Date()): Date {
  const manila = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const day = manila.getUTCDay();
  const daysSinceMonday = (day + 6) % 7;
  const cutoffLocal = Date.UTC(manila.getUTCFullYear(), manila.getUTCMonth(), manila.getUTCDate() - daysSinceMonday, 9);
  let cutoff = new Date(cutoffLocal - 8 * 60 * 60 * 1000);
  if (cutoff > now) cutoff = new Date(cutoff.getTime() - 7 * 86400000);
  return cutoff;
}
