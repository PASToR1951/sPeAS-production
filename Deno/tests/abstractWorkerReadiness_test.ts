import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { abstractWorkerDiagnostics, dependencyErrorCode, isDependencyFailure } from "../services/abstractWorkerReadiness.ts";

Deno.test("extraction readiness requires a fresh worker and dependency check", () => {
  const now = Date.now();
  const recent = new Date(now - 1000);
  const state = { last_heartbeat_at: recent, dependencies_ready: true, dependency_error_code: null, dependencies_checked_at: recent };
  assertEquals(abstractWorkerDiagnostics(state, now).extractionReady, true);
  assertEquals(abstractWorkerDiagnostics({ ...state, dependencies_ready: false }, now).extractionReady, false);
  assertEquals(abstractWorkerDiagnostics({ ...state, last_heartbeat_at: new Date(now - 120_000) }, now).extractionReady, false);
  assertEquals(abstractWorkerDiagnostics({ ...state, dependencies_checked_at: null }, now).extractionReady, false);
  assertEquals(abstractWorkerDiagnostics(undefined, now).errorCode, "ABSTRACT_WORKER_OFFLINE");
});

Deno.test("dependency failures pause work instead of consuming transient retries", () => {
  for (const code of ["PDFINFO_UNAVAILABLE", "PDFTOTEXT_UNAVAILABLE", "TESSERACT_UNAVAILABLE", "COMMAND_START_FAILED", "ABSTRACT_OCR_LANGUAGE_UNAVAILABLE:fil"]) assertEquals(isDependencyFailure(code), true);
  assertEquals(isDependencyFailure("ABSTRACT_TIMEOUT"), false);
  assertEquals(dependencyErrorCode(new Error("secret installation path")), "ABSTRACT_DEPENDENCY_UNAVAILABLE");
});
