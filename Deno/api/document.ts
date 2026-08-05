import { 
    fetchDocuments, 
    getDocumentById, 
    createDocument, 
    updateDocument, 
    deleteDocument,
    getDocumentAuthors 
} from "../controllers/documentController.ts";
import { DocumentModel } from "../models/documentModel.ts";

/**
 * Handle fetch documents request
 */
export async function handleFetchDocuments(req: Request): Promise<Response> {
    if (req.method === "GET") {
        return await fetchDocuments(req);
    }
    return new Response("Method Not Allowed", { status: 405 });
}

/**
 * Handle document by ID operations (GET, PUT, DELETE)
 */
export async function handleDocumentById(req: Request): Promise<Response> {
    const method = req.method;
    
    switch (method) {
        case "GET":
            return await getDocumentById(req);
        case "PUT":
            return await updateDocument(req);
        case "DELETE":
            return await deleteDocument(req);
        default:
            return new Response("Method Not Allowed", { status: 405 });
    }
}

/**
 * Handle document authors request
 */
export async function handleDocumentAuthors(req: Request): Promise<Response> {
    if (req.method === "GET") {
        return await getDocumentAuthors(req);
    }
    return new Response("Method Not Allowed", { status: 405 });
}

/**
 * Handle document creation
 */
export async function handleCreateDocument(req: Request): Promise<Response> {
    if (req.method === "POST") {
        return await createDocument(req);
    }
    return new Response("Method Not Allowed", { status: 405 });
}

/**
 * Handle document update
 */
export async function handleUpdateDocument(req: Request): Promise<Response> {
    if (req.method === "PUT") {
        return await updateDocument(req);
    }
    return new Response("Method Not Allowed", { status: 405 });
}

/**
 * Handle document deletion
 */
export async function handleDeleteDocument(req: Request): Promise<Response> {
    if (req.method === "DELETE") {
        return await deleteDocument(req);
    }
    return new Response("Method Not Allowed", { status: 405 });
}

/**
 * Handle permanent document deletion
 */
export async function handleHardDeleteDocument(req: Request): Promise<Response> {
    if (req.method === "DELETE") {
        try {
            const url = new URL(req.url);
            const path = url.pathname;
            const documentId = path.split("/").pop();
            
            if (!documentId) {
                return new Response(JSON.stringify({ error: "Document ID is required" }), {
                    status: 400,
                    headers: { "Content-Type": "application/json" }
                });
            }
            
            // Validate documentId is a valid number
            if (isNaN(Number(documentId)) || !Number.isInteger(Number(documentId))) {
                return new Response(JSON.stringify({ error: "Invalid document ID. ID must be a valid integer." }), {
                    status: 400,
                    headers: { "Content-Type": "application/json" }
                });
            }
            
            // Check if document exists and is already soft-deleted
            const existingDocument = await DocumentModel.getById(parseInt(documentId));
            
            if (!existingDocument) {
                return new Response(JSON.stringify({ error: "Document not found" }), {
                    status: 404,
                    headers: { "Content-Type": "application/json" }
                });
            }
            
            // Perform hard delete
            await DocumentModel.delete(parseInt(documentId));
            
            return new Response(JSON.stringify({ 
                message: "Document permanently deleted successfully",
                id: documentId 
            }), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
            return new Response(JSON.stringify({ error: errorMessage }), {
                status: 500,
                headers: { "Content-Type": "application/json" }
            });
        }
    }
    return new Response("Method Not Allowed", { status: 405 });
}
