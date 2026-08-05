import { startAbstractWorker } from "./services/abstractExtractionWorkerService.ts";

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
