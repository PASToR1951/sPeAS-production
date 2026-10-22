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

import { dotenvConfig, join } from "../deps.ts";
import { fromFileUrl } from "https://deno.land/std@0.200.0/path/from_file_url.ts";

/** Repository root — the parent of the Deno/ directory. */
export const WORKSPACE_ROOT = Deno.cwd().replace(/[\\/]Deno$/, "");

async function configuredStorageRoot(): Promise<string | undefined> {
  const processValue = Deno.env.get("STORAGE_ROOT")?.trim();
  if (processValue) return processValue;

  // `deno task dev` does not populate Deno.env from .env automatically. Load
  // the storage setting here instead of depending on the database module to
  // win an import-order race and export the same file first. Tests retain the
  // isolated workspace default unless they explicitly provide STORAGE_ROOT.
  if (Deno.env.get("DENO_ENV") === "test") return undefined;
  try {
    const localEnv = await dotenvConfig({
      envPath: fromFileUrl(new URL("../.env", import.meta.url)),
      export: false,
    });
    return localEnv.STORAGE_ROOT?.trim() || undefined;
  } catch {
    return undefined;
  }
}

/** Root directory for all stored documents. */
export const STORAGE_ROOT = (await configuredStorageRoot()) ??
  join(WORKSPACE_ROOT, "storage");

/** Root for news media staging files and generated variants. */
export const NEWS_MEDIA_ROOT = join(STORAGE_ROOT, "news-media");

export const NEWS_MEDIA_STAGING_ROOT = join(NEWS_MEDIA_ROOT, "staging");
export const NEWS_MEDIA_SOURCE_ROOT = join(NEWS_MEDIA_ROOT, "source");
export const NEWS_MEDIA_VARIANTS_ROOT = join(NEWS_MEDIA_ROOT, "variants");

/** `local` is the safe development default; production adapters may select `s3`. */
export const NEWS_MEDIA_STORAGE_MODE =
  Deno.env.get("NEWS_MEDIA_STORAGE") === "s3" ? "s3" : "local";

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
