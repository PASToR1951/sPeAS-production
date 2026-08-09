import { client } from "../db/denopost_conn.ts";
import { join } from "https://deno.land/std@0.190.0/path/mod.ts";

/**
 * Document types as defined in the database enum
 */
export enum DocumentType {
  THESIS = 'THESIS',
  DISSERTATION = 'DISSERTATION',
  CONFLUENCE = 'CONFLUENCE',
  SYNERGY = 'SYNERGY'
}

/**
 * Document interface representing the document data from the database
 */
export interface Document {
  id: number;
  title: string;
  description?: string;
  abstract?: string;
  abstract_source?: 'none' | 'manual' | 'pdf_text' | 'ocr' | 'legacy';
  abstract_reviewed_by?: string;
  abstract_reviewed_at?: Date;
  publication_date?: Date;
  start_year?: number;
  end_year?: number;
  category_id?: number;
  department_id?: number;
  file_path: string;
  /** Server-derived SHA-256 of the current PDF bytes, when calculated. */
  content_sha256?: string;
  pages?: number;
  volume?: string;
  issue?: string;
  is_public: boolean;
  full_access_requestable?: boolean;
  access_embargo_until?: Date | string | null;
  document_type: DocumentType;
  created_at?: Date;
  updated_at?: Date;
  deleted_at?: Date;
  compiled_document_id?: number; // Reference to compiled_documents table (legacy field)
  compiled_parent_id?: number; // Direct reference to compiled_documents table
  uploaded_by?: string;
  review_status?: 'pending_review' | 'approved' | 'rejected';
  reviewed_by?: string;
  reviewed_at?: Date;
  // Additional fields for guest document API
  author?: string;
  publication_year?: string;
  keywords?: string[];
  category?: string;
  research_agenda?: string;
  editor?: any;
  is_compiled?: boolean;
}

/**
 * File interface representing file data from the database
 */
export interface DocumentFile {
  id: number;
  file_name: string;
  file_path: string;
  file_size?: number;
  file_type?: string;
  document_id: number;
  created_at?: Date;
  updated_at?: Date;
}

export class DocumentModel {
  /**
   * Get all documents (optionally only public ones)
   * @param publicOnly Whether to only fetch public documents
   * @returns Array of documents
   */
  static async getAll(publicOnly = false): Promise<Document[]> {
    try {
      let query = "SELECT * FROM documents WHERE deleted_at IS NULL";
      
      if (publicOnly) {
        query += " AND is_public = true";
      }
      
      query += " ORDER BY created_at DESC";
      
      const result = await client.queryObject<Document>(query);
      return result.rows;
    } catch (error) {
      return [];
    }
  }

