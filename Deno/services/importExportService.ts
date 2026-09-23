import { Zip, ZipPassThrough } from "npm:fflate@0.8.2";
import { withTransaction } from "../db/denopost_conn.ts";
import {
  assetDto,
  itemDto,
  requireBatch,
  type Row,
} from "./importPreparationService.ts";
import {
  checkedStagedPath,
  digestFile,
  ImportError,
  stagingPath,
} from "./importStorageService.ts";

export async function exportImportSources(
  batchId: string,
  owner: string,
  itemId?: string,
): Promise<{ id: string }> {
  // The batch lock also prevents retention cleanup while streaming the archive.
  return withTransaction(async (connection) => {
    const batch = await requireBatch(batchId, owner, connection, true);
    if (
      batch.status === "expired" ||
      new Date(batch.expires_at).getTime() <= Date.now()
    ) throw new ImportError("Source retention has expired", 410);
    const items = (await connection.queryObject<Row>(
      "SELECT * FROM import_items WHERE batch_id=$1 AND ($2::uuid IS NULL OR id=$2)",
      [batchId, itemId || null],
    )).rows;
    if (itemId && !items.length) throw new ImportError("Paper not found", 404);
    const ids = items.flatMap((i) =>
      i.recipe.parts.map((p: { assetId: string }) => p.assetId)
    );
    const assets = (await connection.queryObject<Row>(
      "SELECT * FROM import_assets WHERE batch_id=$1 AND ($2::boolean OR id=ANY($3::uuid[]) OR kind='catalog') ORDER BY relative_path",
      [batchId, !itemId, ids],
    )).rows;
    const id = crypto.randomUUID(), path = stagingPath(batchId, `${id}.zip`);
    const output = await Deno.open(path, {
      write: true,
      createNew: true,
      mode: 0o600,
    });
    let pending = Promise.resolve(), failure: unknown, complete = false;
    const zip = new Zip((error, chunk) => {
      if (error) {
        failure = error;
        return;
      }
      pending = pending.then(async () => {
        let offset = 0;
        while (offset < chunk.length) {
          offset += await output.write(chunk.subarray(offset));
        }
      });
    });
    try {
      for (const asset of assets) {
        const source = await checkedStagedPath(asset.source_path);
        if (await digestFile(source) !== asset.sha256) {
          throw new ImportError(
            "Source integrity check failed; archive was not created",
          );
        }
        const entry = new ZipPassThrough(`originals/${asset.relative_path}`);
        zip.add(entry);
        const file = await Deno.open(source);
        for await (const chunk of file.readable) {
          entry.push(chunk, false);
          await pending;
          if (failure) throw failure;
        }
        entry.push(new Uint8Array(), true);
        await pending;
      }
      const manifest = new ZipPassThrough("manifest.json");
      zip.add(manifest);
      manifest.push(
        new TextEncoder().encode(JSON.stringify(
          {
            schemaVersion: 1,
            exportedAt: new Date().toISOString(),
            batchId,
            expiresAt: batch.expires_at,
            collection: batch.collection,
            assets: assets.map(assetDto),
            papers: items.map(itemDto),
          },
          null,
          2,
        )),
        true,
      );
      zip.end();
      await pending;
      if (failure) throw failure;
      await output.sync();
      complete = true;
    } finally {
      output.close();
      if (!complete) await Deno.remove(path).catch(() => undefined);
    }
    await connection.queryArray(
      "INSERT INTO import_exports(id,batch_id,file_path) VALUES($1,$2,$3)",
      [id, batchId, path],
    );
    return { id };
  });
}
