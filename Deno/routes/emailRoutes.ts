import { Route } from "./index.ts";
import { RouterContext } from "../deps.ts";
import { sendApprovedRequestEmail, sendRejectedRequestEmail } from "../services/emailService.ts";
import { isAuthenticated, isAdmin } from "../middleware/authMiddleware.ts";
import { DocumentModel } from "../models/documentModel.ts";
import { FileCheckService } from "../services/fileCheckService.ts";

/**
 * Send approval email with document attachment
 */
const sendApprovalEmail = async (ctx: RouterContext<any, any, any>) => {
  try {
    const bodyParser = await ctx.request.body({ type: "json" });
    const { 
      email, 
      fullName, 
      documentTitle, 
      documentId, 
      requestId, 
      childDocumentIds,
      isEntireCollection: requestedEntireCollection 
    } = await bodyParser.value;
    
    // Make this mutable
    let isEntireCollection = requestedEntireCollection === true;
    
            
    // Validate required fields
    if (!email || !documentId) {
      ctx.response.status = 400;
      ctx.response.body = { 
        success: false, 
        message: "Email and documentId are required" 
      };
      return;
    }
    
    // First, determine if this is a compiled document by checking the document type
    let isCompiledDocument = false;
    try {
            const client = (await import("../db/denopost_conn.ts")).client;
      // Check compiled_documents table directly
      const compiledDocCheck = await client.queryObject(
        "SELECT id FROM compiled_documents WHERE id = $1",
        [parseInt(documentId)]
      );
      
      if (compiledDocCheck.rows.length > 0) {
        isCompiledDocument = true;
                
        // If isEntireCollection wasn't explicitly set but this is a compiled document, 
        // we should treat it as an entire collection request
        if (isEntireCollection !== true) {
                    isEntireCollection = true;
        }
      } else {
                
        // As a fallback, check if document has document_type = 'COMPILED' or is_compiled flag
        const docTypeCheck = await client.queryObject(
          "SELECT id, document_type, is_compiled FROM documents WHERE id = $1",
          [parseInt(documentId)]
        );
        
        if (docTypeCheck.rows.length > 0) {
          const doc = docTypeCheck.rows[0] as {
            id: number;
            document_type?: string;
            is_compiled?: boolean;
          };
          if (doc.document_type === 'COMPILED' || doc.is_compiled === true) {
            isCompiledDocument = true;
            isEntireCollection = true;
                      }
        }
      }
    } catch (error) {
      // Continue with the process, assuming it's not a compiled document
    }
    
    // Get the file path from document ID
        const documentPath = await DocumentModel.getDocumentPath(documentId);
    
    // Fetch additional document metadata
    let documentAuthor = null;
    let documentCategory = null;
    let documentKeywords = null;
    try {
      const documentDetails = await DocumentModel.getDocumentById(documentId);
      if (documentDetails) {
        documentAuthor = documentDetails.author || null;
        documentCategory = documentDetails.category || null;
        documentKeywords = documentDetails.keywords || null;
      }
    } catch (metadataError) {
    }
    
    // Check for child documents in entire collection requests
    let childDocuments = [];
    let childDocumentPaths: string[] = [];
    
    if (isEntireCollection) {
            
      // Use provided child document IDs if available
      if (childDocumentIds && Array.isArray(childDocumentIds) && childDocumentIds.length > 0) {
                
        // Get file paths for all child documents
        for (const childId of childDocumentIds) {
          try {
            const childPath = await DocumentModel.getDocumentPath(childId);
            if (childPath) {
              childDocumentPaths.push(childPath);
                          }
          } catch (childError) {
          }
        }
      } else {
        // If no child IDs provided, try to fetch them from the database
                try {
          // Use the specialized method that directly fetches all child document paths
          childDocumentPaths = await DocumentModel.getCompiledDocumentChildPaths(documentId);
                    
          // If that didn't work, fall back to the old method
          if (childDocumentPaths.length === 0 && isCompiledDocument) {
                        
            // Try to get the contained documents first
            const containedDocs = await DocumentModel.getContainedDocuments(parseInt(documentId));
                        
            if (containedDocs.length > 0) {
              // Extract document IDs and get paths
              for (const doc of containedDocs) {
                try {
                  if (doc.id) {
                    const childPath = await DocumentModel.getDocumentPath(doc.id);
                    if (childPath) {
                      childDocumentPaths.push(childPath);
                                          }
                  }
                } catch (childError) {
                }
              }
            } else {
              // Last resort: direct query to compiled_document_items
              const client = (await import("../db/denopost_conn.ts")).client;
              const result = await client.queryObject(`
                SELECT d.id
                FROM documents d
                JOIN compiled_document_items cdi ON d.id = cdi.document_id
                WHERE cdi.compiled_document_id = $1
                AND d.deleted_at IS NULL
              `, [parseInt(documentId)]);
              
              // Get file paths for all child documents
              const fetchedChildIds = result.rows.map((row: any) => row.id);
                            
              for (const childId of fetchedChildIds) {
                try {
                  const childPath = await DocumentModel.getDocumentPath(childId);
                  if (childPath) {
                    childDocumentPaths.push(childPath);
                                      }
                } catch (childError) {
                }
              }
            }
          }
        } catch (error) {
        }
      }
    }
    
    if (!documentPath && childDocumentPaths.length === 0) {
      ctx.response.status = 404;
      ctx.response.body = { 
        success: false, 
        message: "No documents found to attach" 
      };
      return;
    }
    
            
    // Verify at least one file exists
    let fileExists = false;
    let fileSize = 0;
    let verificationError = null;
    
    try {
      // First check if main document exists
      if (documentPath) {
    try {
      const fileInfo = await Deno.stat(documentPath);
      fileExists = true;
      fileSize = fileInfo.size;
                  } catch (mainDocError) {
                  }
      }
      
      // If main document doesn't exist but we have child documents, check them
      if (!fileExists && childDocumentPaths.length > 0) {
        // Check if at least one child document exists
        for (const childPath of childDocumentPaths) {
          try {
            const childFileInfo = await Deno.stat(childPath);
            fileExists = true;
            fileSize += childFileInfo.size;
                        // No need to break; let's check all files and sum up the size
          } catch (childError) {
          }
        }
      }
      
      // If no files were found, try FileCheckService as a last resort
      if (!fileExists) {
                
        // Try to find the file using FileCheckService
        try {
          const fileName = documentPath?.split('/').pop() || documentPath?.split('\\').pop() || '';
                    
          const results = await FileCheckService.findInStorage(fileName);
          const found = results.filter(r => r.exists);
          
          if (found.length > 0) {
                        fileExists = true;
          } else {
                        
            // As a last resort, check each child document with FileCheckService
            if (childDocumentPaths.length > 0) {
              for (const childPath of childDocumentPaths) {
                const childFileName = childPath.split('/').pop() || childPath.split('\\').pop() || '';
                                
                const childResults = await FileCheckService.findInStorage(childFileName);
                const childFound = childResults.filter(r => r.exists);
                
                if (childFound.length > 0) {
                                    fileExists = true;
                  break; // At least one file found
                }
              }
            }
          }
        } catch (searchError) {
        }
      }
    } catch (error) {
      verificationError = error instanceof Error ? error.message : String(error);
      // Try to find the file using FileCheckService
      try {
        const fileName = documentPath?.split('/').pop() || documentPath?.split('\\').pop() || '';
                
        const results = await FileCheckService.findInStorage(fileName);
        const found = results.filter(r => r.exists);
        
        if (found.length > 0) {
                    fileExists = true;
        } else {
                  }
      } catch (searchError) {
      }
    }
    
    // Send the email with attachments and metadata
        
    try {
      // Import the background job service
      const { createEmailJob } = await import("../services/backgroundJobService.ts");
      
      // Create a job for sending the approval email
      const job = createEmailJob(
        email,
        `Your request for "${documentTitle || "Requested Document"}" has been approved`,
        `Your request has been approved and the document is attached.`, // Plain text version
        undefined, // HTML content will be generated by email service
        documentPath || '', // Main attachment path
        'approval', // Job type
        {
          fullName: fullName || "User",
          documentTitle: documentTitle || "Requested Document",
          requestId: requestId || `REQ-${Date.now()}`,
          documentId: documentId,
          documentAuthor,
          documentCategory,
          documentKeywords,
          childDocumentPaths,
          isEntireCollection
        }
      );
      
      // Respond immediately with background job info
      ctx.response.body = { 
        success: true, 
        message: "Approval email scheduled for background processing",
        jobId: job.id,
        documentPath: documentPath,
        childDocumentCount: childDocumentPaths.length,
        fileExists: fileExists,
        fileSize: fileSize,
        verificationError: verificationError,
        backgroundProcessing: true
      };
          } catch (error) {
      // Fallback to synchronous processing if background job fails
          const success = await sendApprovedRequestEmail(
      email,
      fullName || "User",
      documentTitle || "Requested Document",
        documentPath || '',
        requestId || `REQ-${Date.now()}`,
        documentAuthor,
        documentCategory,
        documentKeywords,
        childDocumentPaths
    );
    
    if (success) {
            ctx.response.body = { 
        success: true, 
        message: "Approval email sent successfully",
        documentPath: documentPath,
          childDocumentCount: childDocumentPaths.length,
        fileExists: fileExists,
        fileSize: fileSize,
        verificationError: verificationError,
          backgroundProcessing: false
      };
    } else {
      ctx.response.status = 500;
      ctx.response.body = { 
        success: false, 
        message: "Failed to send approval email",
        documentPath: documentPath,
          childDocumentCount: childDocumentPaths.length,
        fileExists: fileExists,
          verificationError: verificationError,
          backgroundProcessing: false
      };
      }
    }
  } catch (error: unknown) {
    ctx.response.status = 500;
    ctx.response.body = { 
      success: false, 
      message: "Server error while sending email", 
      error: error instanceof Error ? error.message : String(error)
    };
  }
};

