import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isRetiredDocumentAccessLogRecord } from "../scripts/purge-document-access-logs.ts";

Deno.test("document-access log cleanup matches only retired email and job tags", () => {
  assertEquals(isRetiredDocumentAccessLogRecord({ action: "DOCUMENT_REQUEST_CONFIRMATION", recipient: "person@example.test" }, false), true);
  assertEquals(isRetiredDocumentAccessLogRecord({ action: "DOCUMENT_APPROVAL_START", recipient: "person@example.test" }, false), true);
  assertEquals(isRetiredDocumentAccessLogRecord({ action: "DOCUMENT_NOT_FOUND", recipient: "unrelated@example.test" }, false), false);
  assertEquals(isRetiredDocumentAccessLogRecord({ action: "EMAIL_SEND_ERROR", recipient: "unrelated@example.test" }, false), false);
  assertEquals(isRetiredDocumentAccessLogRecord({ type: "email", data: { jobType: "approval" } }, true), true);
  assertEquals(isRetiredDocumentAccessLogRecord({ type: "email", data: { jobType: "contact" } }, true), false);
  assertEquals(isRetiredDocumentAccessLogRecord("malformed", false), false);
});
