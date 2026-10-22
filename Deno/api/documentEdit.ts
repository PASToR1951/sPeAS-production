import { client } from "../db/denopost_conn.ts";
import { getDocumentAuthors } from "../controllers/documentAuthorController.ts";
import { getDocumentClassification, replaceDocumentClassification } from "../services/documentClassificationService.ts";

/**
 * Get a document for editing with all related data
 */
export async function getDocumentForEdit(documentId: string): Promise<any> {
  try {
    // Validate documentId
    if (!documentId || isNaN(Number(documentId))) {
      throw new Error("Valid document ID is required");
    }
    
    // Get document data
    const documentQuery = `
      SELECT * FROM documents
      WHERE id = $1 AND deleted_at IS NULL
    `;
    
    const documentResult = await client.queryObject(documentQuery, [documentId]);
    
    if (documentResult.rows.length === 0) {
      throw new Error("Document not found");
    }
    
    const document = documentResult.rows[0];
    
    // Get document authors
    const authors = await getDocumentAuthors(documentId);
    
    const classification = await getDocumentClassification(Number(documentId), true);
    
    // Return complete document data for editing
    return {
      document,
      authors,
      classification,
      topics: classification.topics
    };
  } catch (error: unknown) {
    throw error;
  }
}

/**
 * Save a document with all related data (authors, topics)
 */
export async function saveDocument(documentData: any): Promise<any> {
  try {
    const { document, authorIds, classification, topicIds } = documentData;
    
    if (!document || !document.id) {
      throw new Error("Document with ID is required");
    }
    
    // Begin transaction
    await client.queryObject("BEGIN");
    
    try {
      // Update document
      const updateQuery = `
        UPDATE documents
        SET 
          title = $1,
          abstract = $2,
          publication_date = $3,
          category_id = $4,
          document_type = $5,
          file_path = COALESCE($6, file_path),
          updated_at = NOW()
        WHERE id = $7
        RETURNING *
      `;
      
      const updateResult = await client.queryObject(updateQuery, [
        document.title,
        document.abstract,
        document.publication_date,
        document.category_id,
        document.document_type,
        document.file_path,
        document.id
      ]);
      
      if (updateResult.rows.length === 0) {
        throw new Error(`Document with ID ${document.id} not found`);
      }
      
      // Update authors - first remove existing relationships
      await client.queryObject(
        "DELETE FROM document_authors WHERE document_id = $1", 
        [document.id]
      );
      
      // Insert new author relationships if provided
      if (authorIds && Array.isArray(authorIds) && authorIds.length > 0) {
        for (let i = 0; i < authorIds.length; i++) {
          await client.queryObject(
            "INSERT INTO document_authors (document_id, author_id, author_order) VALUES ($1, $2, $3)",
            [document.id, authorIds[i], i + 1]
          );
        }
      }
      
      if (classification) {
        await replaceDocumentClassification(document.id, classification, { id: "legacy-document-edit", role: "admin" }, { allowIncomplete: true });
      } else if (topicIds !== undefined) {
        throw new Error("The legacy topicIds field is retired; provide an explicit classification object");
      }
      
      // Commit transaction
      await client.queryObject("COMMIT");
      
      // Get and return updated document with authors and topics
      return await getDocumentForEdit(document.id.toString());
    } catch (error) {
      // Rollback transaction on error
      await client.queryObject("ROLLBACK");
      throw error;
    }
  } catch (error: unknown) {
    throw error;
  }
}
