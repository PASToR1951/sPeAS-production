import { Router } from "../deps.ts";

const retiredDocumentRequestRoutes = new Router();

retiredDocumentRequestRoutes.all("/api/document-requests(/.*)?", (ctx) => {
  ctx.response.status = 410;
  ctx.response.headers.set("Cache-Control", "no-store");
  ctx.response.headers.set("Deprecation", "true");
  ctx.response.body = {
    error: "Document access requests have been retired.",
    message: "Public repository documents can now be downloaded directly from their document pages.",
    repository_url: "/pages/searchResultsPage.html",
  };
});

export default retiredDocumentRequestRoutes;
