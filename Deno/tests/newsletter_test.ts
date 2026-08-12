import { assertEquals, assertRejects, assertThrows } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import {
  escapeNewsletterHtml, latestManilaMondayCutoff, maskNewsletterEmail,
  normalizeNewsletterEmail, signNewsletterToken, validateNewsletterInput,
  verifyNewsletterToken,
} from "../shared/newsletter.ts";

Deno.test("newsletter normalizes and validates explicit consent", () => {
  assertEquals(normalizeNewsletterEmail("  Person@Example.ORG "), "person@example.org");
  assertEquals(validateNewsletterInput({ email: " Person@Example.ORG ", preferences: { cadence: "weekly", news: true, papers: false }, consent: true, consentNoticeVersion: "repository-updates-v1" }).email, "person@example.org");
  assertThrows(() => validateNewsletterInput({ email: "x@example.org", preferences: { cadence: "weekly", news: false, papers: false }, consent: true, consentNoticeVersion: "repository-updates-v1" }));
  assertThrows(() => validateNewsletterInput({ email: "x@example.org", preferences: { cadence: "weekly", news: true, papers: false }, consent: false, consentNoticeVersion: "repository-updates-v1" }));
});

Deno.test("newsletter tokens are purpose-bound and reject tampering", async () => {
  Deno.env.set("NEWSLETTER_TOKEN_SECRET", "unit-test-secret-that-is-long-and-unique");
  const token = await signNewsletterToken({ id: "record-id", purpose: "manage", version: 4 });
  assertEquals(await verifyNewsletterToken(token, "manage"), { id: "record-id", version: 4, expiresAt: null });
  await assertRejects(() => verifyNewsletterToken(token, "unsubscribe"));
  await assertRejects(() => verifyNewsletterToken(token.slice(0, -1) + "x", "manage"));
});

Deno.test("newsletter confirmation tokens expire", async () => {
  Deno.env.set("NEWSLETTER_TOKEN_SECRET", "unit-test-secret-that-is-long-and-unique");
  const token = await signNewsletterToken({ id: "verification", purpose: "confirm", expiresAt: new Date(Date.now() - 1) });
  await assertRejects(() => verifyNewsletterToken(token, "confirm"), Error, "expired_token");
});

Deno.test("weekly cutoff is Monday 9 AM Asia Manila", () => {
  assertEquals(latestManilaMondayCutoff(new Date("2026-08-12T09:00:00Z")).toISOString(), "2026-08-10T01:00:00.000Z");
  assertEquals(latestManilaMondayCutoff(new Date("2026-08-10T00:30:00Z")).toISOString(), "2026-08-03T01:00:00.000Z");
});

Deno.test("newsletter output masks addresses and escapes snapshots", () => {
  assertEquals(maskNewsletterEmail("person@example.org"), "p*****@example.org");
  assertEquals(escapeNewsletterHtml(`<script>"x"</script>`), "&lt;script&gt;&quot;x&quot;&lt;/script&gt;");
});
