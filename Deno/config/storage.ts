/**
 * Canonical document-storage configuration.
 *
 * All uploads live under one root: <workspace>/storage/<documentType>/
 * (e.g. storage/thesis/, storage/dissertation/). The root can be overridden
 * with the STORAGE_ROOT environment variable (useful for Docker volumes).
 *
 * Both the upload path (uploadService) and the lookup paths
 * (fileCheckService) derive from this module — do not hardcode storage
 * folders elsewhere.
 */

import { join } from "../deps.ts";

/** Repository root — the parent of the Deno/ directory. */
export const WORKSPACE_ROOT = Deno.cwd().replace(/[\\/]Deno$/, "");

/** Root directory for all stored documents. */
export const STORAGE_ROOT = Deno.env.get("STORAGE_ROOT") ??
  join(WORKSPACE_ROOT, "storage");

/** Root for news media staging files and generated variants. */
export const NEWS_MEDIA_ROOT = join(STORAGE_ROOT, "news-media");

export const NEWS_MEDIA_STAGING_ROOT = join(NEWS_MEDIA_ROOT, "staging");
export const NEWS_MEDIA_SOURCE_ROOT = join(NEWS_MEDIA_ROOT, "source");
export const NEWS_MEDIA_VARIANTS_ROOT = join(NEWS_MEDIA_ROOT, "variants");

/** `local` is the safe development default; production adapters may select `s3`. */
export const NEWS_MEDIA_STORAGE_MODE = Deno.env.get("NEWS_MEDIA_STORAGE") === "s3" ? "s3" : "local";

/** Directory for a given document type (lowercased), e.g. storage/thesis. */
export function storagePathFor(documentType: string): string {
  return join(STORAGE_ROOT, documentType.toLowerCase()).replace(/\\/g, "/");
}

/** Known document-type subdirectories (for lookups across existing data). */
export const DOCUMENT_TYPE_DIRS = [
  "thesis",
  "dissertation",
  "confluence",
  "synergy",
  "general",
] as const;
