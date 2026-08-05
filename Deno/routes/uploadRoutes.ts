// Routes for file uploads

import { Router } from "../deps.ts";
import { handleFileUpload } from "../controllers/uploadController.ts";
import { isAuthenticated, isAdmin, requireCapability } from "../middleware/authMiddleware.ts";

// Create a router
const router = new Router();
const requireDocumentUpload = requireCapability("documents:upload");

// Route for file uploads (admin only)
router.post("/api/upload", isAuthenticated, isAdmin, async (ctx) => {
  try {
    // Handle the upload using the upload controller
    await handleFileUpload(ctx);
  } catch (error) {
    ctx.response.status = 500;
    ctx.response.body = {
      error: "Failed to handle file upload",
      details: error instanceof Error ? error.message : String(error)
    };
  }
});

// Restricted upload route for content publishers. It only accepts new PDFs,
// chooses the storage path server-side, and cannot replace files or avatars.
router.post("/api/content/upload", isAuthenticated, requireDocumentUpload, async (ctx) => {
  try {
    await handleFileUpload(ctx, { documentOnly: true });
  } catch (error) {
    ctx.response.status = 500;
    ctx.response.body = {
      error: "Failed to handle document upload",
      details: error instanceof Error ? error.message : String(error),
    };
  }
});

// Export the router
export const uploadRoutes = router;
export const uploadRoutesAllowedMethods = router.allowedMethods();
