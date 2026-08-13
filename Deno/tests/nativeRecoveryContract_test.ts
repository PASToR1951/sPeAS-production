import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isMutationMethod } from "../services/maintenanceState.ts";

Deno.test("maintenance mode classifies every mutating HTTP method", () => {
  for (const method of ["GET", "HEAD", "OPTIONS"]) assertEquals(isMutationMethod(method), false);
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) assert(isMutationMethod(method));
});

Deno.test("native recovery command exposes the documented fail-safe contract", async () => {
  const script = await Deno.readTextFile(new URL("../../ops/peas-native-recovery.ps1", import.meta.url));
  for (const action of ["Install", "Backup", "Status", "Verify", "Restore", "Drill", "Activate", "Maintain", "Archive"]) {
    assertStringIncludes(script, `'${action}'`);
  }
  assertStringIncludes(script, "Global\\PeAS-Native-Recovery");
  assertStringIncludes(script, "maintenance-ack-supervisor.json");
  assertStringIncludes(script, "pg_dumpall");
  assertStringIncludes(script, "--no-role-passwords");
  assertStringIncludes(script, "New-ShadowCopy");
  assertStringIncludes(script, "--keep-tag','legal-hold");
  assertStringIncludes(script, "RESTORE-VALIDATED.txt");
  assertStringIncludes(script, "Automated activation is intentionally blocked");
  const restore = script.slice(script.indexOf("function Invoke-Restore"), script.indexOf("function Invoke-Drill"));
  assert(restore.indexOf("Snapshot -notmatch") < restore.indexOf("Assert-RestoreTarget"), "snapshot validation must precede target creation");
});

Deno.test("native supervisor owns child quiescence and restart", async () => {
  const supervisor = await Deno.readTextFile(new URL("../../scripts/peas-boot-daemon.ps1", import.meta.url));
  assertStringIncludes(supervisor, "Get-ActiveMaintenanceRequest");
  assertStringIncludes(supervisor, "Write-MaintenanceAcknowledgement");
  assertStringIncludes(supervisor, "stopping PeAS writer processes");
  assertStringIncludes(supervisor, "restarted after maintenance");
});
