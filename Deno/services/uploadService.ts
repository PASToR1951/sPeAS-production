// Simple file upload service

import { ensureDir, extname, join } from "../deps.ts";
import { STORAGE_ROOT, WORKSPACE_ROOT } from "../config/storage.ts";

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
  absolutePath: string;
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

interface ResolvedUploadDirectory {
  absolutePath: string;
  logicalPath: string;
}

/**
 * Resolve a client-facing storage path to the canonical physical storage root.
 * The returned logical path is always safe to persist or expose in API output.
 */
export function resolveUploadDirectory(
  storagePath: string,
  workspaceRoot = WORKSPACE_ROOT,
  storageRoot = STORAGE_ROOT,
): ResolvedUploadDirectory {
  const normalizedInput = normalizePathSlashes(storagePath);
  const normalizedStorageRoot = normalizePathSlashes(storageRoot);
  const normalizedWorkspaceStorage = `${
    normalizePathSlashes(workspaceRoot)
  }/storage`;
  const logicalInput = normalizedInput.replace(/^\/+/, "");

  let storageSubpath: string | null = null;
  if (logicalInput === "storage") {
    storageSubpath = "";
  } else if (logicalInput.startsWith("storage/")) {
    storageSubpath = logicalInput.slice("storage/".length);
  } else {
    storageSubpath = subpathUnderRoot(normalizedInput, normalizedStorageRoot) ??
      subpathUnderRoot(normalizedInput, normalizedWorkspaceStorage);
  }

  if (storageSubpath === null) {
    throw new Error(
      "Upload destination must be inside the configured storage directory",
    );
  }

  const segments = storageSubpath.split("/").filter(Boolean);
  if (segments.some((segment) => segment === "." || segment === "..")) {
    throw new Error("Upload destination contains an invalid path segment");
  }

  return {
    absolutePath: segments.reduce(
      (current, segment) => join(current, segment),
      storageRoot,
    ),
    logicalPath: segments.length > 0
      ? `storage/${segments.join("/")}`
      : "storage",
  };
}

function normalizePathSlashes(value: string): string {
  const normalized = value.trim().replace(/\\/g, "/").replace(/\/{2,}/g, "/");
  if (normalized === "/") return normalized;
  return normalized.replace(/\/+$/, "");
}

