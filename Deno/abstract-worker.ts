import { startAbstractWorker } from "./services/abstractExtractionWorkerService.ts";

if ((Deno.env.get("PEAS_RECOVERY_MODE") ?? "false").toLowerCase() === "true") {
  console.log("Abstract worker disabled in PeAS recovery mode");
  Deno.exit(0);
}
const stop = await startAbstractWorker();
console.log("Abstract extraction worker started");

await new Promise<void>((resolve) => {
  const shutdown = () => {
    stop();
    resolve();
  };
  Deno.addSignalListener("SIGINT", shutdown);
  Deno.addSignalListener("SIGTERM", shutdown);
});
