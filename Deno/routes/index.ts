import { Router } from "../deps.ts";
import { userRoutes } from "./userRoutes.ts";
import { permissionsRoutes } from "./permissionsRoutes.ts";
import { documentRoutes } from "./documentRoutes.ts";
import { authRoutes } from "./authRoutes.ts";
import { researchAgendaRoutesArray } from "./researchAgendaRoutes.ts";
import { compiledDocumentRoutes } from "./compiledDocumentRoutes.ts";
import { documentEditRoutes } from "./documentEditRoutes.ts";
import { paperRoutes } from "./paperRoutes.ts";
// author routes are now handled directly in server.ts

// Define the route interface
export interface Route {
  method: string;
  path: string;
  handler: (context: any) => Promise<void> | void;
  /** Optional middleware (e.g. isAuthenticated, isAdmin) run before the handler */
  middleware?: ((ctx: any, next: any) => Promise<void> | void)[];
}

// Root route handler
const rootHandler = (ctx: any) => {
  ctx.response.body = {
    message: "Welcome to PEAS API",
    version: "1.0.0",
    endpoints: {
      users: "/users",
      auth: "/auth",
      documents: "/documents",
      permissions: "/permissions",
      researchAgenda: "/document-research-agenda",
      authors: "/authors",
      compiledDocuments: "/compiled-documents",
      documentEdit: "/document-edit"
    }
  };
};

// Map document routes to /api/documents path
const apiDocumentRoutes = documentRoutes.map(route => {
  const newPath = route.path.replace(/^\/documents/, '/api/documents')
                           .replace(/^\/guest\/documents/, '/api/guest/documents')
                           .replace(/^\/public\/documents/, '/api/public/documents');
  console.log(`Mapping route: ${route.path} → ${newPath}`);
  return {
    ...route,
    path: newPath
  };
});

const apiPaperRoutes = paperRoutes.map(route => ({
  ...route,
  path: route.path.replace(/^\/papers/, "/api/papers"),
}));

// Map compiled document routes to /api/compiled-documents path
const apiCompiledDocumentRoutes = compiledDocumentRoutes.map(route => {
  const newPath = route.path.replace(/^\/compiled-documents/, '/api/compiled-documents')
                           .replace(/^\/guest\/compiled-documents/, '/api/guest/compiled-documents')
                           .replace(/^\/public\/compiled-documents/, '/api/public/compiled-documents');
  console.log(`Mapping route: ${route.path} → ${newPath}`);
  return {
    ...route,
    path: newPath
  };
});

// Map document edit routes to /api/document-edit path
const apiDocumentEditRoutes = documentEditRoutes.map(route => {
  const newPath = route.path.replace(/^\/document-edit/, '/api/document-edit');
  console.log(`Mapping route: ${route.path} → ${newPath}`);
  return {
    ...route,
    path: newPath
  };
});

// Map research agenda routes to /api path
const apiResearchAgendaRoutes = researchAgendaRoutesArray.map(route => {
  const newPath = `/api${route.path}`;
  console.log(`Mapping research agenda route: ${route.path} → ${newPath}`);
  return {
    ...route,
    path: newPath
  };
});

// Combine all routes into a single array
export const routes: Route[] = [
  // Root route
  { method: "GET", path: "/", handler: rootHandler },
  // Other routes
  ...userRoutes,
  ...permissionsRoutes,
  ...apiDocumentRoutes, // Use the mapped API document routes
  ...apiPaperRoutes,
  ...apiCompiledDocumentRoutes, // Use the mapped API compiled document routes
  ...apiDocumentEditRoutes, // Use the mapped API document edit routes
  ...authRoutes,
  ...apiResearchAgendaRoutes, // Use the mapped API research agenda routes
  // authorRoutes are now handled differently
];
