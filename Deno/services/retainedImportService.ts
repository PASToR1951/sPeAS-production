import {
  isAbsolute,
  relative,
  resolve,
} from "https://deno.land/std@0.200.0/path/mod.ts";
import { STORAGE_ROOT } from "../config/storage.ts";
import {
  checkedStagedPath,
  digestFile,
  ImportError,
} from "./importStorageService.ts";
import { client } from "../db/denopost_conn.ts";
const root = resolve(STORAGE_ROOT, "private-originals", "imports");
async function copyImmutable(
  source: string,
  destination: string,
  sha256: string,
) {
  try {
    if (await digestFile(destination) === sha256) return;
    throw new ImportError("Retained source integrity check failed");
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  const temporary = `${destination}.${crypto.randomUUID()}.part`;
  try {
    await Deno.copyFile(source, temporary);
    if (await digestFile(temporary) !== sha256) {
      throw new ImportError("Retained source integrity check failed");
    }
    try {
      await Deno.link(temporary, destination);
    } catch (error) {
      if (!(error instanceof Deno.errors.AlreadyExists)) throw error;
    }
    if (await digestFile(destination) !== sha256) {
      throw new ImportError("Retained source integrity check failed");
    }
  } finally {
    await Deno.remove(temporary).catch(() => undefined);
  }
}
export async function checkedRetainedImportPath(path: string) {
  const real = await Deno.realPath(path),
    rel = relative(await Deno.realPath(root), real);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) {
    throw new ImportError("Retained source is outside its archive");
  }
  return real;
}
export async function retainImportSources(batchId: string, assetIds: string[]) {
  const assets = (await client.queryObject<Record<string, any>>(
    "SELECT * FROM import_assets WHERE batch_id=$1 AND (id=ANY($2::uuid[]) OR kind='catalog')",
    [batchId, assetIds],
  )).rows;
  const directory = resolve(root, batchId);
  await Deno.mkdir(directory, { recursive: true, mode: 0o700 });
  for (const asset of assets) {
    const source = asset.retained_source_path
        ? await checkedRetainedImportPath(asset.retained_source_path)
        : await checkedStagedPath(asset.source_path),
      destination = resolve(directory, `${asset.id}.source`);
    if (await digestFile(source) !== asset.sha256) {
      throw new ImportError("Original source integrity check failed");
    }
    await copyImmutable(source, destination, asset.sha256);
    let preview: string | null = null;
    if (asset.retained_preview_path || asset.preview_path) {
      preview = resolve(directory, `${asset.id}.pdf`);
      await copyImmutable(
        asset.retained_preview_path
          ? await checkedRetainedImportPath(asset.retained_preview_path)
          : await checkedStagedPath(asset.preview_path),
        preview,
        asset.preview_sha256,
      );
    }
    await client.queryArray(
      "UPDATE import_assets SET retained_source_path=$2,retained_preview_path=$3 WHERE id=$1",
      [asset.id, destination, preview],
    );
  }
}
