import { createCompiledDocument as createCompiledDocumentService, getCompiledDocument as getCompiledDocumentService, addDocumentToCompilation as addDocumentToCompilationService, removeDocumentFromCompilation as removeDocumentFromCompilationService, softDeleteCompiledDocument as softDeleteCompiledDocumentService, updateCompiledDocument as updateCompiledDocumentService } from "../services/documentService.ts";
import { getDocumentClassification } from "../services/documentClassificationService.ts";
import { validateCompiledVolume, validateCompiledYearRange } from "../services/documentMetadataValidationService.ts";
import { isAbstractTooLong, normalizeManualAbstract, queueCompiledForewordAbstract } from "../services/abstractWorkflowService.ts";

/**
 * Creates a new compiled document
 * @param compiledDoc The compiled document data
 * @param documentIds Array of document IDs to associate with the compiled document
 * @returns The created compiled document ID
 */
export async function createCompiledDocument(
  compiledDoc: {
    start_year: number;
    end_year: number;
    volume?: number;
    issue_number?: number;
    department?: string;
    category?: string;
    foreword?: string;
    abstract_foreword?: string;
    abstract_foreword_source?: 'none' | 'manual' | 'pdf_text' | 'ocr' | 'legacy';
    uploaded_by?: string;
    review_status?: 'pending_review' | 'approved' | 'rejected';
    reviewed_by?: string;
    reviewed_at?: string;
  },
  documentIds: number[]
): Promise<number> {
  return await createCompiledDocumentService(compiledDoc, documentIds);
}

/**
 * Fetches a compiled document by ID
 * @param compiledDocId The compiled document ID
 * @returns The compiled document data
 */
export async function getCompiledDocument(compiledDocId: number): Promise<any> {
  try {
    // Get basic document data
    const compiledDoc = await getCompiledDocumentService(compiledDocId);
    
    if (!compiledDoc) {
      return null;
    }
    
    // Explicitly log the foreword field for debugging
    if (compiledDoc.foreword) {
          } else {
          }
    
    // Create a response object with all fields from compiledDoc plus any additional fields
    const response = {
      ...compiledDoc,
      classification: await getDocumentClassification(compiledDocId, false),
      // Expose only reviewed collection text; the foreword path is never abstract content.
      abstract: compiledDoc.abstract_foreword || ''
    };
    
        
    return response;
  } catch (error) {
    throw error;
  }
}

/**
 * Adds a document to a compilation
 * @param compiledDocId The compiled document ID
 * @param documentId The document ID to add
 */
export async function addDocumentToCompilation(compiledDocId: number, documentId: number): Promise<void> {
  await addDocumentToCompilationService(compiledDocId, documentId);
}

/**
 * Removes a document from a compilation
 * @param compiledDocId The compiled document ID
 * @param documentId The document ID to remove
 */
export async function removeDocumentFromCompilation(compiledDocId: number, documentId: number): Promise<void> {
  await removeDocumentFromCompilationService(compiledDocId, documentId);
}

/**
 * HTTP handler for creating a compiled document
 * @param request The HTTP request
 * @returns The HTTP response
 */
