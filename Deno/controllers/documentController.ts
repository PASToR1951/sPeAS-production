import { DocumentModel } from "../models/documentModel.ts";
import { client } from "../db/denopost_conn.ts";
import { getErrorMessage } from "../utils/errorHandler.ts";
import { fetchDocuments as fetchDocumentsService, fetchChildDocuments as fetchChildDocumentsService } from "../services/documentService.ts";
import { getDocumentClassification, replaceDocumentClassification, ClassificationValidationError } from "../services/documentClassificationService.ts";
import { createDocumentAuthors } from "./documentAuthorController.ts";
import { validateSinglePublicationDate } from "../services/documentMetadataValidationService.ts";
import { isAbstractTooLong, normalizeManualAbstract, queueDocumentAbstract } from "../services/abstractWorkflowService.ts";

/**
 * Fetch categories from the database
 */
export async function fetchCategories(): Promise<Response> {
  try {
        
    // Get basic category information
    const categoriesResult = await client.queryObject(
      "SELECT id, category_name as name FROM categories ORDER BY category_name"
    );
    
    // Process the categories data
    const categories = categoriesResult.rows.map(row => {
      return {
        id: typeof (row as any).id === 'bigint' ? Number((row as any).id) : (row as any).id,
        name: (row as any).name || '',
        count: 0 // Initialize count to 0
      };
    });
    
    // Get counts for regular documents (excluding child documents of compilations)
    const regularDocsQuery = `
      SELECT category_id, COUNT(*) as count 
      FROM documents 
      WHERE deleted_at IS NULL 
      AND review_status = 'approved'
      AND compiled_parent_id IS NULL
      GROUP BY category_id
    `;
    
    const regularDocsResult = await client.queryObject(regularDocsQuery);
    
    // Update counts from regular documents
    if (regularDocsResult.rows) {
      for (const row of regularDocsResult.rows) {
        const categoryId = typeof (row as any).category_id === 'bigint' ? 
          Number((row as any).category_id) : (row as any).category_id;
        const count = typeof (row as any).count === 'bigint' ? 
          Number((row as any).count) : Number((row as any).count);
        
        // Find the matching category and update its count
        const category = categories.find(c => c.id === categoryId);
        if (category) {
          category.count = count;
        }
      }
    }
    
    // Get counts for compiled documents
    const compiledDocsQuery = `
      SELECT cd.category, COUNT(*) as count 
      FROM compiled_documents cd
      WHERE cd.deleted_at IS NULL
      AND cd.review_status = 'approved'
      GROUP BY cd.category
    `;
    
    const compiledDocsResult = await client.queryObject(compiledDocsQuery);
    
    // Update counts from compiled documents
    if (compiledDocsResult.rows) {
      for (const row of compiledDocsResult.rows) {
        const categoryName = ((row as any).category || '').toUpperCase();
        const count = typeof (row as any).count === 'bigint' ? 
          Number((row as any).count) : Number((row as any).count);
        
        // Find categories that match this name (case insensitive)
        for (const category of categories) {
          if (category.name.toUpperCase() === categoryName || 
              categoryName.includes(category.name.toUpperCase())) {
            category.count += count;
                        break;
          }
        }
      }
    }
    
    return new Response(JSON.stringify(categories), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}

/**
 * Handle GET request to fetch documents with filtering and pagination
 * @param request The fetch request object
 * @returns Response object with documents data
 */
export async function fetchDocuments(request: Request): Promise<Response> {
  try {
        
    // Get URL parameters for pagination and filtering
    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get("page") || "1");
    const size = parseInt(url.searchParams.get("size") || "10");
    const category = url.searchParams.get("category");
    const search = url.searchParams.get("search");
    const keyword = url.searchParams.get("keyword");
    const agenda = url.searchParams.get("agenda");
    const topic = url.searchParams.get("topic");
    const year = url.searchParams.get("year");
    const sort = url.searchParams.get("sort") || "latest";
    // Get doc_types parameter to support showing both single and compiled documents
    const docTypes = url.searchParams.get("doc_types") || "all";
    const includeReview = url.searchParams.get("include_review") === "true";
    const publicOnly = url.searchParams.get("public_only") === "true";
    const reviewStatus = url.searchParams.get("review_status") || "all";
    
    // Add debug logging for multiple categories
    if (category && category.includes(',')) {
            const categories = category.split(',').map(c => c.trim());
          }
    
        
    // ADDITIONAL DEBUGGING: Check if database client is available
    if (!client) {
      return new Response(JSON.stringify({
        error: "Database client is not available",
        documents: [],
        totalCount: 0,
        totalPages: 0,
        currentPage: page
      }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
    
    // ADDITIONAL DEBUGGING: Try a simple database query to confirm connection
    try {
            const testResult = await client.queryObject("SELECT 1 as test");
          } catch (testError: unknown) {
      return new Response(JSON.stringify({
        error: "Database connection failed",
        message: testError instanceof Error ? testError.message : String(testError),
        documents: [],
        totalCount: 0,
        totalPages: 0,
        currentPage: page
      }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
    
    // Convert sort parameter to appropriate order
    let sortField = 'id';
    let order = 'ASC';
    
    if (sort === 'latest') {
      sortField = 'publication_date';
      order = 'DESC';
    } else if (sort === 'earliest') {
      sortField = 'publication_date';
      order = 'ASC';
    }
    
    // Use document service to fetch actual documents with the new interface
        const result = await fetchDocumentsService({
      page,
      limit: size,
      category,
      search,
      keyword,
      agenda,
      topic,
      year,
      sort: sortField,
      order,
      docTypes: docTypes, // Pass doc_types parameter to service layer
      includeReview,
      publicOnly,
      reviewStatus: reviewStatus === "pending_review" || reviewStatus === "approved" || reviewStatus === "rejected" ? reviewStatus : "all",
    });
    
        
    // Debug log to check document types
    const compiledDocs = result.documents.filter(doc => doc.is_compiled === true);
    const singleDocs = result.documents.filter(doc => !doc.is_compiled);
        
    // Check if we received fewer documents than expected
    if (result.documents.length === 0 && result.totalCount > 0) {
    }
    
    // Add structured debug info to the response for troubleshooting
    const responseWithDebug = {
      ...result,
      _debug: {
        requestParams: {
          page, size, category, sort, keyword, docTypes
        },
        timestamp: new Date().toISOString(),
        source: "documentController.ts"
      }
    };
    
    // Create and return response
    return new Response(JSON.stringify(responseWithDebug), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    });
  } catch (error: unknown) {
    // Return error response
    return new Response(JSON.stringify({
      error: true,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    }), {
      status: 500,
      headers: {
        "Content-Type": "application/json",
      },
    });
  }
}

/**
 * Get a document by ID
 */
export async function getDocumentById(req: Request): Promise<Response> {
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
    
    // Check if this is a guest request
    const isGuestRequest = url.searchParams.get("guest") === "true";
    
        
    // Validate document ID is a number
    const docIdNum = parseInt(documentId);
    if (isNaN(docIdNum)) {
      return new Response(JSON.stringify({ error: "Invalid document ID. ID must be a valid integer." }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }
    
    // Get the document from the database
    const document = await DocumentModel.getById(docIdNum);
    
    if (!document) {
      return new Response(JSON.stringify({ error: "Document not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" }
      });
    }
    
    // If this is a guest request, check if the document is public
    if (isGuestRequest && !document.is_public) {
            return new Response(JSON.stringify({ error: "Document is not available for guest viewing" }), {
        status: 403,
        headers: { "Content-Type": "application/json" }
      });
    }
    
    // Fetch author information
    let authors: Array<any> = [];
    try {
      const authorsResult = await client.queryObject(
        `SELECT a.*
         FROM authors a
         JOIN document_authors da ON a.id = da.author_id
         WHERE da.document_id = $1
         ORDER BY da.author_order`,
        [docIdNum]
      );
      
      authors = authorsResult.rows.map((row: any) => ({
        id: row.id,
        full_name: row.full_name,
        affiliation: row.affiliation,
        department: row.department,
        email: row.email,
        orcid_id: row.orcid_id
      }));
      
          } catch (authorError) {
    }
    
    const classification = await getDocumentClassification(docIdNum, !isGuestRequest);
    
    // Extract publication year from publication_date if available
    let publicationYear = document.publication_year || "";
    if (document.publication_date && !publicationYear) {
      try {
        publicationYear = new Date(document.publication_date).getFullYear().toString();
      } catch (dateError) {
      }
    }
    
    // Prepare the response with enhanced data
    const enhancedDocument = {
      ...document,
      enhancedAuthors: authors.length > 0 ? authors : undefined,
      publication_year: publicationYear,
      classification,
      topics: classification.topics,
      keywords: classification.keywords.map((keyword) => keyword.name),
      research_agenda: classification.researchAgendas.map((agenda) => agenda.name).join(", ")
    };
    
    return new Response(JSON.stringify(enhancedDocument), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    return new Response(JSON.stringify({ 
      error: errorMessage
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}

/**
 * Create a new document
 */
export async function createDocument(req: Request): Promise<Response> {
  try {
    if (req.body) {
      const body = await req.json();
      
      // Validate required fields
      if (!body.title) {
        return new Response(JSON.stringify({ error: "Title is required" }), {
          status: 400,
          headers: { "Content-Type": "application/json" }
        });
      }

      if (body.classification === undefined) {
        return new Response(JSON.stringify({
          error: "classification is required for new document records",
          fields: { classification: "Provide topicIds and keywords" },
        }), {
          status: 422,
          headers: { "Content-Type": "application/json" },
        });
      }

      const publicationDateError = validateSinglePublicationDate(body.document_type, body.publication_date);
      if (publicationDateError) {
        return new Response(JSON.stringify({
          error: "A valid publication date is required for thesis and dissertation records.",
          fields: { publication_date: publicationDateError },
        }), {
          status: 422,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Validate document_type against known types
      const validDocumentTypes = ['THESIS', 'DISSERTATION', 'CONFLUENCE', 'SYNERGY', 'HELLO'];
      if (body.document_type && !validDocumentTypes.includes(body.document_type)) {
        return new Response(JSON.stringify({ 
          error: `Invalid document_type. Must be one of: ${validDocumentTypes.join(', ')}` 
        }), {
          status: 400,
          headers: { "Content-Type": "application/json" }
        });
      }
      
      // Set appropriate file paths based on document type if not already set
      if (!body.file_path && body.document_type) {
        switch (body.document_type) {
          case 'THESIS':
            body.file_path = 'storage/thesis/';
            break;
          case 'DISSERTATION':
            body.file_path = 'storage/dissertation/';
            break;
          case 'CONFLUENCE':
            body.file_path = 'storage/confluence/';
            break;
          case 'SYNERGY':
            body.file_path = 'storage/synergy/';
            break;
          case 'HELLO':
            body.file_path = 'storage/hello/';
            break;
          default:
            body.file_path = 'storage/hello/';
        }
      }
      
      // For single documents (THESIS or DISSERTATION), we don't include volume and issue
      if (body.document_type === 'THESIS' || body.document_type === 'DISSERTATION') {
        // Remove volume and issue if they exist
        delete body.volume;
        delete body.issue;
      }

      // For Synergy documents, ensure issue is null and department_id is used
      if (body.document_type === 'SYNERGY') {
        // Always set issue to null for Synergy documents
        body.issue = null;
        
        // Make sure department_id is present
        if (!body.department_id) {
        }
      }

      // For research studies in compiled documents, set appropriate category_id if not already set
      if (body.document_type === 'HELLO' && body.parent_document_id && !body.category_id) {
        body.category_id = 5; // Default research study category ID
      }

      const normalizedAbstract = normalizeManualAbstract(body.abstract);
      if (isAbstractTooLong(body.abstract)) {
        return new Response(JSON.stringify({ error: "Abstract must be 10,000 Unicode characters or fewer.", fields: { abstract: "Abstract must be 10,000 Unicode characters or fewer." } }), { status: 422, headers: { "Content-Type": "application/json" } });
      }
      body.abstract = normalizedAbstract;
      body.abstract_source = normalizedAbstract ? "manual" : "none";
      const hasStoredPdf = typeof body.file_path === "string"
        && body.file_path.trim().length > 0
        && !body.file_path.trim().endsWith("/");
      const needsAbstractExtraction = hasStoredPdf && !normalizedAbstract;
      if (needsAbstractExtraction) {
        body.review_status = "pending_review";
        body.is_public = false;
        body.reviewed_by = null;
        body.reviewed_at = null;
      }
      
      const newDocument = await DocumentModel.create(body);
      if (newDocument?.id && body.classification !== undefined) {
        try {
          await replaceDocumentClassification(
            Number(newDocument.id),
            body.classification,
            { id: String(body.uploaded_by || "system"), role: String(body.classificationActorRole || "admin") },
            {
              allowIncomplete: body.review_status === "pending_review",
            },
          );
          if (body.authors !== undefined) {
            if (!Array.isArray(body.authors)) {
              throw new ClassificationValidationError("authors must be an array", { authors: "Authors must be provided as an array" });
            }
            if (body.authors.length > 0) {
              await createDocumentAuthors(String(newDocument.id), body.authors);
            }
          }
        } catch (classificationError) {
          await client.queryArray("DELETE FROM documents WHERE id = $1", [newDocument.id]).catch(() => undefined);
          const status = classificationError instanceof ClassificationValidationError || (classificationError instanceof Error && classificationError.name === "DocumentAuthorValidationError") ? 422 : 500;
          return new Response(JSON.stringify({
            error: getErrorMessage(classificationError),
            fields: classificationError instanceof ClassificationValidationError ? classificationError.fieldErrors : undefined,
          }), {
            status,
            headers: { "Content-Type": "application/json" },
          });
        }
      }

      if (newDocument?.id && needsAbstractExtraction) {
        await queueDocumentAbstract(Number(newDocument.id));
      }
      
      return new Response(JSON.stringify(newDocument), {
        status: 201,
        headers: { "Content-Type": "application/json" }
      });
    } else {
      return new Response(JSON.stringify({ error: "Invalid request body" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }
  } catch (error) {
    return new Response(JSON.stringify({ error: getErrorMessage(error) }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}

/**
 * Update an existing document
 */
export async function updateDocument(req: Request): Promise<Response> {
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
    
    if (req.body) {
      const body = await req.json();
      
      // Check if document exists
      const existingDocument = await DocumentModel.getById(parseInt(documentId));
      
      if (!existingDocument) {
        return new Response(JSON.stringify({ error: "Document not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" }
        });
      }
      
      const updatedDocument = await DocumentModel.update(parseInt(documentId), body);
      
      return new Response(JSON.stringify(updatedDocument), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    } else {
      return new Response(JSON.stringify({ error: "Invalid request body" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }
  } catch (error) {
    return new Response(JSON.stringify({ error: getErrorMessage(error) }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}

/**
 * Delete a document (soft delete)
 */
export async function deleteDocument(req: Request): Promise<Response> {
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
    
    // Check if document exists
    const existingDocument = await DocumentModel.getById(parseInt(documentId));
    
    if (!existingDocument) {
      return new Response(JSON.stringify({ error: "Document not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" }
      });
    }
    
    await DocumentModel.delete(parseInt(documentId));
    
    return new Response(JSON.stringify({ message: "Document deleted successfully" }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: getErrorMessage(error) }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}

/**
 * Get child documents for a compiled document
 * @param req - The request object
 * @returns Response with child documents
 */
export async function getChildDocuments(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url);
    const path = url.pathname;
    const matches = path.match(/\/api\/documents\/(\d+)\/children/);
    
    if (!matches || !matches[1]) {
      return new Response(JSON.stringify({ error: "Invalid document ID" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }
    
    const documentIdStr = matches[1];
    
    // Validate documentId is a valid number
    if (isNaN(Number(documentIdStr)) || !Number.isInteger(Number(documentIdStr))) {
      return new Response(JSON.stringify({ error: "Invalid document ID. ID must be a valid integer." }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }
    
    const documentId = parseInt(documentIdStr);
        
    const result = await fetchChildDocumentsService(documentId);
    
    // Create a safe version of the documents to avoid serialization issues
    const safeDocuments = [];
    
    for (const doc of result.documents) {
      // Create a basic safe document object
      const safeDoc: Record<string, any> = {
        id: doc.id,
        title: typeof doc.title === 'string' ? doc.title : '',
        description: typeof doc.description === 'string' ? doc.description : '',
        document_type: typeof doc.document_type === 'string' ? doc.document_type : '',
        volume: typeof doc.volume === 'string' ? doc.volume : '',
        issue: typeof doc.issue === 'string' ? doc.issue : '',
        is_compiled: Boolean(doc.is_compiled),
        parent_compiled_id: doc.parent_compiled_id
      };
      
      // Handle date carefully
      if (doc.publication_date instanceof Date) {
        safeDoc.publication_date = doc.publication_date.toISOString();
      } else {
        safeDoc.publication_date = null;
      }
      
      // Handle authors array
      safeDoc.authors = [];
      if (Array.isArray(doc.authors)) {
        for (const author of doc.authors) {
          if (author && typeof author === 'object') {
            safeDoc.authors.push({
              id: author.id,
              full_name: typeof author.full_name === 'string' ? author.full_name : ''
            });
          }
        }
      }
      
      // Handle topics array
      safeDoc.topics = [];
      if (Array.isArray(doc.topics)) {
        for (const topic of doc.topics) {
          if (topic && typeof topic === 'object') {
            safeDoc.topics.push({
              id: topic.id,
              name: typeof topic.name === 'string' ? topic.name : ''
            });
          }
        }
      }

      safeDoc.classification = doc.classification ?? {
        researchAgendas: [],
        topics: safeDoc.topics,
        keywords: [],
        complete: false,
        source: doc.is_compiled ? "aggregated_children" : "document",
      };
      
      safeDocuments.push(safeDoc);
    }
    
    // Create the final response object
    const responseObject = {
      documents: safeDocuments
    };
    
    return new Response(JSON.stringify(responseObject), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({ 
      error: "Error fetching child documents",
      message: errorMessage
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}

/**
 * Get authors for a document
 */
export async function getDocumentAuthors(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url);
    const path = url.pathname;
    const parts = path.split('/');
    const documentId = parts[parts.length - 2]; // Get the ID from the URL path
    
    if (!documentId) {
      return new Response(JSON.stringify({ error: "Document ID is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }
    
        
    // Validate document ID is a number
    const docIdNum = parseInt(documentId);
    if (isNaN(docIdNum)) {
      return new Response(JSON.stringify({ error: "Invalid document ID" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }
    
    // Query to fetch authors for this document
    const authorsResult = await client.queryObject(
      `SELECT a.*
       FROM authors a
       JOIN document_authors da ON a.id = da.author_id
       WHERE da.document_id = $1
       ORDER BY da.author_order`,
      [docIdNum]
    );
    
    const authors = authorsResult.rows.map((row: any) => ({
      id: row.id,
      full_name: row.full_name,
      affiliation: row.affiliation,
      department: row.department,
      email: row.email,
      orcid_id: row.orcid_id
    }));
    
    return new Response(JSON.stringify({ 
      success: true,
      authors: authors
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    return new Response(JSON.stringify({ 
      success: false,
      error: errorMessage
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}
