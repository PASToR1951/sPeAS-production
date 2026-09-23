import { client, withTransaction } from "../db/denopost_conn.ts";
import { type PreparationRecipe } from "../../shared/imports.ts";
import { type Row } from "./importPreparationService.ts";
import {
  boundedCommand,
  checkedStagedPath,
  convertWord,
  digestFile,
  ImportError,
  stagingPath,
} from "./importStorageService.ts";
import { assembleImportPdf, inspectImportPdf } from "./importPdfService.ts";
import { extractAbstractFromPdfPath } from "./abstractExtractionWorkerService.ts";
import { STORAGE_ROOT } from "../config/storage.ts";
import { join } from "https://deno.land/std@0.200.0/path/mod.ts";

export async function recoverImportJobs(): Promise<void> {
  await client.queryArray(
    "UPDATE import_jobs SET status=CASE WHEN attempts>=3 THEN 'failed' ELSE 'queued' END,lease_token=NULL,worker_id=NULL,error='Import worker restarted; retry preparation if needed' WHERE status='processing' AND heartbeat_at<now()-interval '2 minutes'",
  );
  await client.queryArray(
    "UPDATE import_items i SET state='failed',error=j.error FROM import_jobs j WHERE j.item_id=i.id AND j.recipe_revision=i.recipe_revision AND j.status='failed' AND i.state='preparing'",
  );
}
export async function claimImportJob(workerId: string): Promise<Row | null> {
  return withTransaction(async (connection) => {
    const job = (await connection.queryObject<Row>(
      `SELECT j.* FROM import_jobs j JOIN import_batches b ON b.id=j.batch_id WHERE j.status='queued' AND j.available_at<=now() AND b.status='draft' AND b.expires_at>now() ORDER BY j.created_at FOR UPDATE OF j SKIP LOCKED LIMIT 1`,
    )).rows[0];
    if (!job) return null;
    const result = await connection.queryObject<Row>(
      "UPDATE import_jobs SET status='processing',attempts=attempts+1,worker_id=$2,lease_token=gen_random_uuid(),heartbeat_at=now() WHERE id=$1 RETURNING *",
      [job.id, workerId],
    );
    return result.rows[0];
  });
}
export async function processImportJob(job: Row): Promise<void> {
  const heartbeat = setInterval(() => {
    void client.queryArray(
      "UPDATE import_jobs SET heartbeat_at=now() WHERE id=$1 AND lease_token=$2 AND status='processing'",
      [job.id, job.lease_token],
    ).catch(() => undefined);
  }, 15_000);
  const directory = stagingPath(job.batch_id, job.lease_token);
  try {
    await Deno.mkdir(directory, { recursive: true, mode: 0o700 });
    const item = (await client.queryObject<Row>(
      "SELECT * FROM import_items WHERE id=$1 AND recipe_revision=$2",
      [job.item_id, job.recipe_revision],
    )).rows[0];
    if (!item) return;
    const parts = (item.recipe as PreparationRecipe).parts.filter((p) =>
      p.included
    );
    const sources = [];
    for (const part of parts) {
      const asset = (await client.queryObject<Row>(
        "SELECT * FROM import_assets WHERE id=$1 AND batch_id=$2",
        [part.assetId, job.batch_id],
      )).rows[0];
      if (!asset || asset.kind === "catalog") {
        throw new ImportError("A component is missing");
      }
      let path = asset.preview_path;
      if (!path) {
        const source = await checkedStagedPath(asset.source_path);
        if (await digestFile(source) !== asset.sha256) {
          throw new ImportError("Source integrity check failed");
        }
        const converted = await convertWord(source, directory);
        path = converted.path;
        const bytes = await Deno.readFile(path),
          pdf = await inspectImportPdf(bytes);
        const hash = await digestFile(path);
        await client.queryArray(
          `UPDATE import_assets SET preview_path=$2,preview_sha256=$3,page_count=$4,conversion=$5,error=NULL WHERE id=$1 AND preview_path IS NULL
           AND EXISTS(SELECT 1 FROM import_jobs j JOIN import_items i ON i.id=j.item_id JOIN import_batches b ON b.id=j.batch_id WHERE j.id=$6 AND j.lease_token=$7 AND j.status='processing' AND i.recipe_revision=j.recipe_revision AND b.status='draft')`,
          [
            asset.id,
            path,
            hash,
            pdf.getPageCount(),
            JSON.stringify({
              engine: converted.version,
              fontManifest: Deno.env.get("IMPORT_FONT_MANIFEST_SHA256") || null,
              release: Deno.env.get("PEAS_RELEASE_ID") || "development",
            }),
            job.id,
            job.lease_token,
          ],
        );
        // Two workers may prepare the same immutable source for different papers.
        // Keep the first stored preview; a late worker never replaces reviewed bytes.
        path = (await client.queryObject<Row>(
          "SELECT preview_path FROM import_assets WHERE id=$1",
          [asset.id],
        )).rows[0]?.preview_path;
        if (!path) return;
      }
      const preparedPath = await checkedStagedPath(path);
      const currentAsset = (await client.queryObject<Row>(
        "SELECT preview_sha256 FROM import_assets WHERE id=$1",
        [asset.id],
      )).rows[0];
      if (await digestFile(preparedPath) !== currentAsset.preview_sha256) {
        throw new ImportError(
          "Component preview integrity check failed. Replace this source.",
        );
      }
      sources.push({
        id: asset.id,
        sha256: asset.sha256,
        bytes: () => Deno.readFile(preparedPath),
      });
    }
    let output: {
      path: string;
      hash: string;
      pages: number;
      mapping: unknown;
      candidate: unknown;
    } | null = null;
    if (job.kind === "assemble") {
      const assembled = await assembleImportPdf(item.recipe, sources);
      const path = stagingPath(job.batch_id, job.lease_token, "final.pdf");
      await Deno.writeFile(path, assembled.bytes, {
        createNew: true,
        mode: 0o600,
      });
      // Unavailable extraction never blocks manual abstract entry or creates a repository document.
      const extracted = await extractAbstractFromPdfPath(path).catch(() => ({
        candidate: null,
      }));
      output = {
        path,
        hash: await digestFile(path),
        pages: assembled.pages,
        mapping: assembled.mapping,
        candidate: extracted.candidate,
      };
    }
    await withTransaction(async (connection) => {
      const active = (await connection.queryObject<Row>(
        "SELECT j.id FROM import_jobs j JOIN import_items i ON i.id=j.item_id JOIN import_batches b ON b.id=j.batch_id WHERE j.id=$1 AND j.lease_token=$2 AND j.status='processing' AND i.recipe_revision=j.recipe_revision AND i.document_id IS NULL AND i.state<>'ignored' AND b.status='draft' FOR UPDATE OF j,i,b",
        [job.id, job.lease_token],
      )).rows[0];
      if (!active) return;
      if (output) {
        await connection.queryArray(
          "UPDATE import_items SET final_path=$2,final_sha256=$3,page_count=$4,page_mapping=$5,abstract_candidate=$6,review=review-'pdfSha256'-'abstractAction'-'abstractText',state='needs_review',revision=revision+1,error=NULL WHERE id=$1",
          [
            job.item_id,
            output.path,
            output.hash,
            output.pages,
            JSON.stringify(output.mapping),
            JSON.stringify(output.candidate),
          ],
        );
      } else {await connection.queryArray(
          "UPDATE import_items SET state=CASE WHEN final_sha256 IS NULL THEN 'draft' ELSE 'needs_review' END,error=NULL WHERE id=$1",
          [job.item_id],
        );}
      await connection.queryArray(
        "UPDATE import_jobs SET status='done',heartbeat_at=now() WHERE id=$1",
        [job.id],
      );
    });
  } catch (error) {
    const message = error instanceof ImportError
      ? error.message
      : "Preparation failed. Retry, or upload a prepared PDF.";
    const retry = !(error instanceof ImportError) && Number(job.attempts) < 3;
    await withTransaction(async (connection) => {
      const updated = await connection.queryObject(
        "UPDATE import_jobs SET status=$3,error=$4,available_at=now()+interval '10 seconds' WHERE id=$1 AND lease_token=$2 AND status='processing' RETURNING id",
        [job.id, job.lease_token, retry ? "queued" : "failed", message],
      );
      if (updated.rows.length) {
        await connection.queryArray(
          "UPDATE import_items SET state=$3,error=$4 WHERE id=$1 AND recipe_revision=$2 AND document_id IS NULL AND state<>'ignored'",
          [
            job.item_id,
            job.recipe_revision,
            retry ? "preparing" : "failed",
            message,
          ],
        );
      }
    });
  } finally {
    clearInterval(heartbeat);
  }
}

