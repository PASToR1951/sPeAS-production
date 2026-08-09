import { Router } from "https://deno.land/x/oak@v12.6.1/mod.ts";
import { DocumentRequestController } from "../controllers/documentRequestController.ts";
import { isAuthenticated, isAdmin } from "../middleware/authMiddleware.ts";
import { rateLimit } from "../middleware/rateLimit.ts";

const requestSubmissionRateLimit = rateLimit({ windowMs: 60 * 60_000, max: 5, name: "document-request", message: "Too many access requests. Please try again later." });

export function createDocumentRequestRoutes(controller: DocumentRequestController): Router {
    const router = new Router();

    // Public routes
    router.post("/api/document-requests", requestSubmissionRateLimit, controller.createRequest.bind(controller));
    router.get("/api/document-requests/verify", controller.verifyRequestEmail.bind(controller));
    router.get("/api/document-requests/:id/download", controller.downloadApprovedDocument.bind(controller));
    router.get("/api/document-requests/:id/access", controller.downloadApprovedDocument.bind(controller));

    // Admin routes
    router.get("/api/document-requests", isAuthenticated, isAdmin, controller.getAllRequests.bind(controller));
    router.get("/api/document-requests/status/:status", isAuthenticated, isAdmin, controller.getRequestsByStatus.bind(controller));
    router.get("/api/documents/:documentId/requests", isAuthenticated, isAdmin, controller.getRequestsByDocumentId.bind(controller));
    router.patch("/api/document-requests/:id/status", isAuthenticated, isAdmin, controller.updateRequestStatus.bind(controller));
    router.post("/api/document-requests/bulk-approve", isAuthenticated, isAdmin, controller.bulkApprove.bind(controller));
    router.post("/api/document-requests/:id/resend-access", isAuthenticated, isAdmin, controller.resendAccessLink.bind(controller));
    router.delete("/api/document-requests/:id", isAuthenticated, isAdmin, controller.deleteRequest.bind(controller));

    return router;
}
