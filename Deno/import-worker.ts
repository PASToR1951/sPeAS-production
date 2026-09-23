import {
  claimImportJob,
  importWorkerDiagnostics,
  processImportJob,
  purgeAbandonedImportCopies,
  purgeExpiredImports,
  recoverImportJobs,
} from "./services/importWorkerService.ts";
import { importEnabled } from "./services/importStorageService.ts";
import { client } from "./db/denopost_conn.ts";
const workerId = `import-${crypto.randomUUID()}`;
let stopped = false;
Deno.addSignalListener("SIGINT", () => {
  stopped = true;
});
if (Deno.build.os !== "windows") {
  Deno.addSignalListener("SIGTERM", () => {
    stopped = true;
  });
}
console.log("Import worker started", workerId);
let diagnosed = false;
let lastCopyCleanup = 0;
while (!stopped) {
  try {
    if (!diagnosed) {
      await importWorkerDiagnostics(workerId);
      diagnosed = true;
    }
    await client.queryArray(
      "UPDATE import_worker_state SET heartbeat_at=now() WHERE worker_id=$1",
      [workerId],
    );
    await recoverImportJobs();
    await purgeExpiredImports();
    if (Date.now() - lastCopyCleanup > 60_000) {
      await purgeAbandonedImportCopies();
      lastCopyCleanup = Date.now();
    }
    if (importEnabled()) {
      const job = await claimImportJob(workerId);
      if (job) {
        await processImportJob(job);
        continue;
      }
    }
  } catch (error) {
    console.error(
      "Import worker cycle failed",
      error instanceof Error ? error.message : "unknown",
    );
  }
  await new Promise((resolve) => setTimeout(resolve, 2_000));
}
Deno.exit(0);