export async function importWorkerDiagnostics(workerId: string) {
  let version = "",
    ready = false,
    diagnostic = "Word conversion is disabled. PDF preparation is available.";
  if (Deno.env.get("IMPORT_CONVERTER_ISOLATED") === "true") {
    try {
      version = new TextDecoder().decode(
        await boundedCommand(
          Deno.env.get("IMPORT_LIBREOFFICE_PATH") || "soffice",
          ["--version"],
          15000,
        ),
      ).trim();
      ready = !!Deno.env.get("IMPORT_LIBREOFFICE_VERSION") &&
        version.includes(Deno.env.get("IMPORT_LIBREOFFICE_VERSION")!);
      diagnostic = ready
        ? "Converter is configured. Every converted component still requires layout review."
        : "Converter version differs from the qualified version; use a prepared PDF.";
    } catch {
      diagnostic = "Converter unavailable. Upload a prepared PDF.";
    }
  }
  await client.queryArray(
    "INSERT INTO import_worker_state(worker_id,converter_version,converter_ready,diagnostic) VALUES($1,$2,$3,$4) ON CONFLICT(worker_id) DO UPDATE SET heartbeat_at=now(),converter_version=$2,converter_ready=$3,diagnostic=$4",
    [workerId, version, ready, diagnostic],
  );
}

