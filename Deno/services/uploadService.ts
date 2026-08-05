// Simple file upload service

import { ensureDir, extname, join } from "../deps.ts";
import { createFile } from "../controllers/fileController.ts";
import { storagePathFor, WORKSPACE_ROOT } from "../config/storage.ts";

interface FileUploadOptions {
  keepOriginalName?: boolean;
  originalName?: string;
  originalPath?: string;
  documentType?: string;
  category?: string;
  uploaderHash?: string;
}

interface FileResponse {
  path: string;
  name: string;
  size: number;
  type: string;
}

interface FileWithContent {
  originalName?: string;
  filename?: string;
  name?: string;
  content?: Uint8Array;
  bytes?: Uint8Array;
  path?: string;
  arrayBuffer?: () => Promise<ArrayBuffer>;
  type?: string;
}

/**
 * Creates the directory structure for a given document type and category
 * @param documentType The type of document (THESIS, DISSERTATION, etc.)
 * @param category Optional category within the document type
 * @returns The created directory path
 */
async function createDocumentTypeDirectory(documentType: string, category?: string): Promise<string> {
  // Canonical structure: STORAGE_ROOT/[documentType] (see config/storage.ts)
  const baseDir = storagePathFor(documentType);
  
  try {
    // Create base directory if it doesn't exist
    try {
      await Deno.mkdir(baseDir, { recursive: true });
    } catch (error) {
      if (!(error instanceof Deno.errors.AlreadyExists)) {
        throw error;
      }
    }
    
    // We no longer create category subdirectories for a flatter structure
    return baseDir;
  } catch (error) {
    throw error;
  }
}

/**
 * Save a file to the specified path
 * @param file The file to save
 * @param storagePath The path to save the file to (relative to the project root)
 * @param options Additional options for the save operation
 * @returns The path to the saved file (relative to the project root)
 */
