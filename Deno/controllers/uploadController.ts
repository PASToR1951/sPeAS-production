// Upload controller for handling file uploads

import { Context } from "../deps.ts";
import { saveFile } from "../services/uploadService.ts";
import { inspectPdfFile } from "../services/abstractExtractionService.ts";
import { createUploaderHashCode } from "../utils/uploaderHash.ts";

export interface UploadPolicy {
  documentOnly?: boolean;
}

const DOCUMENT_UPLOAD_MAX_BYTES = 100_000_000;
const GENERAL_UPLOAD_MAX_BYTES = 500_000_000;

/**
 * Handle file upload request
 * @param ctx The Oak context
 * @returns HTTP response
 */
export async function handleFileUpload(
  ctx: Context,
  policy: UploadPolicy = {},
): Promise<void> {
  try {
    // Check if content type is multipart/form-data
    const contentType = ctx.request.headers.get("content-type");
    if (!contentType || !contentType.includes("multipart/form-data")) {
      ctx.response.status = 400;
      ctx.response.body = { error: "Content-Type must be multipart/form-data" };
      return;
    }

    // Get form data
    const form = await ctx.request.body({ type: "form-data" }).value;
    const maxFileSize = policy.documentOnly
      ? DOCUMENT_UPLOAD_MAX_BYTES
      : GENERAL_UPLOAD_MAX_BYTES;
    const data = await form.read({
      maxFileSize,
      maxSize: maxFileSize + 10_000_000,
    });

    // Get file from form data
    let file = data.files?.[0];

    if (!file) {
      // Look for the file in a field named "file" if no files array is found
      for (const [key, value] of Object.entries(data.fields)) {
        if (key === "file" && value) {
          // If the value is a file-like object
          const fileLike = value as unknown as {
            name?: string;
            filename?: string;
          };
          if (
            typeof value === "object" && (fileLike.name || fileLike.filename)
          ) {
            file = value as unknown as typeof file;
            break;
          }
        }
      }

      if (!file) {
        ctx.response.status = 400;
        ctx.response.body = { error: "No file provided in the request" };
        return;
      }
    }

    // Check if file has required properties
    if (!file.name && !file.filename) {
      file.name = "unnamed_file";
    }

    // Check if this is a profile picture upload
    const isProfilePicture = data.fields.is_profile_picture === "true";
    const isReplacement = data.fields.is_replacement === "true";
    const uploaderHash = await createUploaderHashCode(
      String(ctx.state.user?.id ?? ""),
    );

    if (policy.documentOnly && (isProfilePicture || isReplacement)) {
      ctx.response.status = 403;
      ctx.response.body = {
        error: "This upload route only accepts new document PDFs",
      };
      return;
    }

    if (isProfilePicture) {
      // Handle profile picture upload
      return await handleProfilePictureUpload(file, ctx, uploaderHash);
    }

    // Get storage path from form data or original path for replacements
    let storagePath = data.fields.storagePath;
    const originalName = data.fields.original_name;
    let originalPath = data.fields.original_path;

    // Get document type and category information
    const documentType = data.fields.document_type || "GENERAL";
    const category = data.fields.category;

    // Validate document type only for document uploads
    const validDocumentTypes = [
      "THESIS",
      "DISSERTATION",
      "CONFLUENCE",
      "SYNERGY",
      "HELLO",
    ];
    if (!validDocumentTypes.includes(documentType.toUpperCase())) {
      ctx.response.status = 400;
      ctx.response.body = {
        error: `Invalid document type. Must be one of: ${
          validDocumentTypes.join(", ")
        }`,
      };
      return;
    }

    const originalFileName = getUploadedFileName(file).toLowerCase();
    if (policy.documentOnly && !originalFileName.endsWith(".pdf")) {
      ctx.response.status = 415;
      ctx.response.body = { error: "Only PDF document uploads are allowed" };
      return;
    }

    if (policy.documentOnly) {
      storagePath = `storage/${documentType.toLowerCase()}`;
    }

    // Normalize path separators to forward slashes and remove leading/trailing slashes
    if (originalPath) {
      originalPath = originalPath.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
    }

    // Special handling for foreword files
    const isFileNameForeword = getUploadedFileName(file).toLowerCase().includes(
      "foreword",
    );
    const isForewordUpload = isFileNameForeword ||
      (data.fields.document_type &&
        data.fields.document_type.toString().toLowerCase().includes(
          "foreword",
        )) ||
      data.fields.is_foreword === "true";

    // Extract storage path from original path if available
    if (originalPath && originalPath.includes("/")) {
      const lastSlashIndex = originalPath.lastIndexOf("/");
      storagePath = originalPath.substring(0, lastSlashIndex);
    }

    // Default storage path if one is not provided
    if (!storagePath) {
      storagePath = "storage/hello";
    }

    // Clean up the path for safety
    storagePath = storagePath.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");

    // Handle foreword files specially - ensure they go to a forewords subfolder
    if (isForewordUpload) {
      // Extract document type from path or from form data
      const pathParts = storagePath.split("/");
      let docType = "hello"; // Default

      // Try to get document type from path
      if (pathParts.length > 1) {
        docType = pathParts[1].toLowerCase();
      }

      // Override with document_type from form data if available
      if (data.fields.document_type) {
        docType = data.fields.document_type.toString().toLowerCase();
      }

      // Handle various document types - ensure they're valid
      const validDocTypes = [
        "thesis",
        "dissertation",
        "confluence",
        "synergy",
        "hello",
      ];
      if (!validDocTypes.includes(docType)) {
        docType = "hello";
      }

      // Ensure the path correctly includes the document type and forewords subfolder
      if (storagePath.includes("forewords")) {
        // Path already includes forewords subfolder, verify its structure
        const forewordDirIndex = storagePath.indexOf("forewords");
        const beforeForewordDir = storagePath.substring(0, forewordDirIndex);

        if (!beforeForewordDir.includes(docType)) {
          // Needs correcting - rebuild the path
          storagePath = `storage/${docType}/forewords`;
        }
      } else {
        // Build the proper foreword path
        storagePath = `storage/${docType}/forewords`;
      }
    }

    // Ensure storage path is at workspace level
    if (storagePath.includes("Deno/storage")) {
      storagePath = storagePath.replace("Deno/storage", "storage");
    }

    // Save file with replacement options if needed
    const saveOptions = isReplacement && originalName
      ? {
        keepOriginalName: true,
        originalName: originalName,
        originalPath: originalPath, // Pass the full original path to the upload service
        documentType,
        category,
        uploaderHash,
      }
      : {
        documentType,
        category,
        uploaderHash,
      };

    // Save file
    const fileResult = await saveFile(file, storagePath, saveOptions);

    // Verify file was saved
    const fullFilePath = fileResult.absolutePath;
    try {
      const stat = await Deno.stat(fullFilePath);
    } catch (statError: unknown) {
      const errorMessage = statError instanceof Error
        ? statError.message
        : String(statError);
    }

    if (policy.documentOnly) {
      const signature = new Uint8Array(5);
      const savedFile = await Deno.open(fullFilePath, { read: true });
      try {
        await savedFile.read(signature);
      } finally {
        savedFile.close();
      }
      if (new TextDecoder().decode(signature) !== "%PDF-") {
        await Deno.remove(fullFilePath).catch(() => undefined);
        ctx.response.status = 415;
        ctx.response.body = { error: "The uploaded file is not a valid PDF" };
        return;
      }
    }

    // Inspect PDF structure synchronously, but defer abstract extraction to the
    // durable worker so uploads never store guesses or block on OCR.
    let metadata = null;
    const isPdf = getUploadedFileName(file).toLowerCase().endsWith(".pdf");

    if (isPdf) {
      const inspection = await inspectPdfFile(fullFilePath);
      if (!inspection) {
        await Deno.remove(fullFilePath).catch(() => undefined);
        ctx.response.status = 422;
        ctx.response.body = {
          error:
            "The PDF could not be inspected. Choose a valid, readable PDF file.",
        };
        return;
      }
      if (inspection.encrypted) {
        await Deno.remove(fullFilePath).catch(() => undefined);
        ctx.response.status = 422;
        ctx.response.body = {
          error: "Password-protected PDFs are not supported.",
        };
        return;
      }
      metadata = {
        abstract: null,
        pageCount: inspection.pageCount,
        abstractExtraction: "deferred",
      };
    }

    // Return response with file path and metadata
    const response = {
      message: isReplacement
        ? "File replaced successfully"
        : "File uploaded successfully",
      filePath: "/" + fileResult.path.replace(/\\/g, "/"),
      originalName: fileResult.name,
      size: fileResult.size,
      metadata: metadata || null,
      fileType: isPdf ? "pdf" : "other",
      isReplacement: isReplacement,
      status: "success",
      timestamp: new Date().toISOString(),
      details: {
        fullPath: fileResult.path,
        storagePath: storagePath,
        originalFileName: getUploadedFileName(file),
        documentType: documentType,
      },
    };

    // Ensure the file path starts with /storage/ and does not contain absolute paths
    if (response.filePath.match(/^\/[A-Za-z]:\//)) {
      // Extract just the storage path part
      const parts = response.filePath.split("/");
      const storageIndex = parts.findIndex((part) => part === "storage");

      if (storageIndex !== -1) {
        // Reconstruct the path starting from 'storage'
        response.filePath = "/" + parts.slice(storageIndex).join("/");
      }
    }

    ctx.response.status = 200;
    ctx.response.body = response;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const status = uploadFailureStatus(errorMessage);
    console.error("[upload] File upload failed", {
      errorType: error instanceof Error ? error.name : typeof error,
      message: errorMessage,
      method: ctx.request.method,
      url: ctx.request.url.pathname,
    });
    ctx.response.status = status;
    ctx.response.body = {
      error: status === 413
        ? "The PDF is larger than the 100 MB upload limit. Reduce the file size and try again."
        : status === 422
        ? "The selected PDF is empty and cannot be uploaded."
        : "Failed to upload file",
      status: "error",
      details: errorMessage,
      timestamp: new Date().toISOString(),
      debug: {
        errorType: error instanceof Error ? error.name : typeof error,
        requestInfo: {
          method: ctx.request.method,
          url: ctx.request.url.pathname,
          contentType: ctx.request.headers.get("content-type") || "unknown",
        },
      },
    };
  }
}

function uploadFailureStatus(message: string): number {
  if (
    /maximum size|maxfilesize|max file size|too large|entity too large|size limit|exceed(?:ed|s)?(?: the)? limit/iu
      .test(message)
  ) return 413;
  if (/file content is empty|empty file/iu.test(message)) return 422;
  return 500;
}

function getUploadedFileName(
  file:
    | { originalName?: unknown; filename?: unknown; name?: unknown }
    | null
    | undefined,
): string {
  const originalName = typeof file?.originalName === "string"
    ? file.originalName.trim()
    : "";
  if (originalName) return originalName;

  const name = typeof file?.name === "string" ? file.name.trim() : "";
  if (name.includes(".")) return name;

  const filename = typeof file?.filename === "string"
    ? file.filename.trim()
    : "";
  return filename || name;
}

/**
 * Handle profile picture upload
 * @param file The profile picture file
 * @param ctx The Oak context
 */
export async function handleProfilePictureUpload(
  file: any,
  ctx: Context,
  uploaderHash: string,
): Promise<void> {
  try {
    // Handle profile picture upload
    const storagePath = "storage/authors/profile-pictures";
    const saveOptions = {
      documentType: "PROFILE_PICTURE",
      category: "PROFILE",
      uploaderHash,
    };

    // Save profile picture
    const fileResult = await saveFile(file, storagePath, saveOptions);

    // Extract just the filename from the path
    const matches = fileResult.path.match(/([^/\\]+)$/);
    const filename = matches ? matches[1] : fileResult.name;

    // Create a consistent relative path
    const relativePath = `storage/authors/profile-pictures/${filename}`;

    ctx.response.status = 200;
    ctx.response.body = {
      message: "Profile picture uploaded successfully",
      filePath: `/${relativePath}`,
      originalName: fileResult.name,
      size: fileResult.size,
      status: "success",
      timestamp: new Date().toISOString(),
    };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    ctx.response.status = 500;
    ctx.response.body = {
      error: "Failed to upload profile picture",
      status: "error",
      details: errorMessage,
      timestamp: new Date().toISOString(),
    };
  }
}