/** Reads/polls never extend retention. A live lease or an export transaction defers deletion. */
export async function purgeExpiredImports(): Promise<number> {
  return withTransaction(async (connection) => {
    const batches = await connection.queryObject<Row>(
      "SELECT b.id FROM import_batches b WHERE b.status<>'expired' AND b.expires_at<=now() AND NOT EXISTS(SELECT 1 FROM import_jobs j WHERE j.batch_id=b.id AND j.status='processing' AND j.heartbeat_at>now()-interval '2 minutes') ORDER BY b.expires_at FOR UPDATE OF b SKIP LOCKED LIMIT 10",
    );
    for (const batch of batches.rows) {
      await Deno.remove(stagingPath(batch.id), { recursive: true }).catch(
        (e) => {
          if (!(e instanceof Deno.errors.NotFound)) throw e;
        },
      );
      await connection.queryArray(
        "UPDATE import_batches SET status='expired' WHERE id=$1",
        [batch.id],
      );
      await connection.queryArray(
        "UPDATE import_assets SET source_path='',preview_path=NULL WHERE batch_id=$1",
        [batch.id],
      );
      await connection.queryArray(
        "UPDATE import_items SET state=CASE WHEN document_id IS NULL THEN 'expired' ELSE state END,final_path=NULL WHERE batch_id=$1",
        [batch.id],
      );
      await connection.queryArray(
        "UPDATE import_jobs SET status='superseded' WHERE batch_id=$1 AND status IN ('queued','processing')",
        [batch.id],
      );
      await connection.queryArray(
        "DELETE FROM import_exports WHERE batch_id=$1",
        [batch.id],
      );
    }
    return batches.rows.length;
  });
}

/** Failed commits can leave immutable copies. Only reclaim old, unreferenced
 * files after their workspace expires, so a concurrent retry cannot lose a PDF. */
export async function purgeAbandonedImportCopies(): Promise<number> {
  const directory = join(STORAGE_ROOT, "imports");
  let removed = 0;
  try {
    for await (const file of Deno.readDir(directory)) {
      if (!file.isFile) continue;
      const match =
        /^(?:(?:cover|foreword)-)?([0-9a-f-]{36})-[0-9a-f]{64}\.pdf(?:\.[0-9a-f-]{36}\.part)?$/
          .exec(file.name);
      if (!match) continue;
      const path = join(directory, file.name), stat = await Deno.stat(path);
      if (!stat.mtime || stat.mtime.getTime() > Date.now() - 86_400_000) {
        continue;
      }
      const reference = `storage/imports/${file.name}`;
      const protectedFile = await client.queryObject(
        `SELECT 1 WHERE
        EXISTS(SELECT 1 FROM documents WHERE file_path=$1) OR
        EXISTS(SELECT 1 FROM compiled_documents WHERE cover_file_path=$1 OR foreword=$1) OR
        EXISTS(SELECT 1 FROM import_batches b LEFT JOIN import_items i ON i.batch_id=b.id WHERE (b.id=$2::uuid OR i.id=$2::uuid) AND b.status<>'expired')`,
        [reference, match[1]],
      );
      if (protectedFile.rows.length) continue;
      await Deno.remove(path);
      removed++;
    }
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  return removed;
}