  /**
   * Get a document by its ID
   * @param id Document ID
   * @returns Document object or null if not found
   */
  static async getById(id: number): Promise<Document | null> {
    try {
      const result = await client.queryObject<Document>(
        "SELECT * FROM documents WHERE id = $1 AND deleted_at IS NULL",
        [id]
      );
      
      return result.rows[0] || null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Get a document with its author information
   * @param id Document ID
   * @returns Document with authors or null if not found
   */
  static async getWithAuthors(id: number): Promise<any | null> {
    try {
      // First get the document
      const document = await this.getById(id);
      
      if (!document) {
        return null;
      }
      
      // Then get its authors
      const authorsResult = await client.queryObject(
        `SELECT a.* 
         FROM authors a
         JOIN document_authors da ON a.id = da.author_id
         WHERE da.document_id = $1
         ORDER BY da.author_order`,
        [id]
      );
      
      return {
        ...document,
        authors: authorsResult.rows
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Search for documents by title, abstract, or description
   * @param searchTerm Search term
   * @param publicOnly Whether to only search public documents
   * @returns Array of matching documents
   */
  static async search(searchTerm: string, publicOnly = false): Promise<Document[]> {
    try {
      let query = `
        SELECT * FROM documents 
        WHERE deleted_at IS NULL 
        AND (
          title ILIKE $1 
          OR description ILIKE $1 
          OR abstract ILIKE $1
        )
      `;
      
      if (publicOnly) {
        query += " AND is_public = true";
      }
      
      query += " ORDER BY created_at DESC";
      
      const result = await client.queryObject<Document>(
        query,
        [`%${searchTerm}%`]
      );
      
      return result.rows;
    } catch (error) {
      return [];
    }
  }

  /**
   * Get all documents that are part of a compiled document
   * @param compiledDocId ID of the compiled document
   * @returns Array of contained documents
   */
  static async getContainedDocuments(compiledDocId: number): Promise<Document[]> {
    try {
      // This query assumes there's a compiled_document_items table or similar relationship
      // Modify according to your actual database schema
      const result = await client.queryObject<Document>(
        `SELECT d.* FROM documents d
         WHERE d.compiled_parent_id = $1
         AND d.deleted_at IS NULL
         ORDER BY d.id ASC`,
        [compiledDocId]
      );
      
      // If no results from parent_id relation, try another approach
      if (result.rows.length === 0) {
        // Try alternative relationship table if it exists in your schema
        const altResult = await client.queryObject<Document>(
          `SELECT d.* FROM documents d
           JOIN compiled_document_items cdi ON d.id = cdi.document_id
           WHERE cdi.compiled_document_id = $1
           AND d.deleted_at IS NULL
           ORDER BY cdi.order_position ASC`,
          [compiledDocId]
        );
        
        if (altResult.rows.length > 0) {
          return altResult.rows;
        }
      }
      
      return result.rows;
    } catch (error) {
      return [];
    }
  }

  /**
   * Create a new document
   * @param document Document data
   * @returns Created document or null if creation failed
   */
  static async create(document: Omit<Document, 'id' | 'created_at' | 'updated_at' | 'deleted_at'>): Promise<Document | null> {
    try {
      const result = await client.queryObject<Document>(
        `INSERT INTO documents (
          title, description, abstract, publication_date, 
          start_year, end_year, category_id, department_id,
          file_path, pages, volume, issue, is_public, document_type,
          compiled_parent_id, uploaded_by, review_status, reviewed_by, reviewed_at,
          abstract_source, abstract_reviewed_by, abstract_reviewed_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
          $16, $17, $18, $19, $20, $21, $22
        ) RETURNING *`,
        [
          document.title,
          document.description || null,
          document.abstract || null,
          document.publication_date || null,
          document.start_year || null,
          document.end_year || null,
          document.category_id || null,
          document.department_id || null,
          document.file_path,
          document.pages || null,
          document.volume || null,
          document.issue || null,
          document.is_public || false,
          document.document_type,
          document.compiled_parent_id || null,
          document.uploaded_by || null,
          document.review_status || "approved",
          document.reviewed_by || null,
          document.reviewed_at || null,
          document.abstract_source || (document.abstract ? 'legacy' : 'none'),
          document.abstract_reviewed_by || null,
          document.abstract_reviewed_at || null,
        ]
      );
      
      return result.rows[0] || null;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Update a document by ID
   * @param id Document ID
   * @param updates Fields to update
   * @returns Updated document or null if update failed
   */
  static async update(id: number, updates: Partial<Document>): Promise<Document | null> {
    try {
      // Build update query dynamically based on what fields are provided
      const updateFields: string[] = [];
      const queryParams: any[] = [];
      let paramIndex = 1;
      
      // Map of fields to their parameter indices
      const fields: Record<string, any> = {
        title: updates.title,
        description: updates.description,
        abstract: updates.abstract,
        abstract_source: updates.abstract_source,
        abstract_reviewed_by: updates.abstract_reviewed_by,
        abstract_reviewed_at: updates.abstract_reviewed_at,
        publication_date: updates.publication_date,
        start_year: updates.start_year,
        end_year: updates.end_year,
        category_id: updates.category_id,
        department_id: updates.department_id,
        file_path: updates.file_path,
        pages: updates.pages,
        volume: updates.volume,
        issue: updates.issue,
        is_public: updates.is_public,
        document_type: updates.document_type,
        compiled_parent_id: updates.compiled_parent_id
      };
      
      // Add fields that are not undefined to the query
      for (const [field, value] of Object.entries(fields)) {
        if (value !== undefined) {
          updateFields.push(`${field} = $${paramIndex}`);
          queryParams.push(value);
          paramIndex++;
        }
      }
      
      // Always add updated_at timestamp
      updateFields.push(`updated_at = NOW()`);
      
      // If no fields to update, return the current document
      if (updateFields.length === 0) {
        return this.getById(id);
      }
      
      // Add document ID as the last parameter
      queryParams.push(id);
      
      const result = await client.queryObject<Document>(
        `UPDATE documents 
         SET ${updateFields.join(', ')} 
         WHERE id = $${paramIndex} AND deleted_at IS NULL
         RETURNING *`,
        queryParams
      );
      
      return result.rows.length > 0 ? result.rows[0] : null;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Soft delete a document by setting its deleted_at timestamp
   * @param id Document ID
   * @returns True if successful, false otherwise
   */
  static async softDelete(id: number): Promise<boolean> {
    try {
      const result = await client.queryArray(
        "UPDATE documents SET deleted_at = CURRENT_TIMESTAMP WHERE id = $1 AND deleted_at IS NULL",
        [id]
      );
      
      return (result.rowCount ?? 0) > 0;
    } catch (error) {
      return false;
    }
  }

  /**
   * Hard delete a document (for use by admin or for permanent deletion)
   * @param id Document ID
   * @returns True if successful, false otherwise
   */
  static async delete(id: number): Promise<boolean> {
    try {
      // First soft delete for safety
      await this.softDelete(id);
      
      // Then actually delete the document
      const result = await client.queryObject(
        "DELETE FROM documents WHERE id = $1",
        [id]
      );
      
      return (result.rowCount ?? 0) > 0;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get filtered documents based on multiple criteria
   * @param options Filter options
   * @returns Array of filtered documents
   */
  static async getFiltered(options: {
    categoryId?: number;
    authorId?: number;
    searchTerm?: string;
    publicOnly?: boolean;
    page?: number;
    limit?: number;
  }): Promise<Document[]> {
    try {
      const {
        categoryId,
        authorId,
        searchTerm,
        publicOnly = false,
        page = 1,
        limit = 20
      } = options;
      
      const offset = (page - 1) * limit;
      const params: any[] = [];
      let paramIndex = 1;
      
      let query = "SELECT DISTINCT d.* FROM documents d ";
      
      // Join with document_authors if we need to filter by author
      if (authorId) {
        query += "JOIN document_authors da ON d.id = da.document_id ";
      }
      
      query += "WHERE d.deleted_at IS NULL ";
      
      // Apply filters
      if (categoryId) {
        query += `AND d.category_id = $${paramIndex} `;
        params.push(categoryId);
        paramIndex++;
      }
      
      if (authorId) {
        query += `AND da.author_id = $${paramIndex} `;
        params.push(authorId);
        paramIndex++;
      }
      
      if (searchTerm) {
        query += `AND (
          d.title ILIKE $${paramIndex} 
          OR d.description ILIKE $${paramIndex} 
          OR d.abstract ILIKE $${paramIndex}
        ) `;
        params.push(`%${searchTerm}%`);
        paramIndex++;
      }
      
      if (publicOnly) {
        query += "AND d.is_public = true ";
      }
      
      // Add ordering
      query += "ORDER BY d.created_at DESC ";
      
      // Add pagination
      query += `LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
      params.push(limit, offset);
      
      const result = await client.queryObject<Document>(query, params);
      return result.rows;
    } catch (error) {
      return [];
    }
  }

  /**
   * Add an author to a document
   * @param documentId Document ID
   * @param authorId Author ID
   * @param authorOrder Order of the author in the document
   * @returns True if successful, false otherwise
   */
  static async addAuthor(documentId: number, authorId: string, authorOrder: number): Promise<boolean> {
    try {
      await client.queryArray(
        "INSERT INTO document_authors (document_id, author_id, author_order) VALUES ($1, $2, $3)",
        [documentId, authorId, authorOrder]
      );
      
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get all files associated with a document
   * @param documentId Document ID
   * @returns Array of file objects
   */
  static async getFiles(documentId: number): Promise<DocumentFile[]> {
    try {
      const result = await client.queryObject<DocumentFile>(
        "SELECT * FROM files WHERE document_id = $1 ORDER BY id",
        [documentId]
      );
      
      return result.rows;
    } catch (error) {
      return [];
    }
  }

  /**
   * Add a file to a document
   * @param file File data
   * @returns Created file object or null if creation failed
   */
  static async addFile(file: Omit<DocumentFile, 'id' | 'created_at' | 'updated_at'>): Promise<DocumentFile | null> {
    try {
      const result = await client.queryObject<DocumentFile>(
        `INSERT INTO files (file_name, file_path, file_size, file_type, document_id)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [
          file.file_name,
          file.file_path,
          file.file_size || null,
          file.file_type || null,
          file.document_id
        ]
      );
      
      return result.rows[0] || null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Get the file path for a document by its ID
   * @param id Document ID
   * @returns Path to the document file or null if not found
   */
  static async getDocumentPath(id: number | string): Promise<string | null> {
    try {
      // Convert string ID to number if needed
      const documentId = typeof id === 'string' ? parseInt(id, 10) : id;
      
      // Check if ID is valid
      if (isNaN(documentId)) {
        return null;
      }
      
            
      const result = await client.queryObject<{ file_path: string }>(
        "SELECT file_path FROM documents WHERE id = $1 AND deleted_at IS NULL",
        [documentId]
      );
      
      if (result.rows.length === 0) {
        return null;
      }
      
      let filePath = result.rows[0].file_path;
            
      if (!filePath) {
        return null;
      }
      
      // IMPROVED PATH RESOLUTION: First check if the path is already absolute and exists
      if (filePath.match(/^[A-Z]:\//i)) {
                try {
          const fileInfo = await Deno.stat(filePath);
                    return filePath;
        } catch (err) {
          // Continue with other path resolution methods
        }
      }
      
      // Get the workspace root directory (parent of Deno directory)
      const workspaceRoot = Deno.cwd().replace(/[\\/]Deno$/, '');
      
      // Try multiple path resolutions in order of likelihood:
      const pathsToTry = [
        // 1. If path starts with /storage, remove leading slash and join with workspace root
        filePath.startsWith('/storage/') ? join(workspaceRoot, filePath.substring(1)) : null,
        
        // 2. If path is just a filename, try in storage/thesis directory
        !filePath.includes('/') && !filePath.includes('\\') ? 
          join(workspaceRoot, 'storage', 'thesis', filePath) : null,
          
        // 3. Try direct path in thesis directory if it contains a filename but no full path
        filePath.includes('/') || filePath.includes('\\') ? 
          join(workspaceRoot, 'storage', 'thesis', filePath.split(/[/\\]/).pop() || '') : null,
          
        // 4. Try storage directory with filename
        join(workspaceRoot, 'storage', filePath),
        
        // 5. Try with .file extension in thesis (many files use this extension)
        join(workspaceRoot, 'storage', 'thesis', `${filePath.split(/[/\\]/).pop() || ''}.file`),
        
        // 6. Use path as is
        filePath
      ];
      
      // Filter out null entries
      const validPaths = pathsToTry.filter(p => p !== null) as string[];
      
            validPaths.forEach((path, i) => {
              });
      
      // Try each path until one exists
      for (const path of validPaths) {
        try {
          const fileInfo = await Deno.stat(path);
                    return path;
        } catch (err) {
                  }
      }
      
      // ENHANCED: Search in category subfolders (recursive search)
      // Look in common storage directories and their subdirectories
      const rootStorageDirs = [
        'storage/thesis',
        'storage/dissertation',
        'storage/confluence',
        'storage/synergy'
      ];
      
            
      // Extract filename from the path
      const fileName = filePath.split(/[/\\]/).pop() || '';
      
      // Check each storage directory and its subdirectories
      for (const rootDir of rootStorageDirs) {
        const fullRootDir = join(workspaceRoot, rootDir);
                
        try {
          // First check directly in the root directory
          const directPath = join(fullRootDir, fileName);
          try {
            const directStat = await Deno.stat(directPath);
                        return directPath;
          } catch {
            // File not found directly, continue to subdirectories
          }
          
          // Try with .file extension
          if (!fileName.endsWith('.file')) {
            const fileExtPath = join(fullRootDir, `${fileName}.file`);
            try {
              const fileExtStat = await Deno.stat(fileExtPath);
                            return fileExtPath;
            } catch {
              // File not found with .file extension, continue to subdirectories
            }
          }
          
          // Then look in subdirectories
          for await (const entry of Deno.readDir(fullRootDir)) {
            if (entry.isDirectory) {
              const subDir = join(fullRootDir, entry.name);
                            
              // Check for file in this subdirectory
              const subDirFilePath = join(subDir, fileName);
              try {
                const subDirStat = await Deno.stat(subDirFilePath);
                                return subDirFilePath;
              } catch {
                // Not found in this subdirectory, try with .file extension
              }
              
              // Try with .file extension in subdirectory
              if (!fileName.endsWith('.file')) {
                const subDirFileExtPath = join(subDir, `${fileName}.file`);
                try {
                  const subDirFileExtStat = await Deno.stat(subDirFileExtPath);
                                    return subDirFileExtPath;
                } catch {
                  // Not found with .file extension in this subdirectory
                }
              }
            }
          }
        } catch (searchErr) {
          // Continue to next root directory
        }
      }
      
      // If no file found by direct paths, try to find similar files
      try {
        const fileNamePart = (filePath.split(/[/\\]/).pop() || '').split('_')[0];
        
        if (fileNamePart && fileNamePart.length > 3) {
                    
          for await (const entry of Deno.readDir(join(workspaceRoot, 'storage', 'thesis'))) {
            if (entry.isFile && entry.name.startsWith(fileNamePart)) {
              const matchPath = join(workspaceRoot, 'storage', 'thesis', entry.name);
                            return matchPath;
            }
          }
        }
      } catch (fuzzyError) {
      }
      
      // If all attempts fail, return the most likely path for logging
      return validPaths[0];
    } catch (error) {
      return null;
    }
  }

  /**
   * Get document with full metadata for emails
   * @param id Document ID
   * @returns Document with metadata or null if not found
   */
  static async getDocumentById(id: number | string): Promise<any | null> {
    try {
      // Convert string ID to number if necessary
      const docId = typeof id === 'string' ? parseInt(id) : id;
            
      // First get basic document info
      const document = await this.getById(docId);
      
      if (!document) {
        return null;
      }
      
            
      // Get category info if available
      let category = null;
      if (document.category_id) {
                
        try {
          const categoryResult = await client.queryObject(
            "SELECT name FROM categories WHERE id = $1",
            [document.category_id]
          );
                    
          if (categoryResult.rows.length > 0) {
            category = categoryResult.rows[0].name;
                      } else {
                      }
        } catch (categoryError) {
          // Check if it's a table not found error
          if (categoryError instanceof Error && categoryError.message.includes("relation") && categoryError.message.includes("does not exist")) {
          }
        }
      } else {
                
        // Try to use category field if it exists directly on document
        if (document.category) {
          category = document.category;
                  }
      }
      
      // Get author info
      let author = null;
      try {
                
        const authorsResult = await client.queryObject(
          `SELECT a.full_name 
           FROM authors a
           JOIN document_authors da ON a.id = da.author_id
           WHERE da.document_id = $1
           ORDER BY da.author_order`,
          [docId]
        );
        
                
        if (authorsResult.rows.length > 0) {
          author = authorsResult.rows.map(a => a.full_name).join(', ');
                  } else {
                    
          // Check if the document has an author field directly
          if (document.author) {
            author = document.author;
                      }
        }
      } catch (authorError) {
        // Check if it's a table not found error
        if (authorError instanceof Error && authorError.message.includes("relation") && authorError.message.includes("does not exist")) {
        }
        
        // Try to use author field if it exists directly on document
        if (document.author) {
          author = document.author;
                  }
      }
      
      // Get keywords
      let keywords = null;
      try {
                
        const keywordsResult = await client.queryObject(
          `SELECT k.term AS name
           FROM keywords k
           JOIN document_keywords dk ON k.id = dk.keyword_id
           WHERE dk.document_id = $1`,
          [docId]
        );
        
                
        if (keywordsResult.rows.length > 0) {
          keywords = keywordsResult.rows.map(k => k.name).join(', ');
                  } else {
                    
          // Check if the document has keywords field directly
          if (document.keywords) {
            keywords = Array.isArray(document.keywords) ? document.keywords.join(', ') : document.keywords;
                      }
        }
      } catch (keywordError) {
        // Check if it's a table not found error
        if (keywordError instanceof Error && keywordError.message.includes("relation") && keywordError.message.includes("does not exist")) {
        }
        
        // Try to use keywords field if it exists directly on document
        if (document.keywords) {
          keywords = Array.isArray(document.keywords) ? document.keywords.join(', ') : document.keywords;
                  }
      }
      
      // Create enriched document with metadata
      const enrichedDocument = {
        ...document,
        author,
        category,
        keywords
      };
      
      console.log(`[DocumentModel.getDocumentById] Returning enriched document:`, {
        id: enrichedDocument.id,
        title: enrichedDocument.title,
        author: enrichedDocument.author,
        category: enrichedDocument.category,
        keywords: enrichedDocument.keywords
      });
      
      return enrichedDocument;
    } catch (error) {
      return null;
    }
  }

  /**
   * Get all contained document paths for a compiled document
   * @param compiledDocId Compiled document ID
   * @returns Array of file paths for all child documents
   */
  static async getCompiledDocumentChildPaths(compiledDocId: number | string): Promise<string[]> {
    try {
      // Convert ID to number if it's a string
      const docId = typeof compiledDocId === 'string' ? parseInt(compiledDocId) : compiledDocId;
      
      if (isNaN(docId)) {
        return [];
      }
      
            
      // First check if this is actually a compiled document
      const checkResult = await client.queryObject<{ id: number }>(
        "SELECT id FROM compiled_documents WHERE id = $1",
        [docId]
      );
      
      if (checkResult.rows.length === 0) {
        // Check if it might be a document that is part of a compiled document
        const parentResult = await client.queryObject<{ compiled_document_id: number }>(
          "SELECT compiled_document_id FROM compiled_document_items WHERE document_id = $1 LIMIT 1",
          [docId]
        );
        
        if (parentResult.rows.length > 0 && parentResult.rows[0].compiled_document_id) {
          const parentId = parentResult.rows[0].compiled_document_id;
                    return this.getCompiledDocumentChildPaths(parentId);
        }
        
        return [];
      }
      
      // Query all child documents through the relationship table
      const result = await client.queryObject<{ document_id: number, file_path: string }>(
        `SELECT cdi.document_id, d.file_path 
         FROM compiled_document_items cdi
         JOIN documents d ON cdi.document_id = d.id
         WHERE cdi.compiled_document_id = $1 
         AND d.deleted_at IS NULL
         ORDER BY cdi.order_position ASC`,
        [docId]
      );
      
            
      // Get the file paths for all child documents
      const filePaths: string[] = [];
      
      for (const row of result.rows) {
        if (row.file_path) {
          try {
            const resolvedPath = await this.getDocumentPath(row.document_id);
            if (resolvedPath) {
              filePaths.push(resolvedPath);
                          } else {
              // Still add the raw file path as a fallback
              filePaths.push(row.file_path);
            }
          } catch (error) {
            // Add raw path as fallback
            filePaths.push(row.file_path);
          }
        } else {
        }
      }
      
      return filePaths;
    } catch (error) {
      return [];
    }
  }
}

/**
 * Helper function to convert BigInt values to regular numbers for JSON serialization
 * This function is used internally and doesn't affect the typings of the main methods
 */
function processRowsForSerialization(rows: any): any {
  // If it's a single object (single row result)
  if (rows && typeof rows === 'object' && !Array.isArray(rows)) {
    const processed = { ...rows };
    
    // Convert any BigInt values to numbers
    for (const key in processed) {
      if (typeof processed[key] === 'bigint') {
        processed[key] = Number(processed[key]);
      }
    }
    
    return processed;
  }
  
  // If it's an array of objects (multiple rows)
  if (Array.isArray(rows)) {
    return rows.map(row => {
      const processed = { ...row };
      
      // Convert any BigInt values to numbers
      for (const key in processed) {
        if (typeof processed[key] === 'bigint') {
          processed[key] = Number(processed[key]);
        }
      }
      
      return processed;
    });
  }
  
  // If it's neither an object nor an array, return as is
  return rows;
}
