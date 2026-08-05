import { ensureNewsTableExists } from "./services/newsService.ts";
import { cleanupNewsMedia, startNewsMediaWorker } from "./services/newsMediaService.ts";

await ensureNewsTableExists();
await startNewsMediaWorker();
setInterval(() => void cleanupNewsMedia().catch((error) => console.error("News media cleanup failed:", error)), 60 * 60 * 1000);
await new Promise<void>(() => undefined);
