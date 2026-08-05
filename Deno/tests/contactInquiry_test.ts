import { assertEquals, assertMatch } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { contactNotificationRetryDecision, escapeContactHtml, generateContactReferenceCode, isContactStatusTransitionAllowed, validateContactInquiry } from "../shared/contactInquiry.ts";

Deno.test("contact validation trims accepted values", () => {
  const result = validateContactInquiry({
    firstName: " Jane ", lastName: " Doe ", email: " jane@example.com ",
    subject: " Repository access ", message: " Please help with repository access. ",
  });
  assertEquals(result.success, true);
  if (result.success) assertEquals(result.value.firstName, "Jane");
});

Deno.test("contact validation rejects short and malformed input", () => {
  const result = validateContactInquiry({ firstName: "", lastName: "D", email: "bad", subject: "x", message: "short" });
  assertEquals(result.success, false);
  if (!result.success) assertEquals(Object.keys(result.errors).sort(), ["email", "firstName", "message", "subject"]);
});

Deno.test("contact references are random human-facing codes", () => {
  const reference = generateContactReferenceCode(new Date("2026-07-14T00:00:00Z"));
  assertMatch(reference, /^PEAS-20260714-[0-9A-F]{8}$/);
});

Deno.test("contact notification retries use the durable schedule and stop after five attempts", () => {
  assertEquals([1, 2, 3, 4].map((attempt) => contactNotificationRetryDecision(attempt).retryMinutes), [1, 5, 15, 60]);
  assertEquals(contactNotificationRetryDecision(4).failed, false);
  assertEquals(contactNotificationRetryDecision(5).failed, true);
});

Deno.test("contact email HTML escapes visitor content", () => {
  assertEquals(escapeContactHtml(`<img src=x onerror="alert('x')">`), "&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt;");
});

Deno.test("contact status transitions preserve the triage workflow", () => {
  assertEquals(isContactStatusTransitionAllowed("new", "read"), true);
  assertEquals(isContactStatusTransitionAllowed("resolved", "read"), true);
  assertEquals(isContactStatusTransitionAllowed("spam", "read"), true);
  assertEquals(isContactStatusTransitionAllowed("resolved", "new"), false);
  assertEquals(isContactStatusTransitionAllowed("read", "new"), false);
});
