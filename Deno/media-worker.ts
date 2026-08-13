import { ensureNewsTableExists } from "./services/newsService.ts";
import { cleanupNewsMedia, startNewsMediaWorker } from "./services/newsMediaService.ts";

if ((Deno.env.get("PEAS_RECOVERY_MODE") ?? "false").toLowerCase() === "true") {
  console.log("News media worker disabled in PeAS recovery mode");
  Deno.exit(0);
}
await ensureNewsTableExists();
await startNewsMediaWorker();
setInterval(() => void cleanupNewsMedia().catch((error) => console.error("News media cleanup failed:", error)), 60 * 60 * 1000);
await new Promise<void>(() => undefined);
