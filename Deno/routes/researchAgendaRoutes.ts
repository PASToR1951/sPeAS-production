import { Router } from "../deps.ts";
import {
    handleCreateResearchAgendaItem,
    handleCreateResearchAgendaItems,
} from "../api/researchAgenda.ts";
import { isAuthenticated, isAdmin, requireCapability } from "../middleware/authMiddleware.ts";
import { canModifyPendingUpload, canViewDocument } from "../services/contentAuthorizationService.ts";
import { getSessionFromHeaders } from "../services/sessionService.ts";
import { getDocumentClassification, listPublicResearchAgendas, normalizeClassificationTerm, replaceDocumentClassification, replaceDocumentKeywords } from "../services/documentClassificationService.ts";

// Create a router for research agenda routes
const router = new Router();
const requireDocumentUpload = requireCapability("documents:upload");

// Research Agenda route handlers
const addResearchAgendaItems = async (ctx: any) => {
    const bodyParser = await ctx.request.body({type: "json"});
    const body = await bodyParser.value;

    if (!await canModifyPendingUpload(ctx.state.user, body.document_id)) {
        ctx.response.status = 403;
        ctx.response.body = { error: "You cannot change research agenda items for this document" };
        return;
    }
    
    if (!Array.isArray(body.agenda_items) && !Array.isArray(body.agenda_ids)) {
        ctx.response.status = 400;
        ctx.response.body = { error: "agenda_items or agenda_ids must be an array" };
        return;
    }

    try {
        const documentId = Number(body.document_id);
        const actor = { id: String(ctx.state.user.id), role: String(ctx.state.user.role) };
        let classification;
        if (Array.isArray(body.agenda_ids)) {
            const current = await getDocumentClassification(documentId, true);
            classification = await replaceDocumentClassification(documentId, {
                researchAgendaIds: body.agenda_ids,
                primaryResearchAgendaId: body.agenda_ids[0],
                topicIds: current.topics.map((item) => item.id),
                keywords: current.keywords.map((item) => item.name),
            }, actor, { allowIncomplete: true });
        } else {
            classification = await replaceDocumentKeywords(documentId, body.agenda_items, actor);
        }
        ctx.response.status = 200;
        ctx.response.headers.set("Deprecation", "true");
        ctx.response.headers.set("Sunset", "2026-12-31");
        ctx.response.body = { message: "Stored legacy values without creating research agenda records", classification };
    } catch (error) {
        ctx.response.status = 422;
        ctx.response.body = { error: error instanceof Error ? error.message : "Unable to update classification" };
    }
};

const getResearchAgendaItems = async (ctx: any) => {
    const documentId = ctx.params.documentId;
    const session = await getSessionFromHeaders(ctx.request.headers);
    if (!await canViewDocument(session, documentId)) {
        ctx.response.status = 404;
        ctx.response.body = { error: "Document not found" };
        return;
    }
    
    const classification = await getDocumentClassification(Number(documentId), session?.role === "admin");
    ctx.response.status = 200;
    ctx.response.headers.set("Deprecation", "true");
    ctx.response.headers.set("Sunset", "2026-12-31");
    ctx.response.headers.set("Link", `</api/documents/${documentId}/classification>; rel="successor-version"`);
    ctx.response.body = { items: classification.researchAgendas, classification };
};

// New handler for creating a single research agenda item
const createResearchAgendaItem = async (ctx: any) => {
    const bodyParser = await ctx.request.body({type: "json"});
    const body = await bodyParser.value;
    
    // Convert context to Request
    const request = new Request(ctx.request.url.toString(), {
        method: "POST",
        headers: ctx.request.headers,
        body: JSON.stringify(body)
    });
    
    const response = await handleCreateResearchAgendaItem(request);
    
    // Convert Response back to context
    ctx.response.status = response.status;
    ctx.response.headers = response.headers;
    ctx.response.body = await response.json();
};

// New handler for batch creation of research agenda items
const createResearchAgendaItems = async (ctx: any) => {
    const bodyParser = await ctx.request.body({type: "json"});
    const body = await bodyParser.value;
    
    // Convert context to Request
    const request = new Request(ctx.request.url.toString(), {
        method: "POST",
        headers: ctx.request.headers,
        body: JSON.stringify(body)
    });
    
    const response = await handleCreateResearchAgendaItems(request);
    
    // Convert Response back to context
    ctx.response.status = response.status;
    ctx.response.headers = response.headers;
    ctx.response.body = await response.json();
};

// New handler for searching research agenda items
const searchResearchAgendaItems = async (ctx: any) => {
    const query = ctx.request.url.searchParams.get("q") || "";
    const normalized = normalizeClassificationTerm(query);
    const agendas = await listPublicResearchAgendas(false);
    ctx.response.status = 200;
    ctx.response.headers.set("Deprecation", "true");
    ctx.response.headers.set("Sunset", "2026-12-31");
    ctx.response.headers.set("Link", '</api/research-agendas>; rel="successor-version"');
    ctx.response.body = agendas.filter((agenda) => !normalized || normalizeClassificationTerm(agenda.name).includes(normalized));
};

// Register routes (writes are admin-only)
router.post("/document-research-agenda", isAuthenticated, requireDocumentUpload, addResearchAgendaItems);
router.get("/document-research-agenda/:documentId", getResearchAgendaItems);
router.post("/research-agenda-items", isAuthenticated, isAdmin, createResearchAgendaItem);
router.post("/research-agenda-items/batch", isAuthenticated, isAdmin, createResearchAgendaItems);
router.get("/research-agenda-items/search", searchResearchAgendaItems);

// Export the routes
export const researchAgendaRoutes = router.routes();

// Define the route interface for compatibility with index.ts
export interface Route {
    method: string;
    path: string;
    handler: (context: any) => Promise<void> | void;
    middleware?: ((ctx: any, next: any) => Promise<void> | void)[];
}

// Keep the original array export for backward compatibility (writes are admin-only)
export const researchAgendaRoutesArray: Route[] = [
    // Document-related research agenda routes
    { method: "POST", path: "/document-research-agenda", handler: addResearchAgendaItems, middleware: [isAuthenticated, requireDocumentUpload] },
    { method: "GET", path: "/document-research-agenda/:documentId", handler: getResearchAgendaItems },

    // Standalone research agenda item routes
    { method: "POST", path: "/research-agenda-items", handler: createResearchAgendaItem, middleware: [isAuthenticated, isAdmin] },
    { method: "POST", path: "/research-agenda-items/batch", handler: createResearchAgendaItems, middleware: [isAuthenticated, isAdmin] },
    { method: "GET", path: "/research-agenda-items/search", handler: searchResearchAgendaItems },
];
