import { Router } from "../deps.ts";
import { getAdminDashboard, getAdminOperationalReport, getAdminTopActivity, exportAdminTopActivity, getLegacyStatistics, exportOperationalReport, deprecatedExportEndpoint } from "../controllers/reportsController.ts";
import { exportAdminSearchAnalytics, getAdminSearchAnalytics } from "../controllers/searchAnalyticsController.ts";
import { isAuthenticated, requireCapability } from "../middleware/authMiddleware.ts";

const router = new Router();

// Canonical administrator reporting routes.
router
  .get("/api/admin/dashboard", isAuthenticated, requireCapability("reports:view"), getAdminDashboard)
  .get("/api/admin/reports/operational", isAuthenticated, requireCapability("reports:view"), getAdminOperationalReport)
  .get("/api/admin/reports/operational/export", isAuthenticated, requireCapability("reports:export"), exportOperationalReport)
  .get("/api/admin/reports/top-activity/:kind/export", isAuthenticated, requireCapability("reports:export"), exportAdminTopActivity)
  .get("/api/admin/reports/top-activity/:kind", isAuthenticated, requireCapability("reports:view"), getAdminTopActivity)
  .get("/api/admin/reports/search-analytics/export", isAuthenticated, requireCapability("reports:export"), exportAdminSearchAnalytics)
  .get("/api/admin/reports/search-analytics", isAuthenticated, requireCapability("reports:view"), getAdminSearchAnalytics)
  .post("/api/reports/export-pdf", isAuthenticated, requireCapability("reports:export"), deprecatedExportEndpoint)
  .post("/api/reports/export-csv", isAuthenticated, requireCapability("reports:export"), deprecatedExportEndpoint)
  .get("/api/documents/statistics", isAuthenticated, requireCapability("reports:view"), getLegacyStatistics)
  .get("/api/stats/summary", isAuthenticated, requireCapability("reports:view"), getLegacyStatistics);

export default router;
