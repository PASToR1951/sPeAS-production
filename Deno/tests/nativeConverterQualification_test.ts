import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { nativeQualificationMatches } from "../services/nativeConverterQualification.ts";

Deno.test("native conversion fails closed for stale or synthetic qualification", () => {
  const current = { launcherSha256: "a".repeat(64), engineSha256: "b".repeat(64), engineLauncherSha256: "d".repeat(64), fontManifestSha256: "c".repeat(64), serviceSid: "S-1-5-18", version: "qualified-version" };
  const receipt = { ...current, schemaVersion: 1, mode: "qualified", isolationPassed: true, layoutReviewed: true, startupVerified: true, restartVerified: true };
  assertEquals(nativeQualificationMatches(receipt, current), true);
  for (const key of Object.keys(current)) assertEquals(nativeQualificationMatches({ ...receipt, [key]: "changed" }, current), false);
  for (const key of ["layoutReviewed", "startupVerified", "restartVerified", "isolationPassed"]) assertEquals(nativeQualificationMatches({ ...receipt, [key]: false }, current), false);
  assertEquals(nativeQualificationMatches({ ...receipt, mode: "synthetic" }, current), false);
  assertEquals(nativeQualificationMatches({ ...receipt, mode: "synthetic" }, current, true), true);
});
