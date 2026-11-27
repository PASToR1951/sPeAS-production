// Routes for file uploads

import { Router } from "../deps.ts";
import { handleFileUpload } from "../controllers/uploadController.ts";
import { isAuthenticated, isAdmin, requireCapability } from "../middleware/authMiddleware.ts";
import { DOCUMENT_MAX_BYTES, DOCUMENT_MAX_FILES } from "../../shared/documentFormats.ts";
import { getUploadJob, listUploadJobs, saveUploadReview, retryUploadJob, uploadAsset } from "../services/uploadReviewService.ts";
import { DocumentConversionError, guidedConversionAvailable } from "../services/documentConversionService.ts";
import { client } from "../db/denopost_conn.ts";

// Create a router
const router = new Router();
const requireDocumentUpload = requireCapability("documents:upload");

// Allow updated clients to reject multi-file submissions to older web processes.
router.get("/api/content/upload/capabilities", isAuthenticated, requireDocumentUpload, async (ctx) => {
  ctx.response.headers.set("Cache-Control", "no-store");
  ctx.response.body = { stitching: true, uploadReview: true, nonPdfConversion: await guidedConversionAvailable(), maxFiles: DOCUMENT_MAX_FILES, maxBytes: DOCUMENT_MAX_BYTES };
});

const reviewRoute = (fn: (ctx: any) => Promise<unknown>) => async (ctx: any) => {
  ctx.response.headers.set("Cache-Control", "no-store");
  try { const result=await fn(ctx); if(result!==undefined) ctx.response.body=result; }
  catch(error) { ctx.response.status=error instanceof DocumentConversionError?error.status:error instanceof Deno.errors.NotFound?404:500; ctx.response.body={error:error instanceof DocumentConversionError?error.message:"Upload review is unavailable."}; }
};
router.get("/api/content/upload/jobs", isAuthenticated, requireDocumentUpload, reviewRoute(ctx=>listUploadJobs(String(ctx.state.user.id))));
router.get("/api/content/upload/jobs/for-document/:id",isAuthenticated,requireDocumentUpload,reviewRoute(async ctx=>{
  const id=Number(ctx.params.id);
  if(!Number.isSafeInteger(id)||id<=0)throw new DocumentConversionError("Invalid document.",400);
  return (await client.queryObject("SELECT id FROM upload_review_jobs WHERE document_id=$1 AND (owner_id=$2 OR $3) ORDER BY created_at DESC LIMIT 1",[id,String(ctx.state.user.id),ctx.state.user.role==="admin"])).rows[0]||null;
}));
router.get("/api/content/upload/jobs/:id", isAuthenticated, requireDocumentUpload, reviewRoute(ctx=>getUploadJob(ctx.params.id,String(ctx.state.user.id),ctx.state.user.role==="admin")));
router.put("/api/content/upload/jobs/:id/review", isAuthenticated, requireDocumentUpload, reviewRoute(async ctx=>saveUploadReview(ctx.params.id,String(ctx.state.user.id),await ctx.request.body({type:"json"}).value,ctx.state.user.role==="admin")));
router.post("/api/content/upload/jobs/:id/retry", isAuthenticated, requireDocumentUpload, reviewRoute(ctx=>retryUploadJob(ctx.params.id,String(ctx.state.user.id))));
router.get("/api/content/upload/jobs/:id/assets/:asset", isAuthenticated, requireDocumentUpload, reviewRoute(async ctx=>{
  const asset=await uploadAsset(ctx.params.id,String(ctx.state.user.id),ctx.params.asset,ctx.state.user.role==="admin");
  ctx.response.headers.set("Content-Type",asset.type);
  ctx.response.headers.set("X-Content-Type-Options","nosniff");
  ctx.response.headers.set("Content-Disposition",`${asset.type==="application/pdf"?"inline":"attachment"}; filename*=UTF-8''${encodeURIComponent(asset.name)}`);
  ctx.response.body=asset.bytes;
}));

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

// Restricted upload route for content publishers. It accepts new documents and converts them to PDF,
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