function subpathUnderRoot(candidate: string, root: string): string | null {
  const ignoreCase = /^[A-Za-z]:\//u.test(candidate) ||
    /^[A-Za-z]:\//u.test(root);
  const comparedCandidate = ignoreCase ? candidate.toLowerCase() : candidate;
  const comparedRoot = ignoreCase ? root.toLowerCase() : root;
  if (comparedCandidate === comparedRoot) return "";
  if (!comparedCandidate.startsWith(`${comparedRoot}/`)) return null;
  return candidate.slice(root.length + 1);
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
  options: FileUploadOptions = {},
): Promise<FileResponse> {
  try {
    // Get original filename or generate one
    let originalName = "";
    if (
      typeof file === "object" && file !== null &&
      ("originalName" in file || "filename" in file || "name" in file)
    ) {
      const fileWithName = file as FileWithContent;
      originalName = fileWithName.originalName ||
        (fileWithName.name?.includes(".") ? fileWithName.name : "") ||
        fileWithName.filename ||
        fileWithName.name ||
        "";
    } else if (options.originalName) {
      originalName = options.originalName;
    }

    // Generate unique filename
    let fileExtension = (originalName || "unknown.pdf").split(".").pop() ||
      "pdf";

    // Detect file type and ensure proper extension for known types
    const fileType = (typeof file === "object" && "type" in file && file.type)
      ? file.type
      : "";
    if (
      fileType.includes("pdf") || originalName.toLowerCase().endsWith(".pdf")
    ) {
      fileExtension = "pdf";
    } else if (
      fileType.includes("word") ||
      originalName.toLowerCase().match(/\.(docx?|rtf)$/)
    ) {
      fileExtension = originalName.toLowerCase().endsWith(".docx")
        ? "docx"
        : originalName.toLowerCase().endsWith(".doc")
        ? "doc"
        : "rtf";
    } else if (
      fileType.includes("image/") ||
      originalName.toLowerCase().match(/\.(jpg|jpeg|png|gif|bmp|svg)$/i)
    ) {
      fileExtension = originalName.toLowerCase().split(".").pop() || "jpg";
    } else {
      // Default to PDF for document management system
      fileExtension = "pdf";
    }

    const resolvedStorage = resolveUploadDirectory(storagePath);
    const fullStoragePath = resolvedStorage.absolutePath;

    // Ensure the directory exists
    await ensureDir(fullStoragePath);

    let finalFilename: string;
    if (options.keepOriginalName && options.originalName) {
      // For replacements, use the original name
      finalFilename = options.originalName;
    } else {
      finalFilename = createStoredFilename(options.uploaderHash, fileExtension);
    }

    let fullFilePath = join(fullStoragePath, finalFilename);

    // If this is a replacement, try to delete both the original path and the new path
    if (options.keepOriginalName && options.originalPath) {
      try {
        // Try to delete file at original path - make sure this is relative to workspace root
        let normalizedOriginalPath = options.originalPath.replace(/\\/g, "/")
          .replace(/^\/+|\/+$/g, "");

        // Handle absolute paths that start with protocol or drive letter
        if (
          normalizedOriginalPath.startsWith("http:") ||
          normalizedOriginalPath.startsWith("https:")
        ) {
          // Extract just the path portion for URLs
          try {
            const url = new URL(normalizedOriginalPath);
            normalizedOriginalPath = url.pathname.replace(/^\/+/, "");
          } catch (urlError) {
          }
        } else if (normalizedOriginalPath.match(/^[A-Za-z]:\//)) {
          // For Windows paths, extract the path relative to storage directory
          const parts = normalizedOriginalPath.split("/");
          const storageIndex = parts.findIndex((part) => part === "storage");
          if (storageIndex !== -1) {
            normalizedOriginalPath = parts.slice(storageIndex).join("/");
          } else {
          }
        }

        const originalFileName = normalizedOriginalPath.split("/").pop() || "";
        const originalDirectory = normalizedOriginalPath.slice(
          0,
          normalizedOriginalPath.lastIndexOf("/"),
        );
        if (!originalFileName || !originalDirectory) {
          throw new Error("Original file path is invalid");
        }
        normalizedOriginalPath = join(
          resolveUploadDirectory(originalDirectory).absolutePath,
          originalFileName,
        );

        const originalExists = await Deno.stat(normalizedOriginalPath).catch(
          (err) => {
            return false;
          },
        );

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
    } else if (typeof file === "string" && file.startsWith("data:")) {
      try {
        const base64String = file.split(",")[1];
        fileContent = Uint8Array.from(
          atob(base64String),
          (c) => c.charCodeAt(0),
        );
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Invalid data URI format: ${message}`);
      }
    } else {
      throw new Error(
        "Unsupported file object format. File must contain a path, arrayBuffer method, content, or bytes property.",
      );
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
          finalFilename = createStoredFilename(
            options.uploaderHash,
            fileExtension,
          );
          fullFilePath = join(fullStoragePath, finalFilename);
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
        throw new Error(
          "Could not allocate a unique stored filename after multiple attempts",
        );
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

    const relativePath = `${resolvedStorage.logicalPath}/${finalFilename}`;

    // Return file information without creating a database record
    const response = {
      path: relativePath,
      absolutePath: fullFilePath,
      name: finalFilename,
      size: fileSize,
      type: (file as FileWithContent).type ||
        getMimeTypeFromExtension(extname(finalFilename)),
    };
    return response;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to save file: ${message}`);
  }
}

function createStoredFilename(
  uploaderHash: string | undefined,
  extension: string,
): string {
  const uploaderToken = uploaderHash?.toLowerCase().replace(/[^a-f0-9]/g, "") ||
    "system";
  const dateToken = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const extensionToken = extension.toLowerCase().replace(/[^a-z0-9]/g, "") ||
    "bin";
  return `${uploaderToken}_${dateToken}_${crypto.randomUUID()}.${extensionToken}`;
}

async function writeFileExclusively(
  filePath: string,
  content: Uint8Array,
): Promise<void> {
  const file = await Deno.open(filePath, { write: true, createNew: true });
  try {
    let offset = 0;
    while (offset < content.length) {
      const written = await file.write(content.subarray(offset));
      if (written === 0) {
        throw new Error("The stored file could not be written completely");
      }
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
    ".pdf": "application/pdf",
    ".docx":
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".doc": "application/msword",
    ".pptx":
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".ppt": "application/vnd.ms-powerpoint",
    ".xlsx":
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".xls": "application/vnd.ms-excel",
    ".txt": "text/plain",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".zip": "application/zip",
    ".rar": "application/x-rar-compressed",
    ".mp4": "video/mp4",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
  };

  return mimeTypes[extension.toLowerCase()] || "application/octet-stream";
}
