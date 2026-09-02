import { Context, Router } from "../deps.ts";

const retiredNewsletterRoutes = new Router();

function retire(ctx: Context) {
  ctx.response.status = 410;
  ctx.response.headers.set("Cache-Control", "no-store");
  ctx.response.headers.set("Deprecation", "true");
  ctx.response.headers.set("X-Robots-Tag", "noindex");

  const message = "PeAS Repository Updates has been discontinued. No further newsletter messages will be sent.";
  if ((ctx.request.headers.get("accept") || "").includes("text/html")) {
    ctx.response.type = "text/html";
    ctx.response.body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Repository updates discontinued</title></head><body><main><h1>Repository updates discontinued</h1><p>${message}</p><p>Stored newsletter records are inaccessible and scheduled for deletion after the rollback window.</p><p><a href="/news.html">Visit PeAS News</a></p></main></body></html>`;
    return;
  }

  ctx.response.type = "application/json";
  ctx.response.body = {
    error: "newsletter_retired",
    message,
    successor_url: "/news.html",
  };
}

retiredNewsletterRoutes.all("/newsletter.html", retire);
retiredNewsletterRoutes.all("/admin/Components/newsletter.html", retire);
retiredNewsletterRoutes.all("/api/newsletter(/.*)?", retire);
retiredNewsletterRoutes.all("/api/admin/newsletter(/.*)?", retire);

export default retiredNewsletterRoutes;
