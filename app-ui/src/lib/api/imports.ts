import type {
  ImportBatch,
  ImportItem,
  ImportMetadata,
  ImportMode,
  PreparationRecipe,
} from "../../../../shared/imports";
import { apiFetch } from "./http";
export const importBase = "/api/admin/import-batches";
export const fetchImport = (id: string) =>
  apiFetch<ImportBatch>(`${importBase}/${id}`);
export const createImport = (mode: ImportMode, key = crypto.randomUUID()) =>
  apiFetch<ImportBatch>(importBase, {
    method: "POST",
    json: { mode, idempotencyKey: key },
  });
export const createImportPaper = (
  batchId: string,
  externalKey: string,
  metadata?: ImportMetadata,
) =>
  apiFetch<ImportItem>(`${importBase}/${batchId}/items`, {
    method: "POST",
    json: { externalKey, metadata },
  });
export const updateImportPaper = (
  item: ImportItem,
  changes: {
    metadata?: ImportMetadata;
    recipe?: PreparationRecipe;
    ignored?: boolean;
  },
) =>
  apiFetch<ImportItem>(`${importBase}/${item.batchId}/items/${item.id}`, {
    method: "PUT",
    json: { revision: item.revision, ...changes },
  });
export async function fileSha256(file: File): Promise<string> {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", await file.arrayBuffer()),
    ),
  ].map((v) => v.toString(16).padStart(2, "0")).join("");
}
export async function sourceSetKey(hashes: string[]): Promise<string> {
  const bytes = new TextEncoder().encode([...hashes].sort().join("\n"));
  return "files:" +
    [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((v) =>
      v.toString(16).padStart(2, "0")
    ).join("");
}