export async function saveFile(
  file: FileWithContent | Uint8Array | ArrayBuffer | string,
  storagePath = "storage/general",
  options: FileUploadOptions = {}
): Promise<FileResponse> {

  // Workspace root (parent of Deno/) — from the central storage config
  const workspaceRoot = WORKSPACE_ROOT;
  
  // Get document type and category from options
  const documentType = options.documentType?.toUpperCase() || "GENERAL";
  const category = options.category;
  
  try {
    // Create appropriate directory structure
    await createDocumentTypeDirectory(documentType, category);
    
    // Get original filename or generate one
    let originalName = "";
    if (typeof file === "object" && file !== null && ("originalName" in file || "filename" in file || "name" in file)) {
      const fileWithName = file as FileWithContent;
      originalName = fileWithName.originalName
        || (fileWithName.name?.includes(".") ? fileWithName.name : "")
        || fileWithName.filename
        || fileWithName.name
        || "";
    } else if (options.originalName) {
      originalName = options.originalName;
    }
    
    // Generate unique filename
    let fileExtension = (originalName || "unknown.pdf").split(".").pop() || "pdf";
    
    // Detect file type and ensure proper extension for known types
    const fileType = (typeof file === "object" && "type" in file && file.type) ? file.type : "";
    if (fileType.includes("pdf") || originalName.toLowerCase().endsWith(".pdf")) {
      fileExtension = "pdf";
    } else if (fileType.includes("word") || originalName.toLowerCase().match(/\.(docx?|rtf)$/)) {
      fileExtension = originalName.toLowerCase().endsWith(".docx") ? "docx" : originalName.toLowerCase().endsWith(".doc") ? "doc" : "rtf";
    } else if (fileType.includes("image/") || originalName.toLowerCase().match(/\.(jpg|jpeg|png|gif|bmp|svg)$/i)) {
      fileExtension = originalName.toLowerCase().split('.').pop() || "jpg";
    } else {
      // Default to PDF for document management system
      fileExtension = "pdf";
    }
    
    // Normalize storage path to use forward slashes and no leading/trailing slashes
    storagePath = storagePath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    
    // Make sure the storage path is relative to the workspace root, not the Deno directory
    // If storagePath doesn't start with the workspace root, prepend it
    const fullStoragePath = storagePath.startsWith(workspaceRoot) 
      ? storagePath 
      : join(workspaceRoot, storagePath).replace(/\\/g, '/');
    
    // Ensure the directory exists
    await ensureDir(fullStoragePath);
        
    let finalFilename: string;
    if (options.keepOriginalName && options.originalName) {
      // For replacements, use the original name
      finalFilename = options.originalName;
    } else {
      finalFilename = createStoredFilename(options.uploaderHash, fileExtension);
    }
    
    // Create the full path using forward slashes
    let fullFilePath = join(fullStoragePath, finalFilename).replace(/\\/g, '/');
        
    // If this is a replacement, try to delete both the original path and the new path
    if (options.keepOriginalName && options.originalPath) {
      try {
        // Try to delete file at original path - make sure this is relative to workspace root
        let normalizedOriginalPath = options.originalPath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');

                                
        // Handle absolute paths that start with protocol or drive letter
        if (normalizedOriginalPath.startsWith('http:') || normalizedOriginalPath.startsWith('https:')) {
          // Extract just the path portion for URLs
          try {
            const url = new URL(normalizedOriginalPath);
            normalizedOriginalPath = url.pathname.replace(/^\/+/, '');
                      } catch (urlError) {
          }
        } else if (normalizedOriginalPath.match(/^[A-Za-z]:\//)) {
          // For Windows paths, extract the path relative to storage directory
          const parts = normalizedOriginalPath.split('/');
          const storageIndex = parts.findIndex(part => part === 'storage');
          if (storageIndex !== -1) {
            normalizedOriginalPath = parts.slice(storageIndex).join('/');
                      } else {
          }
        }
        
        // If the original path doesn't start with the workspace root, prepend it
        if (!normalizedOriginalPath.startsWith(workspaceRoot)) {
          normalizedOriginalPath = join(workspaceRoot, normalizedOriginalPath).replace(/\\/g, '/');
        }
        
                
        const originalExists = await Deno.stat(normalizedOriginalPath).catch((err) => {
          return false;
        });
        
        if (originalExists) {
          await Deno.remove(normalizedOriginalPath);
                  } else {
                  }
        
        // Also try to delete at the new path if it's different
        if (normalizedOriginalPath !== fullFilePath) {
                    const newExists = await Deno.stat(fullFilePath).catch(() => false);
          if (newExists) {
            await Deno.remove(fullFilePath);
                      }
        }
      } catch (error: unknown) {
        // Log error but continue with upload
        const errorMsg = error instanceof Error ? error.message : String(error);
      }
    }

    // Get the file content - enhanced to handle more formats
    let fileContent: Uint8Array;
    const fileObj = file as FileWithContent;
    
    if (fileObj.content) {
            fileContent = fileObj.content;
    } else if (fileObj.bytes) {
            fileContent = fileObj.bytes;
    } else if (fileObj.path) {
            try {
        fileContent = await Deno.readFile(fileObj.path);
              } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Could not read temporary file: ${message}`);
      }
    } else if (fileObj.arrayBuffer) {
            try {
        const buffer = await fileObj.arrayBuffer();
        fileContent = new Uint8Array(buffer);
              } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Could not process file buffer: ${message}`);
      }
    } else if (file instanceof Uint8Array || file instanceof ArrayBuffer) {
            fileContent = file instanceof ArrayBuffer ? new Uint8Array(file) : file;
    } else if (typeof file === 'string' && file.startsWith('data:')) {
            try {
        const base64String = file.split(',')[1];
        fileContent = Uint8Array.from(atob(base64String), c => c.charCodeAt(0));
              } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Invalid data URI format: ${message}`);
      }
    } else {
      throw new Error("Unsupported file object format. File must contain a path, arrayBuffer method, content, or bytes property.");
    }
    
    if (!fileContent || fileContent.length === 0) {
      throw new Error("File content is empty");
    }
    
    // New uploads use exclusive creation. If an identifier ever collides, a new
    // UUID is generated instead of overwriting an existing document.
    if (options.keepOriginalName && options.originalName) {
      await Deno.writeFile(fullFilePath, fileContent);
    } else {
      const maxCreateAttempts = 5;
      let stored = false;
      for (let attempt = 0; attempt < maxCreateAttempts; attempt += 1) {
        if (attempt > 0) {
          finalFilename = createStoredFilename(options.uploaderHash, fileExtension);
          fullFilePath = join(fullStoragePath, finalFilename).replace(/\\/g, '/');
        }
        try {
          await writeFileExclusively(fullFilePath, fileContent);
          stored = true;
          break;
        } catch (error) {
          if (!(error instanceof Deno.errors.AlreadyExists)) throw error;
        }
      }
      if (!stored) {
        throw new Error("Could not allocate a unique stored filename after multiple attempts");
      }
    }
        
    // Get file size
    let fileSize = 0;
    try {
      const fileInfo = await Deno.stat(fullFilePath);
      fileSize = fileInfo.size;
          } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
    }
    
    // For the response, return the path relative to workspace root for API consistency
    // This ensures the file can be accessed via the correct URL
    const relativePath = fullFilePath.startsWith(workspaceRoot)
      ? fullFilePath.substring(workspaceRoot.length).replace(/^[\\/]+/, '')
      : fullFilePath;
    
    // Return file information without creating a database record
    const response = {
      path: relativePath,
      name: finalFilename,
      size: fileSize,
      type: (file as FileWithContent).type || getMimeTypeFromExtension(extname(finalFilename))
    };
        return response;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to save file: ${message}`);
  }
}

function createStoredFilename(uploaderHash: string | undefined, extension: string): string {
  const uploaderToken = uploaderHash?.toLowerCase().replace(/[^a-f0-9]/g, "") || "system";
  const dateToken = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const extensionToken = extension.toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
  return `${uploaderToken}_${dateToken}_${crypto.randomUUID()}.${extensionToken}`;
}

async function writeFileExclusively(filePath: string, content: Uint8Array): Promise<void> {
  const file = await Deno.open(filePath, { write: true, createNew: true });
  try {
    let offset = 0;
    while (offset < content.length) {
      const written = await file.write(content.subarray(offset));
      if (written === 0) throw new Error("The stored file could not be written completely");
      offset += written;
    }
  } catch (error) {
    file.close();
    await Deno.remove(filePath).catch(() => undefined);
    throw error;
  }
  file.close();
}

/**
 * Delete a file
 * @param filePath The path to the file to delete
 */
export async function deleteFile(filePath: string): Promise<void> {
  try {
        await Deno.remove(filePath);
      } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to delete file: ${message}`);
  }
}

/**
 * Get MIME type from file extension
 * @param extension File extension with dot (e.g., ".pdf")
 * @returns MIME type string or application/octet-stream if unknown
 */
function getMimeTypeFromExtension(extension: string): string {
  const mimeTypes: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.doc': 'application/msword',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.ppt': 'application/vnd.ms-powerpoint',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.xls': 'application/vnd.ms-excel',
    '.txt': 'text/plain',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.zip': 'application/zip',
    '.rar': 'application/x-rar-compressed',
    '.mp4': 'video/mp4',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav'
  };
  
  return mimeTypes[extension.toLowerCase()] || 'application/octet-stream';
}
