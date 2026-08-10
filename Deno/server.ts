// server.ts

// Environment variables are loaded (and exported to Deno.env) once by
// config/db.ts via the std dotenv loader — no separate loader here.

// -----------------------------
// SECTION: Imports
// -----------------------------
import { Application, Router, FormDataReader } from "./deps.ts";
import type { Context, RouterContext } from "./deps.ts";
import { getErrorMessage } from "./utils/errorHandler.ts";
import { ensureDir } from "https://deno.land/std@0.190.0/fs/ensure_dir.ts";
import { join, resolve } from "https://deno.land/std@0.190.0/path/mod.ts";
import { connectToDb, diagnoseDatabaseIssues } from "./db/denopost_conn.ts"; // Using connectToDb from conn.ts
import { client } from "./db/denopost_conn.ts"; // Client for database queries
import { routes } from "./routes/index.ts"; // All route handlers in one file
import { authorRoutes } from "./routes/authorRoutes.ts"; // Import author routes directly
import { researchAgendaRoutes } from "./routes/researchAgendaRoutes.ts"; // Import research agenda routes directly
import { saveFile } from "./services/uploadService.ts"; // Import file upload service
import { fetchChildDocuments } from "./services/documentService.ts"; // Import document service
import type { Document as DocumentData } from "./services/documentService.ts";
import documentAuthorRoutes from "./routes/documentAuthorRoutes.ts";
import fileRoutes from "./routes/fileRoutes.ts"; // Import file routes
import { uploadRoutes, uploadRoutesAllowedMethods } from "./routes/uploadRoutes.ts"; // Import upload routes
import reportsRoutes from "./routes/reportsRoutes.ts"; // Import reports routes
import { getLegacyStatistics } from "./controllers/reportsController.ts";
import { categoryRoutes, categoryAllowedMethods } from "./routes/categoryRoutes.ts";
import { getChildDocuments } from "./controllers/documentController.ts";
import { handleUpdateDocument } from "./api/document.ts";
import { getDocumentAuthors } from "./controllers/documentAuthorController.ts";
import { AuthorModel } from "./models/authorModel.ts";
import { DocumentModel } from "./models/documentModel.ts";
import { SystemLogsModel } from "./models/systemLogsModel.ts";
import { getDocumentClassification, replaceDocumentClassification, replaceDocumentKeywords } from "./services/documentClassificationService.ts";
import { canonicalPublicPageKey, createAnalyticsSessionCookie, isKnownCrawler, isPrefetchRequest, readAnalyticsSessionCookie, recordPublicTraffic, recordRepositoryActivity, verifyOperationalReportingSchema } from "./services/operationalReportingService.ts";
import { documentClassificationRoutes, documentClassificationAllowedMethods } from "./routes/documentClassificationRoutes.ts";
import { unifiedArchiveRoutes, unifiedArchiveAllowedMethods } from "./routes/unifiedArchiveRoutes.ts";
import { authRoutes } from "./routes/authRoutes.ts"; // Transitional logout shims
import { createDocumentRequestRoutes } from "./routes/documentRequestRoutes.ts";
import { DocumentRequestModel } from "./models/documentRequestModel.ts";
import { DocumentRequestController, processDocumentRequestEmailQueue } from "./controllers/documentRequestController.ts";
import { emailRoutes } from "./routes/emailRoutes.ts"; // Import email routes
import { authorVisitsRoutes, authorVisitsAllowedMethods } from "./routes/authorVisitsRoutes.ts"; // Import author visits routes
import { authorReferenceRoutes, authorReferenceAllowedMethods } from "./routes/authorReferenceRoutes.ts";
import { pageVisitsRoutes, pageVisitsAllowedMethods } from "./routes/pageVisitsRoutes.ts"; // Import page visits routes
import { systemLogsRoutes, systemLogsAllowedMethods } from "./routes/systemLogsRoutes.ts"; // Import system logs routes
import keywordsRoutes from "./routes/keywordsRoutes.ts"; // Import keywords routes
import searchRoutes from "./routes/searchRoutes.ts";
import { getCompiledDocument } from "./api/compiledDocument.ts";
import { handleGetUserProfileForNavbar } from "./api/user.ts"; // Import user profile handler
import { handleLibraryRequest } from "./api/userLibrary.ts"; // Import user library handler
import { handleUserProfilePictureUpload } from "./api/userProfilePicture.ts"; // Import user profile picture handler
import { isAuthenticated, isAdmin, requireCapability } from "./middleware/authMiddleware.ts"; // Authn/authz middleware
import { canModifyPendingUpload, canViewCompilation } from "./services/contentAuthorizationService.ts";
import { AuthorReferenceValidationError, listAffiliationsCompatibility, validateAuthorReferenceValues } from "./services/authorReferenceDataService.ts";
import { getSessionFromHeaders } from "./services/sessionService.ts";
import { auth } from "./config/auth.ts"; // Better Auth instance
import { webHandler } from "./utils/oakAdapter.ts"; // web Request/Response -> oak bridge
import { analyticsRateLimit } from "./middleware/rateLimit.ts"; // Per-IP rate limiting
import { STORAGE_ROOT } from "./config/storage.ts";
import experienceRoutes from "./routes/experienceRoutes.ts";
import newsRoutes from "./routes/newsRoutes.ts";
import userReadStatusRoutes from "./routes/userReadStatusRoutes.ts";
import documentAnnotationRoutes from "./routes/documentAnnotationRoutes.ts";
import { cleanupDocumentAnnotations } from "./services/documentAnnotationCleanupService.ts";
import { cleanupNewsMedia, startNewsMediaWorker } from "./services/newsMediaService.ts";
import contactInquiryRoutes from "./routes/contactInquiryRoutes.ts";
import { getContactNotificationConfiguration, startContactNotificationWorker } from "./services/contactInquiryService.ts";
import adminNotificationRoutes from "./routes/adminNotificationRoutes.ts";
import { syncAuthorProfileNotification } from "./services/authorNotificationService.ts";
import {
  getLegacyPublicReleaseId,
  recordLegacyPublicPathHit,
  registerLegacyPublicRelease,
} from "./services/legacyPublicPathService.ts";
import {
  LEGACY_PUBLIC_REDIRECTS,
  matchLegacyPublicPath,
} from "./shared/legacyPublicPaths.ts";
import { authorNameKey } from "../shared/authorName.ts";
import abstractReviewRoutes from "./routes/abstractReviewRoutes.ts";
// Import the document view controller
// TODO: Fix DocumentViewController implementation
// import { DocumentViewController } from "./controllers/documentViewController.ts";

// Import Deno standard library file API for reading migration files
// Removed - not needed after removing document views functionality

// -----------------------------
// SECTION: Configuration
// -----------------------------
const PORT = Deno.env.get("PORT") || 80;
const HOST = Deno.env.get("HOST") || "0.0.0.0";
const LEGACY_PUBLIC_RELEASE_ID = getLegacyPublicReleaseId();
const PROTECTED_DOCUMENT_FILE_PREFIXES = [
  "/storage/thesis/",
  "/storage/dissertation/",
  "/storage/confluence/",
  "/storage/synergy/",
  "/storage/hello/",
  "/storage/compiled/",
  "/storage/documents/",
  "/storage/files/",
  "/storage/uploads/",
  "/files/",
  "/uploads/",
];

