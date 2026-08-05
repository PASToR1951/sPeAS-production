import { Router } from "https://deno.land/x/oak@v12.6.1/mod.ts";
import { SystemLogsController } from "../controllers/systemLogsController.ts";
import { isAuthenticated, requireCapability } from "../middleware/authMiddleware.ts";

// Initialize the system logs controller
await SystemLogsController.initialize();

// Create a router instance
const router = new Router();
const requireSystemAdmin = requireCapability("system:admin");

// Define routes
router
  .get("/api/system-logs", isAuthenticated, requireSystemAdmin, SystemLogsController.getLogs)
  .get("/api/system-logs/summary", isAuthenticated, requireSystemAdmin, SystemLogsController.getLogSummary)
  .post("/api/system-logs", isAuthenticated, requireSystemAdmin, SystemLogsController.createLog);

// Allow these HTTP methods for CORS
const systemLogsAllowedMethods = ["GET", "POST", "OPTIONS"];

// Export router as routes() function to match other modules
export const systemLogsRoutes = router.routes();
export { systemLogsAllowedMethods };