export async function handleCreateCompiledDocument(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const body = await request.json();
    
    if (!body.compiledDoc || typeof body.compiledDoc !== 'object') {
      return new Response(JSON.stringify({ error: 'compiledDoc is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const yearErrors = validateCompiledYearRange(body.compiledDoc.start_year, body.compiledDoc.end_year);
    const volumeError = validateCompiledVolume(body.compiledDoc.volume);
    if (volumeError) yearErrors["compiledDoc.volume"] = volumeError;
    if (Object.keys(yearErrors).length) {
      return new Response(JSON.stringify({
        error: 'A valid compiled-publication year range is required.',
        fields: yearErrors,
      }), {
        status: 422,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Default to empty array if documentIds not provided
    const documentIds = Array.isArray(body.documentIds) ? body.documentIds : [];

    const normalizedForewordAbstract = normalizeManualAbstract(body.compiledDoc.abstract_foreword);
    if (isAbstractTooLong(body.compiledDoc.abstract_foreword)) {
      return new Response(JSON.stringify({ error: 'Collection overview must be 10,000 Unicode characters or fewer.', fields: { abstract_foreword: 'Collection overview must be 10,000 Unicode characters or fewer.' } }), { status: 422, headers: { 'Content-Type': 'application/json' } });
    }
    body.compiledDoc.abstract_foreword = normalizedForewordAbstract;
    body.compiledDoc.abstract_foreword_source = normalizedForewordAbstract ? "manual" : "none";
    const hasForewordPdf = typeof body.compiledDoc.foreword === "string"
      && body.compiledDoc.foreword.trim().length > 0
      && !body.compiledDoc.foreword.trim().endsWith("/");
    const needsForewordExtraction = hasForewordPdf && !normalizedForewordAbstract;
    if (needsForewordExtraction) {
      body.compiledDoc.review_status = "pending_review";
      body.compiledDoc.reviewed_by = null;
      body.compiledDoc.reviewed_at = null;
    }

    // Log the abstract_foreword field if it's provided
    if (body.compiledDoc.abstract_foreword) {
          }

    const compiledDocId = await createCompiledDocument(body.compiledDoc, documentIds);

    if (needsForewordExtraction) await queueCompiledForewordAbstract(Number(compiledDocId));

    return new Response(JSON.stringify({
      id: compiledDocId,
      success: true,
      reviewStatus: body.compiledDoc.review_status || "approved",
    }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to create compiled document';
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

/**
 * HTTP handler for getting a compiled document by ID
 * @param request The HTTP request
 * @returns The HTTP response
 */
export async function handleGetCompiledDocument(request: Request): Promise<Response> {
  if (request.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const url = new URL(request.url);
  const pathParts = url.pathname.split('/');
  const id = parseInt(pathParts[pathParts.length - 1], 10);

  if (isNaN(id)) {
    return new Response(JSON.stringify({ error: 'Invalid ID' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const compiledDoc = await getCompiledDocument(id);
    
    if (!compiledDoc) {
      return new Response(JSON.stringify({ error: 'Compiled document not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify(compiledDoc), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to fetch compiled document';
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

/**
 * HTTP handler for adding documents to a compilation
 * @param request The HTTP request
 * @returns The HTTP response
 */
export async function handleAddDocumentsToCompilation(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const body = await request.json();
    
    if (!body.compiledDocumentId || isNaN(parseInt(body.compiledDocumentId, 10))) {
      return new Response(JSON.stringify({ error: 'Valid compiledDocumentId is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (!Array.isArray(body.documentIds) || body.documentIds.length === 0) {
      return new Response(JSON.stringify({ error: 'documentIds array is required and cannot be empty' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const compiledDocumentId = parseInt(body.compiledDocumentId, 10);
    const results = [];

    // Process each document ID and track results
    for (const docId of body.documentIds) {
      try {
        await addDocumentToCompilation(compiledDocumentId, docId);
        results.push({ documentId: docId, success: true });
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : `Failed to add document ${docId}`;
        results.push({ documentId: docId, success: false, error: errorMessage });
      }
    }

    return new Response(JSON.stringify({ 
      success: true,
      results
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to add documents to compilation';
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

/**
 * HTTP handler for soft deleting a compiled document by ID
 * @param request The HTTP request
 * @returns The HTTP response
 */
export async function handleSoftDeleteCompiledDocument(request: Request): Promise<Response> {
  if (request.method !== 'DELETE') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const url = new URL(request.url);
  const pathParts = url.pathname.split('/');
  const id = parseInt(pathParts[pathParts.length - 2], 10); // Get ID from /compiled-documents/:id/soft-delete

  if (isNaN(id)) {
    return new Response(JSON.stringify({ error: 'Invalid ID' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    await softDeleteCompiledDocumentService(id);
    
    return new Response(JSON.stringify({
      success: true,
      message: 'Compiled document successfully archived',
      id: id
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error: unknown) {
    // Check for specific errors to return appropriate status codes
    const errorMessage = error instanceof Error ? error.message : 'Failed to archive compiled document';
    
    if (errorMessage.includes('not found')) {
      return new Response(JSON.stringify({ error: errorMessage }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    if (errorMessage.includes('already archived')) {
      return new Response(JSON.stringify({ error: errorMessage }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

/**
 * Updates an existing compiled document
 * @param compiledDocId The compiled document ID
 * @param compiledDoc The updated compiled document data
 * @returns The updated compiled document data
 */
export async function updateCompiledDocument(
  compiledDocId: number,
  compiledDoc: {
    start_year?: number;
    end_year?: number;
    volume?: number;
    issue_number?: number;
    department?: string;
    category?: string;
    foreword?: string;
    abstract_foreword?: string;
    title?: string;
    authors?: any[];
    topics?: any[];
    research_agenda?: any[];
  }
): Promise<any> {
  try {
    // Get the current document to make sure it exists
    const existingDoc = await getCompiledDocumentService(compiledDocId);
    
    if (!existingDoc) {
      throw new Error(`Compiled document with ID ${compiledDocId} not found`);
    }
    
        
    // Update the document
    const updatedDoc = await updateCompiledDocumentService(compiledDocId, compiledDoc);
    return updatedDoc;
  } catch (error) {
    throw error;
  }
}

/**
 * HTTP handler for updating a compiled document
 * @param request The HTTP request
 * @returns The HTTP response
 */
export async function handleUpdateCompiledDocument(request: Request): Promise<Response> {
  if (request.method !== 'PUT') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const url = new URL(request.url);
  const pathParts = url.pathname.split('/');
  const id = parseInt(pathParts[pathParts.length - 1], 10);

  if (isNaN(id)) {
    return new Response(JSON.stringify({ error: 'Invalid ID' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    // Parse the request body
    let body;
    try {
      body = await request.json();
    } catch (e) {
      return new Response(JSON.stringify({ error: 'Invalid JSON in request body' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // Update the document
    const updatedDoc = await updateCompiledDocument(id, body);
    
    return new Response(JSON.stringify({
      success: true,
      document: updatedDoc
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to update compiled document';
    
    // Special handling for document not found
    if (errorMessage.includes('not found')) {
      return new Response(JSON.stringify({ error: errorMessage }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