function isProtectedDocumentFilePath(pathname: string): boolean {
  let normalized = pathname.replace(/\\/g, "/");

  try {
    normalized = decodeURIComponent(normalized);
  } catch {
    // Keep the original path if decoding fails.
  }

  normalized = normalized.replace(/\/{2,}/g, "/").toLowerCase();
  if (!normalized.startsWith("/")) {
    normalized = `/${normalized}`;
  }

  return PROTECTED_DOCUMENT_FILE_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

// -----------------------------
// SECTION: Server Setup
// -----------------------------
const app = new Application();
const router = new Router();
const PUBLIC_ERROR_STATUSES = new Set<number>([400, 401, 403, 404, 408, 429, 500, 503]);
// Record when the server started
export const SERVER_START_TIME = Date.now();
let serverReady = false;
const isProduction = (Deno.env.get("DENO_ENV") ?? "development").toLowerCase() === "production";

async function verifyProductionReadiness() {
  if (!isProduction) return;
  const ledger = await client.queryObject<{ present: string | null }>(
    "SELECT to_regclass('public.schema_migrations')::text AS present",
  );
  if (!ledger.rows[0]?.present) {
    throw new Error("Production database migrations have not been applied");
  }
  const required = await client.queryObject<{ missing: string | null }>(`
    SELECT required.name
    FROM unnest(ARRAY['users', 'documents', 'account', 'session', 'site_experience_versions']) AS required(name)
    WHERE to_regclass('public.' || required.name) IS NULL
    LIMIT 1
  `);
  if (required.rows[0]?.missing) {
    throw new Error(`Production schema is missing ${required.rows[0].missing}`);
  }
}

function requestAcceptsHtml(ctx: Context) {
  return (ctx.request.headers.get("accept") || "").includes("text/html");
}

async function servePublicErrorPage(ctx: Context, status: number) {
  ctx.response.status = status;
  ctx.response.headers.set("Cache-Control", "no-store");
  ctx.response.headers.set("X-Robots-Tag", "noindex");
  ctx.response.headers.set("Vary", "Accept");

  try {
    const shellPath = `${Deno.cwd()}/Public/pages/miscellaneous/error.html`;
    const shell = await Deno.readTextFile(shellPath);
    const content = shell.replace("<body>", `<body data-peas-error-status="${status}">`);
    ctx.response.type = "text/html";
    ctx.response.body = ctx.request.method === "HEAD" ? null : content;
  } catch {
    ctx.response.type = "text/plain";
    ctx.response.body = ctx.request.method === "HEAD" ? null : `${status} - Error`;
  }
}

// Legacy counter tables remain readable for compatibility endpoints, but schema
// creation is an explicit migration concern. Startup performs only a readiness
// probe so it cannot mutate reporting state on an otherwise healthy boot.
async function verifyLegacyVisitCounterTables() {
  const result = await client.queryObject<{ name: string; present: boolean }>(`
    SELECT name, to_regclass(name) IS NOT NULL AS present
    FROM unnest(ARRAY['document_visits', 'author_visits_counter', 'page_visits_counter']) AS names(name)
  `);
  const missing = result.rows.filter((row) => !row.present).map((row) => row.name);
  if (missing.length) {
    console.warn("Legacy analytics tables are unavailable; compatibility counters are disabled", { missing });
  }
}

// -----------------------------
// SECTION: Middleware (Optional)
// -----------------------------
// Error handling middleware
app.use(async (ctx, next) => {
  try {
    await next();
    if (PUBLIC_ERROR_STATUSES.has(Number(ctx.response.status)) && requestAcceptsHtml(ctx)) {
      await servePublicErrorPage(ctx, Number(ctx.response.status));
    }
  } catch (err) {
    // Log the details server-side; never echo internals back to the client.
    console.error(`Unhandled error on ${ctx.request.method} ${ctx.request.url.pathname}:`, err);
    if (requestAcceptsHtml(ctx)) {
      await servePublicErrorPage(ctx, 500);
    } else {
      ctx.response.status = 500;
      ctx.response.body = { message: "Internal server error" };
    }
  }
});

const publicAliases: Record<string, string> = {
  "/index": "/index.html",
  "/news": "/news.html",
  "/faq": "/faq.html",
  "/search": "/pages/searchResultsPage.html",
  "/contact": "/contact.html",
  "/terms": "/pages/miscellaneous/T&A-Public.html",
  "/privacy": "/pages/miscellaneous/Privacy.html",
  "/login": "/log-in.html",
  "/authors/profile": "/pages/authorprofile.html",
  "/works/detail": "/pages/guest-single.html",
  ...LEGACY_PUBLIC_REDIRECTS,
};

app.use(async (ctx, next) => {
  const legacyPath = matchLegacyPublicPath(ctx.request.url.pathname);
  if (!legacyPath) return await next();

  let responseStatus = 500;
  try {
    await next();
    responseStatus = Number(ctx.response.status);
  } finally {
    ctx.response.headers.set("X-PeAS-Deprecated", "true");
    ctx.response.headers.set("Cache-Control", "no-cache, must-revalidate");
    const successor = LEGACY_PUBLIC_REDIRECTS[legacyPath];
    if (successor) ctx.response.headers.set("Link", `<${successor}>; rel=\"successor-version\"`);

    try {
      await recordLegacyPublicPathHit({
        releaseId: LEGACY_PUBLIC_RELEASE_ID,
        path: legacyPath,
        method: ctx.request.method,
        responseStatus,
      });
    } catch (error) {
      console.warn("Unable to record legacy public-path request", {
        path: legacyPath,
        error: getErrorMessage(error),
      });
    }
  }
});

app.use(async (ctx, next) => {
  if (ctx.request.method !== "GET" && ctx.request.method !== "HEAD") return await next();
  const destination = publicAliases[ctx.request.url.pathname];
  if (!destination) return await next();
  ctx.response.status = 308;
  ctx.response.headers.set("Location", destination + ctx.request.url.search);
});

// All status pages share the same HTML entry and React implementation.
app.use(async (ctx, next) => {
  if (ctx.request.method !== "GET" && ctx.request.method !== "HEAD") return await next();

  const routeMatch = ctx.request.url.pathname.match(/^\/error\/(\d{3})\/?$/);
  const routeStatus = Number(routeMatch?.[1]);
  const status = ctx.request.url.pathname === "/pages/miscellaneous/404.html" ? 404 : routeStatus;
  if (!PUBLIC_ERROR_STATUSES.has(status)) return await next();

  await servePublicErrorPage(ctx, status);
});

// Server-owned public page analytics. A successful HTML response is a page
// view; a signed, 30-minute cookie determines whether it also starts a visit.
// This runs before static serving so refreshes and JS failures cannot bypass
// the canonical page-view definition.
app.use(async (ctx, next) => {
  const pageKey = canonicalPublicPageKey(ctx.request.url.pathname);
  await next();

  if (!pageKey || ctx.request.method !== "GET" || Number(ctx.response.status) !== 200) return;
  if (!requestAcceptsHtml(ctx) || isPrefetchRequest(ctx.request.headers)) return;
  if (isKnownCrawler(ctx.request.headers.get("user-agent"))) return;

  try {
    const session = await getSessionFromHeaders(ctx.request.headers);
    const role = String(session?.role ?? "").toLowerCase();
    if (role === "admin") return;

    const audience = "guest";
    const current = await readAnalyticsSessionCookie(ctx.request.headers);
    const startsVisit = !current || current.audience !== audience;
    const recorded = await recordPublicTraffic({ pageKey, audience, startsVisit });
    if (!recorded) return;

    const cookie = await createAnalyticsSessionCookie(audience, Date.now(), ctx.request.url.protocol === "https:");
    if (cookie) ctx.response.headers.append("set-cookie", cookie);
  } catch {
    // Analytics must never turn a successful public page into a failed page.
  }
});

// Add static file serving middleware
app.use(async (ctx, next) => {
  try {
    const publicPath = ctx.request.url.pathname.replace(/^\/components(\/|$)/i, "/Components$1");
    await ctx.send({
      root: `${Deno.cwd()}/Public`,
      path: publicPath,
      index: "index.html",
    });
    if (publicPath.endsWith(".html") || publicPath === "/" || /\/react-ui\/(public\.js|app-ui\.css)$/.test(publicPath)) {
      ctx.response.headers.set("Cache-Control", "no-cache, must-revalidate");
    } else if (publicPath.startsWith("/react-ui/chunks/") || publicPath.startsWith("/react-ui/assets/") || /[-.][a-f0-9]{8,}\./i.test(publicPath)) {
      ctx.response.headers.set("Cache-Control", "public, max-age=31536000, immutable");
    }
  } catch {
    await next();
  }
});

// Add static file serving middleware for admin directory
app.use(async (ctx, next) => {
  if (ctx.request.url.pathname.startsWith('/admin/')) {
    try {
      const adminPath = ctx.request.url.pathname.replace("/icons/Category-icons/", "/icons/category-icons/");
      await ctx.send({
        root: `${Deno.cwd()}`,
        path: adminPath,
        index: "dashboard.html",
      });
      if (adminPath.endsWith(".html") || /\/react-ui\/(main-admin\.js|style\.css)$/.test(adminPath)) {
        ctx.response.headers.set("Cache-Control", "no-cache, must-revalidate");
      } else if (adminPath.includes("/react-ui/chunks/") || adminPath.includes("/react-ui/assets/") || /[-.][a-f0-9]{8,}\./i.test(adminPath)) {
        ctx.response.headers.set("Cache-Control", "public, max-age=31536000, immutable");
      }
    } catch {
      await next();
    }
  } else {
    await next();
  }
});

// Add special middleware for profile pictures
app.use(async (ctx, next) => {
  // Check if the request is for a profile picture (handle both relative and absolute paths)
  if (ctx.request.url.pathname.match(/\/storage\/authors\/profile-pictures\//) || 
      ctx.request.url.pathname.match(/\/storage\/users\/profile-picture\//) ||
      ctx.request.url.pathname.match(/\/C:\/Users\/.*\/storage\/(authors\/profile-pictures|users\/profile-picture)\//)) {
    try {
      // Extract just the filename from the path
      const matches = ctx.request.url.pathname.match(/([^/\\]+)$/);
      const filename = matches ? matches[1] : null;
      
      if (!filename) {
        throw new Error("Could not extract filename from path");
      }
      
      // Determine which path to use based on the URL pattern
      let correctPath;
      const workspaceRoot = resolve(Deno.cwd().replace(/[\\/]Deno$/, ''));
      if (ctx.request.url.pathname.includes('users/profile-picture')) {
        await ctx.send({ root: STORAGE_ROOT, path: join("users", "profile-picture", filename) });
        return;
      } else {
        correctPath = `storage/authors/profile-pictures/${filename}`;
      }
      
      await ctx.send({
        root: workspaceRoot,
        path: correctPath,
      });
    } catch (err) {
      await next();
    }
  } else {
    await next();
  }
});

// Add static file serving middleware for storage directory
app.use(async (ctx, next) => {
  // Check if the request is for a file in the storage directory
  if (ctx.request.url.pathname.startsWith('/storage/')) {
    if (isProtectedDocumentFilePath(ctx.request.url.pathname)) {
      if (requestAcceptsHtml(ctx)) {
        await servePublicErrorPage(ctx, 403);
      } else {
        ctx.response.status = 403;
        ctx.response.body = {
          error: "Protected document files must be accessed through an approved download route",
        };
      }
      return;
    }

    try {
      // Get the workspace root directory (parent of Deno directory)
      const workspaceRoot = Deno.cwd().replace(/[\\/]Deno$/, '');
      
      // Remove leading slash and create path relative to workspace root
      const path = ctx.request.url.pathname.substring(1);
      
      // Normalize the path to handle Windows-style paths
      const normalizedPath = path.replace(/^[A-Z]:\//, '');
            
      await ctx.send({
        root: workspaceRoot,  // Use the workspace root to find the file
        path: normalizedPath,
      });
    } catch (err) {
      await next();
    }
  } else {
    await next();
  }
});

// You can add other global middleware here (e.g., logging, body parsers, etc.)

// -----------------------------
// SECTION: Routes Setup
// -----------------------------

// PeAS is password-only. Reject external-provider entry points before the
// broad Better Auth mount so a future configuration change cannot enable them
// accidentally.
router.all("/api/auth/sign-in/social", (ctx) => {
  ctx.response.status = 404;
  ctx.response.body = { error: "Not found" };
});
router.all("/api/auth/callback/(.*)", (ctx) => {
  ctx.response.status = 404;
  ctx.response.body = { error: "Not found" };
});

// Better Auth owns password sign-in, sessions, sign-out, and password reset
// under /api/auth/*. Registered after the password-only guards.
router.all("/api/auth/(.*)", webHandler((req) => auth.handler(req)));

// Compatibility aliases must be registered before the broad
// /api/documents/:id route so "statistics" is not parsed as a document ID.
router.get("/api/documents/statistics", isAuthenticated, requireCapability("reports:view"), getLegacyStatistics);
router.get("/api/stats/summary", isAuthenticated, requireCapability("reports:view"), getLegacyStatistics);

// Register all routes with the router, including any per-route middleware
// (e.g. isAuthenticated / isAdmin declared on the Route object)
routes.forEach(route => {
  const method = route.method.toLowerCase();
  const chain = [...(route.middleware ?? []), route.handler] as unknown as [any, ...any[]];
  if (method === 'get') {
    router.get(route.path, ...chain);
  } else if (method === 'post') {
    router.post(route.path, ...chain);
  } else if (method === 'put') {
    router.put(route.path, ...chain);
  } else if (method === 'delete') {
    router.delete(route.path, ...chain);
  }
});

// Register email routes
emailRoutes.forEach(route => {
  const method = route.method.toLowerCase();
  if (method === 'post') {
    router.post(route.path, ...([...(route.middleware ?? []), route.handler] as unknown as [any, ...any[]]));
  }
});

// Category/departments reference-data endpoints live in routes/categoryRoutes.ts.

// NOTE: /api/documents/count-by-category and /api/documents/most-visited are
// shadowed by the documentRoutes array's GET /api/documents/:id (registered
// first), which returns 400 for non-numeric ids. Their former inline handlers
// here were dead code and have been removed.

// Add endpoint for child documents
router.get("/api/documents/:id/children", async (ctx) => {
  try {
    const docId = ctx.params.id;
    const session = await getSessionFromHeaders(ctx.request.headers);
    if (!await canViewCompilation(session, docId)) {
      ctx.response.status = 404;
      ctx.response.body = { error: "Compiled document not found" };
      return;
    }
        
    // Convert context to Request for the controller
    const request = new Request(`${ctx.request.url.origin}/api/documents/${docId}/children`, {
      method: "GET",
      headers: ctx.request.headers
    });
    
    // Use the document controller to handle the request
    const response = await getChildDocuments(request);
    
    // Set response from controller
    ctx.response.status = response.status;
    ctx.response.headers = response.headers;
    ctx.response.body = await response.json();
  } catch (error) {
    ctx.response.status = 500;
    ctx.response.body = { 
      error: "Failed to fetch child documents",
      message: error instanceof Error ? error.message : String(error)
    };
  }
});

// Add document-authors endpoint
router.get("/api/document-authors/:documentId", async (ctx) => {
  try {
    const documentId = ctx.params.documentId;
        
    // Get document authors from the controller
    const authors = await getDocumentAuthors(documentId);
    
    ctx.response.status = 200;
    ctx.response.body = {
      document_id: documentId,
      authors_count: authors.length,
      authors: authors
    };
  } catch (error) {
    ctx.response.status = 500;
    ctx.response.body = {
      error: "Failed to fetch document authors",
      details: error instanceof Error ? error.message : String(error)
    };
  }
});

// Add endpoint to get all authors
router.get("/api/authors/all", async (ctx) => {
  try {
    const params: unknown[] = [];
    const clauses: string[] = [];
    const query = ctx.request.url.searchParams.get("q")?.trim();
    const department = ctx.request.url.searchParams.get("department")?.trim();
    const affiliation = ctx.request.url.searchParams.get("affiliation")?.trim();
    if (query) {
      params.push(`%${query}%`);
      clauses.push(`(a.full_name ILIKE $${params.length} OR a.department ILIKE $${params.length} OR a.affiliation ILIKE $${params.length})`);
    }
    if (department) {
      params.push(department);
      clauses.push(`LOWER(BTRIM(a.department)) = LOWER(BTRIM($${params.length}))`);
    }
    if (affiliation) {
      params.push(affiliation);
      clauses.push(`LOWER(BTRIM(a.affiliation)) = LOWER(BTRIM($${params.length}))`);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const authorsResult = await client.queryObject<Record<string, unknown>>(`
      SELECT a.id, a.spud_id, a.full_name, a.department, a.affiliation, a.email,
             a.biography, a.profile_picture, a.created_source,
             (
               (NULLIF(BTRIM(a.department), '') IS NOT NULL OR NULLIF(BTRIM(a.affiliation), '') IS NOT NULL)
             ) AS profile_complete,
             COUNT(da.document_id) AS works_count
      FROM authors a
      LEFT JOIN document_authors da ON da.author_id = a.id
      ${where}
      GROUP BY a.id
      ORDER BY a.full_name
    `, params);
    const formattedAuthors = authorsResult.rows.map((author) => ({
      id: author.id,
      spud_id: author.spud_id || '',
      full_name: author.full_name,
      department: author.department || '',
      affiliation: author.affiliation || '',
      email: author.email || '',
      bio: author.biography || '',
      profilePicUrl: author.profile_picture || '',
      createdSource: author.created_source || 'author_directory',
      profileComplete: Boolean(author.profile_complete),
      worksCount: Number(author.works_count || 0),
    }));
    
    ctx.response.status = 200;
    ctx.response.body = {
      count: formattedAuthors.length,
      authors: formattedAuthors
    };
  } catch (error) {
    ctx.response.status = 500;
    ctx.response.body = { 
      error: error instanceof Error ? error.message : "Unknown error", 
      authors: [] 
    };
  }
});

// Add author search endpoint
router.get("/api/authors/search", async (ctx) => {
  try {
    // Get search query parameter
    const url = new URL(ctx.request.url);
    const query = url.searchParams.get("q") || '';
    
        
    if (!query) {
      ctx.response.status = 200;
      ctx.response.body = [];
      return;
    }
    
    // Import AuthorModel dynamically to avoid circular dependencies
    const { AuthorModel } = await import("./models/authorModel.ts");
    
    // Search authors with the query
    const searchSQL = `
      SELECT * FROM authors 
      WHERE full_name ILIKE $1 
      OR department ILIKE $1 
      OR affiliation ILIKE $1
      OR biography ILIKE $1
      OR email ILIKE $1
      LIMIT 10
    `;
    
    const searchParam = `%${query}%`;
    const searchResult = await client.queryObject(searchSQL, [searchParam]);
    
    // Format the search results
    const authors = searchResult.rows.map((author: any) => ({
      id: author.id,
      full_name: author.full_name,
      department: author.department || '',
      affiliation: author.affiliation || '',
      email: author.email || '',
      bio: author.biography || '',
      profile_picture: author.profile_picture || '',
    }));
    
    ctx.response.status = 200;
    ctx.response.body = authors;
  } catch (error) {
    ctx.response.status = 500;
    ctx.response.body = { 
      error: error instanceof Error ? error.message : "Unknown error" 
    };
  }
});

// Add endpoint to get works (documents) authored by a specific author
router.get("/api/authors/:authorId/works", async (ctx) => {
  const authorId = ctx.params.authorId;

  if (!authorId) {
      ctx.response.status = 400;
    ctx.response.body = { error: "Author ID is required" };
      return;
    }
    
    
  try {
    // Get document IDs authored by this author
    const docIds = await AuthorModel.getDocuments(authorId);

    // Get full document details for each ID
    const works = [];
    for (const docId of docIds) {
      const doc = await DocumentModel.getById(docId);
      if (doc) {
                
        const classification = await getDocumentClassification(docId, false);
        (doc as any).classification = classification;
        (doc as any).topics = classification.topics;

        // Get category directly from document_type field
        let categoryName = 'N/A';
        if (doc.document_type) {
          // Convert document_type enum to a readable category name
          switch(doc.document_type) {
            case 'THESIS':
              categoryName = 'Thesis';
              break;
            case 'DISSERTATION':
              categoryName = 'Dissertation';
              break;
            case 'CONFLUENCE':
              categoryName = 'Confluence';
              break;
            case 'SYNERGY':
              categoryName = 'Synergy';
              break;
            default:
              categoryName = doc.document_type;
          }
                  }

        // Format work for frontend consumption
        works.push({
          id: doc.id,
          title: doc.title,
          // Format dates based on document type
          year: formatDocumentDate(doc),
          category: categoryName,
          researchAgenda: classification.researchAgendas.length > 0
            ? classification.researchAgendas.map((agenda) => agenda.name).join(', ')
            : 'N/A',
          researchAgendas: classification.researchAgendas,
          keywords: classification.keywords,
          // Add URL for document viewing if needed
          url: `/document/${doc.id}`,
          // Include original document data if needed
          document: doc
        });
      }
    }

    // Helper function to format document dates based on type
    function formatDocumentDate(doc: any): string {
            
      // For single documents (THESIS or DISSERTATION) with publication date
      if (doc.publication_date && (doc.document_type === 'THESIS' || doc.document_type === 'DISSERTATION')) {
        try {
          const date = new Date(doc.publication_date);
          // Format as Month Year (e.g., "May 2023")
          return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
        } catch (e) {
          return String(doc.publication_date);
        }
      }
      
      // For compiled documents (CONFLUENCE or SYNERGY) with start and end years
      if ((doc.document_type === 'CONFLUENCE' || doc.document_type === 'SYNERGY')) {
        if (doc.start_year && doc.end_year) {
          return `${doc.start_year} - ${doc.end_year}`;
        } else if (doc.start_year) {
          return String(doc.start_year);
        }
      }
      
      // Fallback: Use any available date info
      if (doc.publication_date) {
        try {
          const date = new Date(doc.publication_date);
          return date.getFullYear().toString();
        } catch (e) {
          return String(doc.publication_date);
        }
      } else if (doc.start_year) {
        return String(doc.start_year);
      }
      
      return 'N/A';
    }

    ctx.response.status = 200;
    ctx.response.body = {
      authorId,
      works_count: works.length,
      worksCount: works.length, // Include both formats for backward compatibility
      works,
    };
  } catch (error) {
    ctx.response.status = 500;
    ctx.response.body = {
      error: 'Failed to fetch author works',
      details: error instanceof Error ? error.message : String(error),
    };
  }
});

// Check and synchronize compiled document authors
router.get("/api/compiled-documents/:compiledDocId/sync-authors", async (ctx) => {
  const compiledDocId = ctx.params.compiledDocId;

  if (!compiledDocId) {
      ctx.response.status = 400;
    ctx.response.body = { error: "Compiled document ID is required" };
      return;
    }
    
    
  try {
    // Get child documents for this compiled document
    const childDocsResponse = await fetchChildDocuments(compiledDocId);
    const childDocs = childDocsResponse.documents;

    if (!childDocs || childDocs.length === 0) {
    ctx.response.status = 200;
      ctx.response.body = {
        message: 'No child documents found for this compiled document',
        compiledDocId,
        childCount: 0
      };
      return;
    }

    // Track all authors across all child documents
    const authorMap = new Map();
    
    // Process each child document to collect all authors
    for (const doc of childDocs) {
            
      // Process each author of this document
      for (const author of doc.authors) {
        if (!authorMap.has(author.id)) {
          // Store the author ID and name if we haven't seen this author before
          authorMap.set(author.id, author.full_name);
        }
      }
    }

    // Convert the author map to an array
    const uniqueAuthors = Array.from(authorMap).map(([id, name]) => ({
      id,
      full_name: name
    }));

    
    ctx.response.status = 200;
    ctx.response.body = {
      compiledDocId,
      childCount: childDocs.length,
      authorCount: uniqueAuthors.length,
      authors: uniqueAuthors,
      status: 'success'
    };
  } catch (error) {
    ctx.response.status = 500;
    ctx.response.body = {
      error: 'Failed to synchronize compiled document authors',
      details: error instanceof Error ? error.message : String(error),
    };
  }
});

// Add endpoint to update author information
router.put("/api/authors/:authorId", isAuthenticated, isAdmin, async (ctx) => {
  const authorId = ctx.params.authorId;

  if (!authorId) {
    ctx.response.status = 400;
    ctx.response.body = { error: "Author ID is required" };
    return;
  }

  try {
    const body = ctx.request.body();
    if (body.type !== "json") {
      ctx.response.status = 400;
      ctx.response.body = { error: "Request body must be JSON" };
      return;
    }

    const authorData = await body.value;
    const existingAuthor = await AuthorModel.getById(authorId);
    if (!existingAuthor) {
      ctx.response.status = 404;
      ctx.response.body = { error: "Author not found" };
      return;
    }

    const newId = typeof authorData?.newId === "string" ? authorData.newId.trim() : "";
    if (newId && newId !== authorId) {
      const duplicateId = await AuthorModel.getById(newId);
      if (duplicateId) {
        ctx.response.status = 409;
        ctx.response.body = { error: "The new ID is already in use." };
        return;
      }
    }

    const fieldErrors: Record<string, string> = {};
    const fullName = sanitizeAuthorDisplayName(authorData?.full_name, fieldErrors, "full_name");
    const spudId = normalizeOptionalAuthorValue(authorData?.spud_id, 50, fieldErrors, "spud_id");
    const department = normalizeOptionalAuthorValue(authorData?.department, 255, fieldErrors, "department");
    const affiliation = normalizeOptionalAuthorValue(authorData?.affiliation, 255, fieldErrors, "affiliation");
    const email = normalizeOptionalAuthorValue(authorData?.email, 255, fieldErrors, "email");
    const biography = normalizeOptionalAuthorValue(authorData?.bio, Number.MAX_SAFE_INTEGER, fieldErrors, "bio");
    const profilePicture = normalizeOptionalAuthorValue(authorData?.profilePicUrl, 255, fieldErrors, "profilePicUrl");

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
      fieldErrors.email = "Enter a valid email address or leave this field empty.";
    }

    if (Object.keys(fieldErrors).length) {
      ctx.response.status = 400;
      ctx.response.body = { error: "Fix the highlighted author fields.", fieldErrors };
      return;
    }

    let canonicalReference;
    try {
      canonicalReference = await validateAuthorReferenceValues(department, affiliation);
    } catch (error) {
      ctx.response.status = error instanceof AuthorReferenceValidationError ? 400 : 500;
      const referenceField: "department" | "affiliation" = error instanceof AuthorReferenceValidationError
        ? error.field ?? "department"
        : "department";
      ctx.response.body = {
        error: error instanceof Error ? error.message : "Unable to validate author references.",
        fieldErrors: error instanceof AuthorReferenceValidationError ? { [referenceField]: error instanceof Error ? error.message : "Choose a managed department or affiliation." } : undefined,
      };
      return;
    }

    const duplicateName = await client.queryObject(
      `SELECT id FROM authors
       WHERE id <> $2
         AND LOWER(REGEXP_REPLACE(BTRIM(full_name), '[[:space:]]+', ' ', 'g')) = $1
       LIMIT 1`,
      [authorNameKey(fullName), authorId],
    );
    if (duplicateName.rows.length) {
      ctx.response.status = 409;
      ctx.response.body = { error: "An author with this publication display name already exists.", fieldErrors: { full_name: "Use a publication display name that is not already in the directory." } };
      return;
    }

    if (spudId) {
      const duplicateSpudId = await client.queryObject(
        "SELECT id FROM authors WHERE id <> $2 AND spud_id = $1 LIMIT 1",
        [spudId, authorId],
      );
      if (duplicateSpudId.rows.length) {
        ctx.response.status = 409;
        ctx.response.body = { error: "That SPUD ID is already assigned to another author.", fieldErrors: { spud_id: "Use a unique SPUD ID." } };
        return;
      }
    }

    const updatedResult = await client.queryObject(
      `UPDATE authors
       SET full_name = $1,
           department = $2,
           affiliation = $3,
           email = $4,
           biography = $5,
           profile_picture = $6,
           spud_id = $7,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $8
       RETURNING *`,
      [
        fullName,
        canonicalReference.department,
        canonicalReference.affiliation,
        email || null,
        biography || null,
        profilePicture || null,
        spudId || null,
        authorId,
      ],
    );

    const updatedAuthor = updatedResult.rows[0] ?? null;
    if (!updatedAuthor) {
      ctx.response.status = 404;
      ctx.response.body = { error: "Author not found" };
      return;
    }

    if (newId && newId !== authorId) {
      await AuthorModel.updateId(authorId, newId);
    }

    const responseAuthor = newId && newId !== authorId
      ? await AuthorModel.getById(newId)
      : updatedAuthor;
    if (!responseAuthor) {
      ctx.response.status = 404;
      ctx.response.body = { error: "Author not found after ID update" };
      return;
    }

    const profileComplete = Boolean(
      String(responseAuthor.department ?? "").trim() || String(responseAuthor.affiliation ?? "").trim()
    );
    await syncAuthorProfileNotification(String(responseAuthor.id), String(responseAuthor.full_name), profileComplete);

    ctx.response.status = 200;
    ctx.response.body = { message: "Author updated successfully", author: responseAuthor };
  } catch (error) {
    if (isAuthorUniqueViolation(error)) {
      const uniqueField = authorUniqueField(error);
      ctx.response.status = 409;
      ctx.response.body = {
        error: "An author identifier is already in use.",
        fieldErrors: uniqueField ? { [uniqueField]: uniqueField === "full_name" ? "Use a unique publication display name." : "Use a unique SPUD ID." } : undefined,
      };
      return;
    }
    ctx.response.status = 500;
    ctx.response.body = { error: error instanceof Error ? error.message : "Unknown error" };
  }
});

// Add authors endpoint
router.post("/api/document-research-agenda/link", isAuthenticated, requireCapability("documents:upload"), async (ctx) => {
  try {
    const body = await ctx.request.body({ type: "json" }).value;
    
    if (!body.document_id) {
      ctx.response.status = 400;
      ctx.response.body = { error: "Document ID is required" };
      return;
    }
    
    if (!Array.isArray(body.agenda_items) && !Array.isArray(body.agenda_ids)) {
      ctx.response.status = 400;
      ctx.response.body = { error: "agenda_items or agenda_ids must be an array" };
      return;
    }

    if (!await canModifyPendingUpload(ctx.state.user, body.document_id)) {
      ctx.response.status = 403;
      ctx.response.body = { error: "You cannot change research agenda items for this document" };
      return;
    }
    
        
    const documentId = parseInt(body.document_id.toString());
    const actor = { id: String(ctx.state.user.id), role: String(ctx.state.user.role) };
    let classification;
    if (Array.isArray(body.agenda_ids)) {
      const current = await getDocumentClassification(documentId, true);
      classification = await replaceDocumentClassification(documentId, {
        researchAgendaIds: body.agenda_ids,
        primaryResearchAgendaId: body.agenda_ids[0],
        topicIds: current.topics.map((item) => item.id),
        keywords: current.keywords.map((item) => item.name),
      }, actor, { allowPendingTopics: true, allowIncomplete: true });
    } else {
      classification = await replaceDocumentKeywords(documentId, body.agenda_items, actor);
    }

    if (classification) {
      ctx.response.headers.set("Deprecation", "true");
      ctx.response.headers.set("Sunset", "2026-12-31");
      ctx.response.headers.set("Link", "</api/documents/" + documentId + "/classification>; rel=\"successor-version\"");
      ctx.response.status = 200;
      ctx.response.body = {
        message: "Stored legacy classification values without creating research agenda records",
        classification
      };
    } else {
      ctx.response.status = 500;
      ctx.response.body = { error: "Failed to link research agenda items to document" };
    }
  } catch (error) {
    ctx.response.status = 500;
    ctx.response.body = { 
      error: "Failed to update legacy classification values",
      details: error instanceof Error ? error.message : String(error)
    };
  }
});

// Register document author routes
app.use(documentAuthorRoutes.routes());
app.use(documentAuthorRoutes.allowedMethods());

// Register file routes
app.use(fileRoutes.routes());
app.use(fileRoutes.allowedMethods());

// Register upload routes
app.use(uploadRoutes.routes());
app.use(uploadRoutesAllowedMethods);

// Typed classification routes keep research agendas, topics, and keywords
// separate from the legacy document routes.
app.use(documentClassificationRoutes);
app.use(documentClassificationAllowedMethods);

// Register Experience Studio routes
app.use(experienceRoutes.routes());
app.use(experienceRoutes.allowedMethods());

// Register Research and Publications news routes
app.use(newsRoutes.routes());
app.use(newsRoutes.allowedMethods());

// Owner-scoped document reading status is distinct from repository analytics.
app.use(userReadStatusRoutes.routes());
app.use(userReadStatusRoutes.allowedMethods());
app.use(documentAnnotationRoutes.routes());
app.use(documentAnnotationRoutes.allowedMethods());

// Register durable public Contact and administrator triage routes
app.use(contactInquiryRoutes.routes());
app.use(contactInquiryRoutes.allowedMethods());
app.use(adminNotificationRoutes.routes());
app.use(adminNotificationRoutes.allowedMethods());
app.use(abstractReviewRoutes.routes());
app.use(abstractReviewRoutes.allowedMethods());

// Add router to app
app.use(router.routes());
app.use(router.allowedMethods());

// Register category/departments reference-data routes
app.use(categoryRoutes);
app.use(categoryAllowedMethods);

// Add Author routes
app.use(authorRoutes);

// Add Research Agenda routes
app.use(researchAgendaRoutes);

// Register unified archive routes
app.use(unifiedArchiveRoutes);
app.use(unifiedArchiveAllowedMethods);

// Log that unified archive API is available

// -----------------------------
// SECTION: Document Metadata Update Route
// -----------------------------
// Add a route to update document metadata after processing
router.put("/api/documents/:id/metadata", isAuthenticated, isAdmin, async (ctx) => {
  try {
    const id = ctx.params.id;
    
    if (!id) {
      ctx.response.status = 400;
      ctx.response.body = { error: "Document ID is required" };
      return;
    }
    
    // Get request body
    const body = await ctx.request.body({ type: "json" }).value;

    if (Object.prototype.hasOwnProperty.call(body, "abstract")) {
      ctx.response.status = 409;
      ctx.response.body = { error: "Abstract changes must use the administrator abstract review endpoint." };
      return;
    }
    
    // Forward directly to the document update handler. An internal fetch would
    // create a second request without the browser session cookie and could
    // turn the real update response into an opaque 500 error.
    const updateRequest = new Request(`${ctx.request.url.origin}/documents/${id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });
    
    const updateResponse = await handleUpdateDocument(updateRequest);
    
    // Return the response
    ctx.response.status = updateResponse.status;
    ctx.response.body = await updateResponse.json();
    
  } catch (error) {
    ctx.response.status = 500;
    ctx.response.body = { 
      error: "Failed to update document metadata",
      details: getErrorMessage(error)
    };
  }
});

// -----------------------------
// SECTION: Directory Management Route
// -----------------------------
// Add a route to ensure directories exist
router.post("/api/ensure-directory", isAuthenticated, isAdmin, async (ctx) => {
  try {
    // Get the path from request body
    const body = await ctx.request.body({ type: "json" }).value;
    const { path } = body;
    
    if (!path) {
      ctx.response.status = 400;
      ctx.response.body = { error: "Path is required" };
      return;
    }
    
    // Prevent access to sensitive directories
    if (path.includes("..") || !path.startsWith("storage/")) {
      ctx.response.status = 403;
      ctx.response.body = { error: "Invalid directory path" };
      return;
    }
    
        
    // Get the workspace root directory (parent of Deno directory)
    const workspaceRoot = Deno.cwd().replace(/[\\/]Deno$/, '');
    
    // Make sure path is relative to workspace root, not inside Deno directory
    let fullPath = path;
    if (path.includes("Deno/storage/")) {
      fullPath = path.replace("Deno/storage/", "storage/");
          }
    
    // Create absolute path from workspace root
    const absolutePath = join(workspaceRoot, fullPath);
        
    // Create the directory
    await ensureDir(absolutePath);
    
    // Verify directory was created
    try {
      const stat = await Deno.stat(absolutePath);
      if (!stat.isDirectory) {
        throw new Error(`Path exists but is not a directory: ${absolutePath}`);
      }
          } catch (verifyError: unknown) {
      const errorMessage = verifyError instanceof Error ? verifyError.message : String(verifyError);
      throw new Error(`Failed to verify directory: ${errorMessage}`);
    }
    
    ctx.response.status = 200;
    ctx.response.body = { 
      message: "Directory created successfully",
      path: fullPath
    };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    ctx.response.status = 500;
    ctx.response.body = { 
      error: "Failed to create directory",
      details: errorMessage
    };
  }
});

// -----------------------------
// SECTION: Directory Setup
// -----------------------------
// Create required directories for storage
async function setupDirectories() {
    
  try {
    // Get the workspace root directory (parent of Deno directory)
    const workspaceRoot = Deno.cwd().replace(/[\\/]Deno$/, '');
        
    // Create main storage directory at the workspace root level
    const storageBase = join(workspaceRoot, 'storage');
    await ensureDir(storageBase);
        
    // Create only the necessary document type directories
    const directories = [
      join(storageBase, 'thesis'),
      join(storageBase, 'dissertation'),
      join(storageBase, 'confluence'),
      join(storageBase, 'synergy'),
      join(storageBase, 'hello'),
      join(storageBase, 'authors', 'profile-pictures'), // Updated path to match existing structure
      join(storageBase, 'site-branding'),
      join(storageBase, 'news-media', 'staging'),
      join(storageBase, 'news-media', 'source'),
      join(storageBase, 'news-media', 'variants'),
    ];
    
    // Create all directories
    for (const dir of directories) {
      await ensureDir(dir);
          }
    
        
    // List the directories that were created to verify
    try {
            for await (const entry of Deno.readDir(storageBase)) {
        if (entry.isDirectory) {
                  }
      }
    } catch (listError) {
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to create storage directories: ${errorMessage}`);
  }
}

// Function to run database migrations
// Removed - related to document views functionality
// async function runMigrations() {
//   //   
//   try {
//     // Document Views table
//     //     const documentViewsMigration = await readTextFile("./db/migrations/document_views_table.sql");
//     await client.queryArray(documentViewsMigration);
//     
//     // Call the migration function
//     await client.queryArray("SELECT migrate_document_views()");
//     
//     //   } catch (error) {
//     console.error("[DATABASE] Error running migrations:", error);
//   }
// }

// -----------------------------
// SECTION: Server Startup
// -----------------------------
async function startServer() {
    
  try {
    // Create necessary directories
    await setupDirectories();
    
    // Connect to the database. Production must fail fast rather than serving
    // a partially initialized application.
    await connectToDb();
    if (isProduction) await client.queryObject("SELECT 1");
        
    // Run database diagnostics
    await diagnoseDatabaseIssues();

    setInterval(() => void cleanupDocumentAnnotations().catch((error) => console.error("Document annotation cleanup failed:", error)), 15 * 60 * 1000);
    
    try {
      await verifyLegacyVisitCounterTables();
    } catch {
      // A missing legacy table must not prevent content delivery or v2 startup.
    }
    try {
      // Reporting migrations are explicit deployment operations. Startup only
      // performs a read-only readiness probe and never mutates the schema or
      // silently backfills legacy analytics.
      await verifyOperationalReportingSchema();
    } catch (error) {
      // Core content delivery remains available; report endpoints return a
      // reporting-specific 503 until the migration is applied.
      console.error("Operational reporting schema is unavailable:", error instanceof Error ? error.message : error);
    }
    await verifyProductionReadiness();
    if (Deno.env.get("NEWS_MEDIA_WORKER_ENABLED") !== "false") await startNewsMediaWorker();
    setInterval(() => void cleanupNewsMedia().catch((error) => console.error("News media cleanup failed:", error)), 60 * 60 * 1000);
    await registerLegacyPublicRelease(LEGACY_PUBLIC_RELEASE_ID);
    await startContactNotificationWorker();
    serverReady = true;
    
    // Note: `router` is already registered on the app (routes added to it
    // after registration still dispatch, since Oak matches at request time).

    // Register author visits routes
    app.use(authorVisitsRoutes);
    app.use(authorVisitsAllowedMethods);

    app.use(authorReferenceRoutes);
    app.use(authorReferenceAllowedMethods);
    
    // Register page visits routes
        app.use(pageVisitsRoutes);
    app.use(pageVisitsAllowedMethods);
    
    // Register system logs routes
        app.use(systemLogsRoutes);
    app.use((ctx, next) => {
      if (ctx.request.method === "OPTIONS" && 
          ctx.request.url.pathname.startsWith("/api/system-logs")) {
        ctx.response.status = 204;
        
        // Add CORS headers
        ctx.response.headers.set("Access-Control-Allow-Origin", "*");
        ctx.response.headers.set("Access-Control-Allow-Methods", systemLogsAllowedMethods.join(", "));
        ctx.response.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
        
        return;
      }
      return next();
    });
    
    // Register keywords routes
    app.use(keywordsRoutes.routes());
    app.use(keywordsRoutes.allowedMethods());
    app.use(searchRoutes.routes());
    app.use(searchRoutes.allowedMethods());
    
    // Register reports routes
        app.use(reportsRoutes.routes());
    app.use(reportsRoutes.allowedMethods());
    
    // Custom 404 handler - must be added last in the middleware chain
    app.use(async (ctx) => {
      // This middleware will only be reached if no other middleware handled the request
            
      try {
        // Set status to 404
        ctx.response.status = 404;
        
        // Check if the request accepts HTML
        const acceptHeader = ctx.request.headers.get("accept") || "";
        
        if (acceptHeader.includes("text/html")) {
          await servePublicErrorPage(ctx, 404);
        } else {
          // For API requests, return JSON
          ctx.response.type = "application/json";
          ctx.response.body = { 
            error: "Not Found", 
            message: "The requested resource could not be found",
            path: ctx.request.url.pathname 
          };
        }
      } catch (err: unknown) {
        ctx.response.status = 500;
        ctx.response.body = "Internal Server Error";
      }
    });
    
    // Start the server
    console.log(`[peas-server] Starting server on ${HOST}:${PORT} (Network accessible)...`);
    await app.listen({ port: Number(PORT), hostname: HOST });
  } catch (error) {
    console.error("Fatal error during server startup:", error);
    Deno.exit(1);
  }
}

router.get('/api/affiliations', async (ctx) => {
  try {
    ctx.response.status = 200;
    ctx.response.type = "json";
    ctx.response.body = await listAffiliationsCompatibility();
  } catch (error) {
    ctx.response.status = 500;
    ctx.response.type = "json";
    ctx.response.body = { error: error instanceof Error ? error.message : "Unknown error" };
  }
});

// Health endpoints are intentionally small and contain no configuration or
// SMTP diagnostics. Readiness is checked by the reverse proxy and Compose.
router.get("/health/live", (ctx) => {
    ctx.response.status = 200;
    ctx.response.body = { status: "ok" };
});

router.get("/health/ready", (ctx) => {
    ctx.response.status = serverReady ? 200 : 503;
    ctx.response.body = { status: serverReady ? "ready" : "starting" };
});

router.get("/ping", (ctx) => {
    const contactNotifications = getContactNotificationConfiguration();
    ctx.response.status = 200;
    ctx.response.body = {
        status: "ok",
        serverStartTime: SERVER_START_TIME,
        ready: serverReady,
        contactNotifications: contactNotifications.status,
    };
});

// Initialize document request system
const documentRequestModel = new DocumentRequestModel();
const documentRequestController = new DocumentRequestController(documentRequestModel);
const documentRequestRoutes = createDocumentRequestRoutes(documentRequestController);

// Durable request-email jobs are claimed atomically. A failed delivery is
// rescheduled by the model without exposing or persisting a raw access token.
setInterval(() => {
  void processDocumentRequestEmailQueue(documentRequestModel).catch((error) =>
    console.error("Document request email worker failed", error)
  );
}, 5_000);
setInterval(() => {
  void documentRequestModel.expireUnverifiedRequests().catch((error) =>
    console.error("Unverified document request cleanup failed", error)
  );
}, 15 * 60_000);

// Add document request routes
app.use(documentRequestRoutes.routes());
app.use(documentRequestRoutes.allowedMethods());

// Add an endpoint to view email logs for document requests (admin only)
router.get("/api/email-logs", isAuthenticated, isAdmin, async (ctx) => {
  try {
    // Get date from query parameter or use today
    const url = new URL(ctx.request.url);
    const dateParam = url.searchParams.get("date");
    const date = dateParam || new Date().toISOString().split('T')[0];
    
    // Validate date format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      ctx.response.status = 400;
      ctx.response.body = { error: "Invalid date format. Please use YYYY-MM-DD format" };
      return;
    }
    
    // Construct log file path
    const logFile = `./logs/email-activity-${date}.log`;
    
    try {
      // Check if file exists
      await Deno.stat(logFile);
    } catch (error) {
      ctx.response.status = 404;
      ctx.response.body = { 
        error: `No log file found for ${date}`,
        date: date
      };
      return;
    }
    
    // Read log file
    const logContent = await Deno.readTextFile(logFile);
    
    // Parse logs
    const logEntries = logContent
      .split('\n')
      .filter(line => line.trim())
      .map(line => JSON.parse(line));
    
    // Filter for document sending activities
    const documentActivities = logEntries.filter(entry => 
      entry.action.startsWith('DOCUMENT_')
    );
    
    // Calculate statistics
    const successful = documentActivities.filter(e => e.action === 'DOCUMENT_SENT_SUCCESS').length;
    const failed = documentActivities.filter(e => 
      e.action === 'DOCUMENT_SENT_FAILURE' || e.action === 'DOCUMENT_SENT_ERROR'
    ).length;
    
    // Return logs and statistics
    ctx.response.status = 200;
    ctx.response.body = {
      date: date,
      total: documentActivities.length,
      successful: successful,
      failed: failed,
      logs: documentActivities
    };
    
  } catch (error) {
    ctx.response.status = 500;
    ctx.response.body = { 
      error: "Server error while retrieving email logs",
      details: error instanceof Error ? error.message : String(error)
    };
  }
});

// Add a route for getting detailed compiled document information with visit statistics
router.get("/api/compiled-documents/:id/details", isAuthenticated, async (ctx) => {
  try {
    const id = parseInt(ctx.params.id);
    if (isNaN(id)) {
      ctx.response.status = 400;
      ctx.response.body = { error: "Invalid ID" };
      return;
    }
    
    // Import the PageVisitsModel dynamically
    const { PageVisitsModel } = await import("./models/pageVisitsModel.ts");
    
    // Fetch the compiled document
    const compiledDoc = await getCompiledDocument(id);
    if (!compiledDoc) {
      ctx.response.status = 404;
      ctx.response.body = { error: "Compiled document not found" };
      return;
    }
    
    // Get visit statistics for the compiled document
    let visitStats = { total: 0, guest: 0, user: 0 };
    try {
      visitStats = await PageVisitsModel.getDocumentVisitCounters(id.toString());
    } catch (visitError) {
    }
    
    // Get child documents
    let childDocs: DocumentData[] = [];
    try {
      const childDocsResponse = await fetchChildDocuments(id);
      childDocs = childDocsResponse.documents || [];
      
      // For each child document, fetch visit statistics
      for (let i = 0; i < childDocs.length; i++) {
        const childDoc = childDocs[i];
        const childId = childDoc.id;
        
        if (childId) {
          try {
            const childVisitStats = await PageVisitsModel.getDocumentVisitCounters(childId.toString());
            childDoc.visit_count = childVisitStats.total || 0;
            childDoc.guest_count = childVisitStats.guest || 0;
            childDoc.user_count = childVisitStats.user || 0;
          } catch (childVisitError) {
            childDoc.visit_count = 0;
            childDoc.guest_count = 0;
            childDoc.user_count = 0;
          }
        }
      }
      
      // Sort child documents by visit count (descending)
      childDocs.sort((a, b) => (b.visit_count || 0) - (a.visit_count || 0));
      
    } catch (childError) {
    }
    
    // Fetch authors for the document if they're not already included
    let authors = [];
    try {
      // Authors might already be included in the document
      if (compiledDoc.authors && Array.isArray(compiledDoc.authors)) {
        authors = compiledDoc.authors;
      } else {
        // Try to fetch authors separately
        const authorsData = await getDocumentAuthors(String(id));
        authors = authorsData || [];
      }
    } catch (authorError) {
    }
    
    // Combine all data
    const result = {
      ...compiledDoc,
      authors: authors,
      child_documents: childDocs,
      visit_count: visitStats.total || 0,
      guest_count: visitStats.guest || 0,
      user_count: visitStats.user || 0
    };
    
        
    ctx.response.body = result;
  } catch (error) {
    ctx.response.status = 500;
    ctx.response.body = { error: "Failed to fetch compiled document details" };
  }
});

// Also add an alias to support the /compiled-documents/:id/children endpoint that the frontend tries
router.get("/compiled-documents/:id/children", async (ctx) => {
  // Redirect to the API version of the endpoint
  const id = ctx.params.id;
    
  try {
    // Reuse the same handler as the API endpoint
    const apiRequest = new Request(`${ctx.request.url.origin}/api/compiled-documents/${id}/children`, {
      method: "GET",
      headers: ctx.request.headers
    });
    
    // Forward to the main handler
    const apiResponse = await fetch(apiRequest);
    
    // Return the response data
    ctx.response.status = apiResponse.status;
    ctx.response.headers = apiResponse.headers;
    ctx.response.body = await apiResponse.json();
  } catch (error) {
    ctx.response.status = 500;
    ctx.response.body = {
      error: "Failed to fetch child documents", 
      details: error instanceof Error ? error.message : String(error)
    };
  }
});

// Register user profile endpoint for the navbar
router.get("/api/user/profile", isAuthenticated, async (ctx) => {
  const scopedUrl = new URL(ctx.request.url.toString());
  scopedUrl.searchParams.set("userId", ctx.state.user.id);

  const request = new Request(scopedUrl.toString(), {
    method: ctx.request.method,
    headers: ctx.request.headers
  });
  
  const response = await handleGetUserProfileForNavbar(request);
  
  ctx.response.status = response.status;
  ctx.response.headers = response.headers;
  ctx.response.body = await response.json();
  
  });

// Password changes go through Better Auth: POST /api/auth/change-password.

// Register profile picture upload endpoint
router.post("/api/user/profile/picture", isAuthenticated, async (ctx) => {
  try {
        
    // Directly call the handler with the context
    await handleUserProfilePictureUpload(ctx as unknown as RouterContext<string>);
    
  } catch (error) {
    ctx.response.status = 500;
    ctx.response.body = {
      error: "Internal server error processing profile picture upload",
      details: error instanceof Error ? error.message : String(error)
    };
  }
});

// Register logout endpoint 
// /logout (POST and GET) is handled by the logout handler in
// routes/authRoutes.ts, registered via the routes array above.

// Add route for recording document view
router.post("/api/document-views", analyticsRateLimit, async (ctx) => {
  ctx.response.status = 204;
  ctx.response.headers.set("Deprecation", "true");
  ctx.response.headers.set("Sunset", "true");
});

// Compatibility statistics reads delegate to the canonical administrator
// report.  This route is protected and deprecated; it must never expose the
// old mock response or an unauthenticated aggregate.
router.get("/api/document-views/stats", isAuthenticated, requireCapability("reports:view"), async (ctx) => {
  ctx.response.headers.set("Deprecation", "true");
  ctx.response.headers.set("Sunset", "true");
  await getLegacyStatistics(ctx);
});

// Add endpoint to fetch the foreword specifically for a category type of compiled document
router.get("/api/compiled-documents/:id/foreword", isAuthenticated, isAdmin, async (ctx) => {
  const id = ctx.params.id;
  
  if (!id) {
    ctx.response.status = 400;
    ctx.response.body = { error: "Compiled document ID is required" };
    return;
  }

  const numericId = Number(id);
  if (!Number.isSafeInteger(numericId) || numericId <= 0 || !await canViewCompilation(ctx.state.user, numericId)) {
    ctx.response.status = 404;
    ctx.response.body = { error: "Compiled document not found" };
    return;
  }
  
  try {
    // Parse the URL to check for the category query parameter
    const url = new URL(ctx.request.url);
    const categoryParam = url.searchParams.get('category');
    const disposition = url.searchParams.get('disposition') === 'inline' ? 'inline' : 'attachment';
    
        
    // First, get the category of the compiled document from the database
    const categoryQuery = `
      SELECT category 
      FROM compiled_documents 
      WHERE id = $1
    `;
    
    const categoryResult = await client.queryObject(categoryQuery, [numericId]);
    
    if (!categoryResult.rowCount || categoryResult.rowCount === 0) {
      ctx.response.status = 404;
      ctx.response.body = { error: `Compiled document with ID ${id} not found` };
      return;
    }
    
    // Get the category from the database result
    const dbCategory = (categoryResult.rows[0] as any).category;
    
    // Use the explicitly provided category parameter if available, otherwise use the database value
    const category = categoryParam || dbCategory;
        
    // Fetch the foreword file path from the compiled_documents table
    const forewordQuery = `
      SELECT foreword
      FROM compiled_documents
      WHERE id = $1
    `;
    
    const forewordResult = await client.queryObject(forewordQuery, [numericId]);
    
    if (!forewordResult.rowCount || forewordResult.rowCount === 0) {
      ctx.response.status = 404;
      ctx.response.body = { error: `Foreword for compiled document with ID ${id} not found` };
      return;
    }
    
    // Get the foreword path
    const forewordPath = (forewordResult.rows[0] as any).foreword;
    
    if (!forewordPath) {
      ctx.response.status = 404;
      ctx.response.body = { error: `No foreword file path defined for compiled document with ID ${id}` };
      return;
    }
    
        
    // Try to load the foreword file
    try {
      // Get the workspace root directory (parent of Deno directory)
      const workspaceRoot = Deno.cwd().replace(/[\\/]Deno$/, '');
      
      // Remove any leading slash from the path if present
      const normalizedPath = forewordPath.startsWith('/') ? forewordPath.substring(1) : forewordPath;
      const pathParts = normalizedPath.split(/[\\/]+/u);
      if (pathParts.includes('..') || pathParts.some((part: string) => /^[A-Za-z]:$/u.test(part))) {
        throw new Error('Unsafe foreword path');
      }
      
      // Create absolute path from workspace root
      const absolutePath = resolve(workspaceRoot, normalizedPath);
      const workspacePrefix = workspaceRoot.endsWith('/') ? workspaceRoot : `${workspaceRoot}/`;
      if (absolutePath !== workspaceRoot && !absolutePath.startsWith(workspacePrefix)) {
        throw new Error('Unsafe foreword path');
      }
            
      // Check if the file exists
      const fileInfo = await Deno.stat(absolutePath);
      if (!fileInfo.isFile) throw new Error('Foreword is not a file');
      
      // Check if the file is a PDF based on extension
      const isPdf = normalizedPath.toLowerCase().endsWith('.pdf');
      const countedDownload = isPdf && disposition === "attachment";
      
      // If it's a PDF and format isn't explicitly set to 'json', serve it directly with the proper content type
      if (isPdf) {
        // Set PDF content type and explicit disposition without exposing the
        // source storage path.
        ctx.response.headers.set('Content-Type', 'application/pdf');
        const safeCategory = String(category || 'compiled-publication').replace(/[^A-Za-z0-9]+/gu, '-').replace(/^-+|-+$/gu, '').toLowerCase() || 'compiled-publication';
        ctx.response.headers.set('Content-Disposition', `${disposition}; filename="${safeCategory}-foreword.pdf"`);
        
        // Disable cache for development ease
        ctx.response.headers.set('Cache-Control', 'no-cache, no-store, must-revalidate');
        ctx.response.headers.set('Pragma', 'no-cache');
        ctx.response.headers.set('Expires', '0');
        
        // Read and serve the file directly
        const file = await Deno.readFile(absolutePath);
        const pdfSignature = new TextDecoder().decode(file.subarray(0, 5));
        if (file.byteLength < 5 || pdfSignature !== "%PDF-") {
          ctx.response.status = 415;
          ctx.response.body = { error: "Foreword file signature is invalid" };
          return;
        }
        if (countedDownload) {
          if (String(ctx.state.user.role).toLowerCase() === "user") {
            await recordRepositoryActivity({ recordType: "compiled", recordId: numericId, audience: "registered", action: "download", registeredUserId: String(ctx.state.user.id) }).catch(() => undefined);
          }
        }
        ctx.response.body = file;
        await SystemLogsModel.createLog({
          log_type: "document",
          user_id: String(ctx.state.user.id),
          username: String(ctx.state.user.id),
          action: disposition === "inline" ? "Compiled foreword inline view" : "Compiled foreword download",
          details: { compiled_document_id: numericId, disposition },
          status: "success",
          related_id: String(numericId),
        }).catch(() => undefined);
        return;
      }
      
      ctx.response.status = 415;
      ctx.response.body = { error: "Foreword file is not a PDF" };
    } catch (fileError) {
      ctx.response.status = 404;
      console.error("Compiled foreword delivery failed", { code: "FOREWORD_DELIVERY_FAILED" });
      ctx.response.body = { error: "Failed to read foreword file", code: "FOREWORD_DELIVERY_FAILED" };
    }
  } catch (error) {
    ctx.response.status = 500;
    console.error("Compiled foreword lookup failed", { code: "COMPILED_FOREWORD_LOOKUP_FAILED", error });
    ctx.response.body = { error: "Failed to fetch foreword for compiled document", code: "COMPILED_FOREWORD_LOOKUP_FAILED" };
  }
});

// Add route for user library
router.all("/api/user/library(/.*)?", async (ctx) => {
  try {
        
    // Convert Oak request to standard Request
    const headers = new Headers(ctx.request.headers);
    
    // Create body if needed
    let body = null;
    if (ctx.request.hasBody) {
      const reqBody = ctx.request.body({ type: "json" });
      body = await reqBody.value;
    }
    
    // Create a Request object
    const request = new Request(ctx.request.url.toString(), {
      method: ctx.request.method,
      headers: headers,
      body: body ? JSON.stringify(body) : undefined
    });
    
    // Process through the API handler
    const response = await handleLibraryRequest(request);
    
    // Set status and headers
    ctx.response.status = response.status;
    for (const [key, value] of response.headers.entries()) {
      ctx.response.headers.set(key, value);
    }
    
    // Set body
    if (response.status !== 204) {
      const responseBody = await response.text();
      try {
        // Try to parse as JSON first
        const jsonBody = JSON.parse(responseBody);
        ctx.response.body = jsonBody;
      } catch {
        // If not JSON, use as is
        ctx.response.body = responseBody;
      }
    }
  } catch (error) {
    ctx.response.status = 500;
    ctx.response.body = {
      error: "Internal server error processing user library request",
      details: error instanceof Error ? error.message : String(error)
    };
  }
});

// Add endpoint to save compiled documents to user's library
router.post("/api/compiled-documents/save-to-library", isAuthenticated, async (ctx) => {
  try {
    {
      // User ID comes from the authenticated session (owner-scoped)
      const userId = ctx.state.user.id;
      
      // Get document ID from request body
      const body = await ctx.request.body({ type: "json" }).value;
      
      if (!body.documentId) {
        ctx.response.status = 400;
        ctx.response.body = { error: "Document ID is required" };
        return;
      }
      
      const documentId = parseInt(String(body.documentId), 10);
      
      if (isNaN(documentId)) {
        ctx.response.status = 400;
        ctx.response.body = { error: "Invalid document ID" };
        return;
      }
      
            
      // Import the UserLibraryModel dynamically
      const { UserLibraryModel } = await import("./models/userLibraryModel.ts");
      
      // Check if the document is already in the library
      const isInLibrary = await UserLibraryModel.isInLibrary(userId, documentId, "compiled");
      
      if (isInLibrary) {
        ctx.response.status = 200;
        ctx.response.body = {
          success: true,
          message: "Document is already in your library",
          inLibrary: true,
          count: await UserLibraryModel.getLibraryCount(userId)
        };
        return;
      }
      
      // Add the document to the library
      const result = await UserLibraryModel.addToLibrary(userId, documentId, "compiled");
      
      if (result) {
        // Get the updated library count
        const libraryCount = await UserLibraryModel.getLibraryCount(userId);
        
        ctx.response.status = 200;
        ctx.response.body = {
          success: true,
          message: "Compiled document added to library successfully",
          count: libraryCount
        };
      } else {
        throw new Error("Failed to add compiled document to library");
      }
    }
  } catch (error) {
    ctx.response.status = 500;
    ctx.response.body = {
      error: "Failed to add compiled document to library",
      details: error instanceof Error ? error.message : String(error)
    };
  }
});

// Also add a matching endpoint for the alternative method
router.post("/api/library/save-compiled", isAuthenticated, async (ctx) => {
  try {
    // User ID comes from the authenticated session (owner-scoped)
    const userId = ctx.state.user.id;
    
    // Get document ID from request body
    const body = await ctx.request.body({ type: "json" }).value;
    
    if (!body.compiledDocumentId) {
      ctx.response.status = 400;
      ctx.response.body = { error: "Compiled document ID is required" };
      return;
    }
    
    const documentId = parseInt(String(body.compiledDocumentId), 10);
    
    if (isNaN(documentId)) {
      ctx.response.status = 400;
      ctx.response.body = { error: "Invalid document ID" };
      return;
    }
    
        
    // Import the UserLibraryModel dynamically
    const { UserLibraryModel } = await import("./models/userLibraryModel.ts");
    
    // Check if the document is already in the library
    const isInLibrary = await UserLibraryModel.isInLibrary(userId, documentId, "compiled");
    
    if (isInLibrary) {
      ctx.response.status = 200;
      ctx.response.body = {
        success: true,
        message: "Document is already in your library",
        inLibrary: true,
        count: await UserLibraryModel.getLibraryCount(userId)
      };
      return;
    }
    
    // Add the document to the library
    const result = await UserLibraryModel.addToLibrary(userId, documentId, "compiled");
    
    if (result) {
      // Get the updated library count
      const libraryCount = await UserLibraryModel.getLibraryCount(userId);
      
      ctx.response.status = 200;
      ctx.response.body = {
        success: true,
        message: "Compiled document added to library successfully via alternative method",
        count: libraryCount
      };
    } else {
      throw new Error("Failed to add compiled document to library");
    }
  } catch (error) {
    ctx.response.status = 500;
    ctx.response.body = {
      error: "Failed to add compiled document to library",
      details: error instanceof Error ? error.message : String(error)
    };
  }
});

// Import user document history handlers
import { 
  handleUserHistoryRequest
} from "./api/userDocumentHistory.ts";

// Legacy client-side document analytics are compatibility no-ops. Authoritative
// v2 activity is written by the successful server operation itself, preventing
// browser-supplied IDs and classifications from inflating reports.
router.post("/api/analytics/document-view", analyticsRateLimit, async (ctx) => {
  ctx.response.status = 204;
  ctx.response.headers.set("Deprecation", "true");
  ctx.response.headers.set("Sunset", "true");
});

router.post("/api/analytics/document-download", analyticsRateLimit, async (ctx) => {
  ctx.response.status = 204;
  ctx.response.headers.set("Deprecation", "true");
  ctx.response.headers.set("Sunset", "true");
});

// Add route for user history
router.get("/api/user/history", async (ctx) => {
  try {
        
    // Convert Oak request to standard Request
    const headers = new Headers(ctx.request.headers);
    
    // Create a Request object
    const request = new Request(ctx.request.url.toString(), {
      method: ctx.request.method,
      headers: headers
    });
    
    // Process through the API handler
    const response = await handleUserHistoryRequest(request);
    
    // Set status and headers
    ctx.response.status = response.status;
    for (const [key, value] of response.headers.entries()) {
      ctx.response.headers.set(key, value);
    }
    
    // Set body
    if (response.status !== 204) {
      const responseBody = await response.text();
      try {
        // Try to parse as JSON first
        const jsonBody = JSON.parse(responseBody);
        ctx.response.body = jsonBody;
      } catch {
        // If not JSON, use as is
        ctx.response.body = responseBody;
      }
    }
  } catch (error) {
    ctx.response.status = 500;
    ctx.response.body = {
      error: "Internal server error fetching user document history",
      details: error instanceof Error ? error.message : String(error)
    };
  }
});

// Add route for getting multiple documents by IDs
router.post("/api/documents/by-ids", isAuthenticated, async (ctx) => {
  try {
    if (!ctx.request.hasBody) {
      ctx.response.status = 400;
      ctx.response.body = { error: "Request body is required" };
      return;
    }
    
    // Parse the request body to get the document IDs
    const body = await ctx.request.body({ type: "json" }).value;
    
    if (!body.documentIds || !Array.isArray(body.documentIds) || body.documentIds.length === 0) {
      ctx.response.status = 400;
      ctx.response.body = { error: "Document IDs array is required" };
      return;
    }
    
        
    // Query the database for the documents
    const query = `
      SELECT id, title, document_type, abstract, publication_date,
             (file_path IS NOT NULL AND file_path <> '') AS has_file,
             is_public, created_at, updated_at
      FROM documents
      WHERE id = ANY($1::int[])
      AND deleted_at IS NULL
    `;
    
    const result = await client.queryObject(query, [body.documentIds]);
    
        
    // Map the results to the expected format
    const documents = result.rows.map((row: any) => ({
      id: row.id,
      title: row.title || 'Untitled Document',
      document_type: row.document_type || 'single',
      abstract: row.abstract,
      publication_date: row.publication_date,
      has_file: row.has_file,
      download_url: row.has_file ? `/api/documents/${row.id}/download` : null,
      is_public: row.is_public,
      created_at: row.created_at,
      updated_at: row.updated_at
    }));
    
    // Return the documents
    ctx.response.status = 200;
    ctx.response.body = { documents };
  } catch (error) {
    ctx.response.status = 500;
    ctx.response.body = { error: "Internal server error" };
  }
});

// Serve PDF files with proper content type
// Oak's router types only admit string paths, but path-to-regexp (used at
// runtime) accepts RegExp, hence the cast.
router.get(/\.(pdf)$/i as unknown as string, async (ctx: RouterContext<string>) => {
  try {
    const urlPath = ctx.request.url.pathname;

    if (isProtectedDocumentFilePath(urlPath)) {
      ctx.response.status = 403;
      ctx.response.body = {
        error: "Protected document files must be accessed through an approved download route",
      };
      return;
    }
        
    // Map URL path to file system path
    let filePath = urlPath;
    
    // Resolve relative to workspace root
    if (filePath.startsWith('/storage/')) {
      filePath = filePath.substring(1); // Remove leading slash
    } else if (filePath.startsWith('/files/') || filePath.startsWith('/uploads/')) {
      filePath = filePath.substring(1); // Remove leading slash
    }
    
    // Get absolute path
    const absolutePath = join(Deno.cwd(), '..', filePath);
        
    try {
      // Check if file exists
      await Deno.stat(absolutePath);
      
      // Set PDF content type header
      ctx.response.headers.set('Content-Type', 'application/pdf');
      
      // Disable cache for development ease
      ctx.response.headers.set('Cache-Control', 'no-cache, no-store, must-revalidate');
      ctx.response.headers.set('Pragma', 'no-cache');
      ctx.response.headers.set('Expires', '0');
      
      // Send the file
      const file = await Deno.readFile(absolutePath);
      ctx.response.body = file;
      
    } catch (err: unknown) {
      ctx.response.status = 404;
      ctx.response.body = { error: 'PDF file not found' };
    }
  } catch (error: unknown) {
    ctx.response.status = 500;
    ctx.response.body = { error: 'Internal server error' };
  }
});

function sanitizeAuthorDisplayName(value: unknown, fieldErrors: Record<string, string>, field: string) {
  if (value !== undefined && value !== null && typeof value !== "string") {
    fieldErrors[field] = "Enter the publication display name as text.";
    return "";
  }
  const normalized = String(value ?? "").normalize("NFC").trim().replace(/\s+/gu, " ");
  if (!normalized) {
    fieldErrors[field] = "Enter the author’s publication display name.";
    return "";
  }
  if (normalized.length > 255) {
    fieldErrors[field] = "The publication display name must be 255 characters or fewer.";
  }
  if (/[\u0000-\u001F\u007F]/u.test(normalized)) {
    fieldErrors[field] = "The publication display name contains unsupported characters.";
  }
  return normalized;
}

function normalizeOptionalAuthorValue(value: unknown, maxLength: number, fieldErrors: Record<string, string>, field: string) {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value !== "string") {
    fieldErrors[field] = "Enter a text value or leave this field empty.";
    return "";
  }
  const normalized = String(value).normalize("NFC").trim().replace(/\s+/gu, " ");
  if (normalized.length > maxLength) {
    fieldErrors[field] = `This field must be ${maxLength} characters or fewer.`;
  }
  if (/[\u0000-\u001F\u007F]/u.test(normalized)) {
    fieldErrors[field] = "This field contains unsupported characters.";
  }
  return normalized;
}

function isAuthorUniqueViolation(error: unknown) {
  return typeof error === "object" && error !== null && "fields" in error &&
    String((error as { fields?: { code?: string } }).fields?.code) === "23505";
}

function authorUniqueField(error: unknown): "full_name" | "spud_id" | undefined {
  if (typeof error !== "object" || error === null || !("fields" in error)) return undefined;
  const constraint = String((error as { fields?: { constraint?: string } }).fields?.constraint ?? "").toLowerCase();
  if (constraint.includes("spud")) return "spud_id";
  if (constraint.includes("full_name") || constraint.includes("normalized")) return "full_name";
  return undefined;
}

// Start the server
await startServer();