/**
 * Send rejection email
 */
const sendRejectionEmail = async (ctx: RouterContext<any, any, any>) => {
  try {
    const bodyParser = await ctx.request.body({ type: "json" });
    const { email, fullName, documentTitle, reason, debug } = await bodyParser.value;
    
        
    // Validate required fields
    if (!email || !reason) {
      ctx.response.status = 400;
      ctx.response.body = { 
        success: false, 
        message: "Email and reason are required" 
      };
      return;
    }
    
    // Log the email details for debugging
    console.log(`[EMAIL API] Sending rejection email: 
      To: ${email}
      Recipient: ${fullName || "User"} 
      Document: ${documentTitle || "Requested Document"}
      Reason: ${reason.length > 100 ? reason.substring(0, 100) + '...' : reason}
    `);
    
    // Send the rejection email
    const result = await sendRejectedRequestEmail(
      email,
      fullName || "User",
      documentTitle || "Requested Document",
      reason
    );
    
    // Check if result is boolean or object and respond accordingly
    if (typeof result === 'boolean') {
      if (result) {
              ctx.response.body = { 
        success: true, 
        message: "Rejection email sent successfully" 
      };
    } else {
      ctx.response.status = 500;
      ctx.response.body = { 
        success: false, 
        message: "Failed to send rejection email" 
      };
      }
    } else {
      // Result is an object with detailed information
            
      // For TypeScript, safely check the object properties
      const resultObj = result as Record<string, unknown>;
      if (resultObj && resultObj.success === true) {
        ctx.response.body = resultObj;
      } else {
        ctx.response.status = 500;
        ctx.response.body = resultObj;
      }
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    ctx.response.status = 500;
    ctx.response.body = { 
      success: false, 
      message: "Server error while sending email", 
      error: errorMessage,
      stack: error instanceof Error ? error.stack : undefined
    };
  }
};

/**
 * Check if document files exist and can be sent
 */
const checkDocumentFiles = async (ctx: RouterContext<any, any, any>) => {
  try {
    const bodyParser = await ctx.request.body({ type: "json" });
    const { documentId } = await bodyParser.value;
    
    if (!documentId) {
      ctx.response.status = 400;
      ctx.response.body = { 
        success: false, 
        message: "Document ID is required" 
      };
      return;
    }
    
        
    // Get the document path from the database
    const dbPath = await DocumentModel.getDocumentPath(documentId);
    
    if (!dbPath) {
      ctx.response.status = 404;
      ctx.response.body = { 
        success: false, 
        message: "No file path found in database for this document"
      };
      return;
    }
    
    // Extract the filename from the path
    const fileName = dbPath.split('/').pop() || dbPath.split('\\').pop() || '';
    
    // Check all possible storage locations
    const results = await FileCheckService.findInStorage(fileName);
    
    // Find any existing files
    const foundFiles = results.filter(r => r.exists);
    
    ctx.response.body = {
      success: true,
      documentId,
      databasePath: dbPath,
      fileName,
      results,
      foundCount: foundFiles.length,
      foundFiles: foundFiles
    };
  } catch (error: unknown) {
    ctx.response.status = 500;
    ctx.response.body = { 
      success: false, 
      message: "Server error while checking files", 
      error: error instanceof Error ? error.message : String(error)
    };
  }
};

// Export email routes — triggered from the admin request-review flow
export const emailRoutes: Route[] = [
  { method: "POST", path: "/api/email/send-approval", handler: sendApprovalEmail, middleware: [isAuthenticated, isAdmin] },
  { method: "POST", path: "/api/email/send-rejection", handler: sendRejectionEmail, middleware: [isAuthenticated, isAdmin] },
  { method: "POST", path: "/api/email/check-document-files", handler: checkDocumentFiles, middleware: [isAuthenticated, isAdmin] }
]; 