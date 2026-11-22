import { createHash } from "node:crypto";
import { join, resolve } from "https://deno.land/std@0.200.0/path/mod.ts";
import { client } from "../db/denopost_conn.ts";
import { STORAGE_ROOT } from "../config/storage.ts";
import { PDFDocument, PDFName, PDFRawStream } from "npm:pdf-lib@1.17.1";
import { strFromU8, unzipSync } from "npm:fflate@0.8.2";
import { wordImageLayoutWarnings } from "./wordImageReviewService.ts";
import {
  convertDocumentToPdf,
  DocumentConversionError,
} from "./documentConversionService.ts";
import {
  type DocumentSource,
  stitchDocumentsToPdf,
} from "./documentStitchingService.ts";
import { saveFile } from "./uploadService.ts";
import {
  emptyUploadReview,
  publicationHold,
  type UploadComponent,
  type UploadJob,
  type UploadReviewNotes,
} from "../../shared/uploadReview.ts";
import {
  DOCUMENT_MAX_BYTES,
  DOCUMENT_MAX_FILES,
  isSupportedDocument,
} from "../../shared/documentFormats.ts";
import {
  resolveStoredPdfPath,
  sha256File,
} from "./abstractExtractionService.ts";

// Static and public PDF routes block this directory; the storage backup includes it.
export const UPLOAD_ORIGINALS_ROOT = resolve(STORAGE_ROOT, "private-originals");
const hash = (bytes: Uint8Array | string) =>
  createHash("sha256").update(bytes).digest("hex");
const validId = (id: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(id);
type Options = {
  reviewContext?: string;
  documentType: string;
  category?: string;
  storagePath: string;
  uploaderHash: string;
};
type Row = Record<string, any>;
const running = new Set<string>();
function dto(r: Row): UploadJob {
  return {
    id: r.id,
    state: r.state,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
    components: r.components,
    review: r.review,
    error: r.error,
    result: r.result,
    documentId: r.document_id,
    compiledDocumentId: r.compiled_document_id,
  };
}
export async function getUploadJob(
  id: string,
  owner: string,
  admin = false,
): Promise<UploadJob> {
  if (!validId(id)) {
    throw new DocumentConversionError("Upload review not found.", 404);
  }
  const r = (await client.queryObject<Row>(
    "SELECT * FROM upload_review_jobs WHERE id=$1 AND (owner_id=$2 OR $3)",
    [id, owner, admin],
  )).rows[0];
  if (!r) throw new DocumentConversionError("Upload review not found.", 404);
  return dto(r);
}
export async function listUploadJobs(owner: string) {
  return (await client.queryObject<Row>(
    "SELECT * FROM upload_review_jobs WHERE owner_id=$1 ORDER BY created_at DESC LIMIT 100",
    [owner],
  )).rows.map(dto);
}
export async function prepareUpload(
  id: string,
  owner: string,
  sources: DocumentSource[],
  options: Options,
): Promise<UploadJob> {
  if (!validId(id)) {
    throw new DocumentConversionError(
      "Invalid upload request identifier.",
      400,
    );
  }
  if (
    !sources.length || sources.length > DOCUMENT_MAX_FILES ||
    sources.reduce((n, s) => n + s.content.length, 0) > DOCUMENT_MAX_BYTES
  ) {
    throw new DocumentConversionError(
      "Choose up to 20 files totaling 100 MB or less.",
      413,
    );
  }
  for (const s of sources) {
    if (!s.content.length || !isSupportedDocument(s.name)) {
      throw new DocumentConversionError(
        `${s.name}: choose a nonempty supported document.`,
        415,
      );
    }
  }
  const components: UploadComponent[] = sources.map((s) => ({
    name: s.name,
    size: s.content.length,
    sha256: hash(s.content),
    state: "queued",
  }));
  const fingerprint = hash(
    JSON.stringify({
      components: components.map((s) => [s.name, s.sha256]),
      options,
    }),
  );
  const row = (await client.queryObject<Row>(
    "INSERT INTO upload_review_jobs(id,owner_id,fingerprint,state,options,components) VALUES($1,$2,$3,'staging',$4,$5) ON CONFLICT(owner_id,fingerprint) DO UPDATE SET fingerprint=upload_review_jobs.fingerprint RETURNING *",
    [
      id,
      owner,
      fingerprint,
      JSON.stringify(options),
      JSON.stringify(components),
    ],
  )).rows[0];
  if (
    row.state === "ready" || row.state === "processing" ||
    (row.state === "staging" && row.id !== id &&
      Date.now() - new Date(row.updated_at).getTime() < 300_000)
  ) return dto(row);
  id = row.id;
  const directory = join(UPLOAD_ORIGINALS_ROOT, id);
  try {
    await Deno.mkdir(directory, { recursive: true, mode: 0o700 });
    for (const [i, s] of sources.entries()) {
      const path = join(directory, `${i}.source`);
      try {
        await Deno.writeFile(path, s.content, { createNew: true, mode: 0o600 });
      } catch (error) {
        if (
          !(error instanceof Deno.errors.AlreadyExists) ||
          hash(await Deno.readFile(path)) !== components[i].sha256
        ) throw error;
      }
    }
    await client.queryArray(
      "UPDATE upload_review_jobs SET state='failed',updated_at=now() WHERE id=$1",
      [id],
    );
    await runUploadJob(id);
  } catch (error) {
    await client.queryArray(
      "UPDATE upload_review_jobs SET state='failed',error=$2,updated_at=now() WHERE id=$1",
      [
        id,
        error instanceof Error ? error.message : "Upload preparation failed.",
      ],
    );
  }
  return getUploadJob(id, owner);
}
export async function runUploadJob(id: string): Promise<void> {
  if (running.has(id)) return;
  running.add(id);
  try {
    // A conditional lease also prevents duplicate retries in other web processes.
    const r = (await client.queryObject<Row>(
      "UPDATE upload_review_jobs SET state='processing',updated_at=now(),error=NULL WHERE id=$1 AND state='failed' RETURNING *",
      [id],
    )).rows[0];
    if (!r) return;
    const components = r.components as UploadComponent[],
      options = r.options as Options;
    const directory = join(UPLOAD_ORIGINALS_ROOT, id),
      converted: DocumentSource[] = [];
    let firstPage = 1;
    for (const [i, c] of components.entries()) {
      c.state = "converting";
      c.startedAt = new Date().toISOString();
      await saveProgress(id, components);
      const source = await Deno.readFile(join(directory, `${i}.source`));
      if (hash(source) !== c.sha256) {
        throw new DocumentConversionError(
          "A retained source failed its integrity check.",
        );
      }
      let bytes: Uint8Array;
      try {
        bytes = await Deno.readFile(join(directory, `${i}.pdf`));
        if (!c.pdfSha256 || hash(bytes) !== c.pdfSha256) {
          throw new Error("Regenerate");
        }
      } catch {
        bytes = await convertDocumentToPdf(c.name, source);
        await Deno.writeFile(join(directory, `${i}.pdf`), bytes, {
          mode: 0o600,
        });
      }
      const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
      if (pdf.isEncrypted || !pdf.getPageCount()) {
        throw new DocumentConversionError(
          `${c.name}: choose an unlocked PDF with pages.`,
        );
      }
      c.pages = pdf.getPageCount();
      c.firstPage = firstPage;
      c.lastPage = firstPage + c.pages - 1;
      firstPage = c.lastPage + 1;
      c.warnings = [];
      if (/\.docx$/iu.test(c.name)) {
        // These are conservative review prompts, never a conversion-fidelity proof.
        try {
          const zip = unzipSync(source, {
            filter: (file) =>
              file.originalSize <= 5_000_000 &&
              (file.name === "word/document.xml" ||
                file.name === "docProps/app.xml"),
          });
          const xml = zip["word/document.xml"]
            ? strFromU8(zip["word/document.xml"])
            : "";
          c.warnings.push(...wordImageLayoutWarnings(xml));
          const declared = Number(
            zip["docProps/app.xml"]
              ? strFromU8(zip["docProps/app.xml"]).match(
                /<Pages>(\d+)<\/Pages>/u,
              )?.[1]
              : 0,
          );
          if (declared && declared !== c.pages) {
            c.warnings.push(
              `Word reports ${declared} pages; conversion produced ${c.pages}. Source page metadata may be stale. Check completeness.`,
            );
          }
          if (
            /<(?:a:blip|v:imagedata)\b/u.test(xml) &&
            !pdf.context.enumerateIndirectObjects().some(([, obj]) =>
              obj instanceof PDFRawStream &&
              obj.dict.get(PDFName.of("Subtype")) === PDFName.of("Image")
            )
          ) {
            c.warnings.push(
              "The Word source references images, but no raster images were detected in the PDF. Check for missing image content.",
            );
          }
        } catch {
          c.warnings.push(
            "Word image metadata could not be inspected. Compare all pages with the original.",
          );
        }
      }
      c.pdfSha256 = hash(bytes);
      c.state = "ready";
      c.finishedAt = new Date().toISOString();
      converted.push({ name: `${i}.pdf`, content: bytes });
      await saveProgress(id, components);
    }
    const pdf = await stitchDocumentsToPdf(converted);
    const saved = await saveFile(
      {
        originalName: components[0].name.replace(/\.[^.]+$/u, "") +
          "-reviewed.pdf",
        content: pdf,
        type: "application/pdf",
      },
      options.storagePath,
      options,
    );
    const result = {
      filePath: "/" + saved.path.replace(/\\/gu, "/"),
      metadata: { pageCount: firstPage - 1, abstract: null, sha256: hash(pdf) },
      uploadJobId: id,
    };
    let converterVersion = "PDF passthrough";
    if (components.some((c) => !c.name.toLowerCase().endsWith(".pdf"))) {
      try {
        const output = await new Deno.Command("soffice", {
          args: ["--version"],
          signal: AbortSignal.timeout(15000),
          stdout: "piped",
          stderr: "null",
        }).output();
        converterVersion = new TextDecoder().decode(output.stdout).trim() ||
          "LibreOffice (version unavailable)";
      } catch {
        converterVersion = "LibreOffice (version unavailable)";
      }
    }
    const manifest = {
      version: 1,
      createdAt: r.created_at,
      components,
      finalSha256: hash(pdf),
      engine: converterVersion,
      fontManifest: Deno.env.get("IMPORT_FONT_MANIFEST_SHA256") || null,
      release: Deno.env.get("PEAS_RELEASE_ID") || "development",
    };
    await Deno.writeTextFile(
      join(directory, "manifest.json"),
      JSON.stringify(manifest, null, 2),
      { mode: 0o600 },
    );
    await Deno.writeFile(join(directory, "final.pdf"), pdf, { mode: 0o600 });
    await client.queryArray(
      "UPDATE upload_review_jobs SET state='ready',result=$2,error=NULL,updated_at=now() WHERE id=$1",
      [id, JSON.stringify(result)],
    );
  } catch (error) {
    await client.queryArray(
      "UPDATE upload_review_jobs SET state='failed',components=(SELECT jsonb_agg(CASE WHEN c->>'state'='converting' THEN jsonb_set(c,'{state}','\"failed\"') ELSE c END) FROM jsonb_array_elements(components) c),error=$2,updated_at=now() WHERE id=$1",
      [id, error instanceof Error ? error.message : "Conversion failed."],
    );
  } finally {
    running.delete(id);
  }
}
async function saveProgress(id: string, components: UploadComponent[]) {
  await client.queryArray(
    "UPDATE upload_review_jobs SET components=$2,updated_at=now() WHERE id=$1",
    [id, JSON.stringify(components)],
  );
}
export async function retryUploadJob(id: string, owner: string) {
  const job = await getUploadJob(id, owner);
  if (
    job.state !== "failed" &&
    !(["processing", "staging"].includes(job.state) &&
      Date.now() - new Date(job.updatedAt).getTime() > 300_000)
  ) {
    throw new DocumentConversionError(
      "This conversion is still running or is already ready.",
      409,
    );
  }
  for (const [i, c] of job.components.entries()) {
    const bytes = await Deno.readFile(
      join(UPLOAD_ORIGINALS_ROOT, id, `${i}.source`),
    ).catch(() => null);
    if (!bytes || hash(bytes) !== c.sha256) {
      await client.queryArray(
        "UPDATE upload_review_jobs SET state='failed',error='The original transfer was incomplete. Reselect these files and prepare them again to finish staging.',updated_at=now() WHERE id=$1",
        [id],
      );
      throw new DocumentConversionError(
        "The original transfer was incomplete. Reselect these files and prepare them again to finish staging.",
        409,
      );
    }
  }
  // Mark a stale interrupted attempt failed before starting a fresh conversion.
  const claimed = await client.queryObject(
    "UPDATE upload_review_jobs SET state='failed' WHERE id=$1 AND (state='failed' OR (state IN ('staging','processing') AND updated_at<now()-interval '5 minutes')) RETURNING id",
    [id],
  );
  if (!claimed.rows.length) {
    throw new DocumentConversionError(
      "This conversion is already being resumed.",
      409,
    );
  }
  void runUploadJob(id);
  return getUploadJob(id, owner);
}
export async function saveUploadReview(
  id: string,
  owner: string,
  input: UploadReviewNotes,
  admin = false,
) {
  const job = await getUploadJob(id, owner, admin);
  if (job.state !== "ready") {
    throw new DocumentConversionError(
      "Wait for the converted PDF before reviewing it.",
      409,
    );
  }
  if (
    !input || typeof input !== "object" ||
    !["unchecked", "complete", "missing_sections"].includes(
      input.completeness,
    ) ||
    ![
      "none",
      "source_error",
      "incomplete_sources",
      "browser_interruption",
      "suspected_conversion",
      "confirmed_defect",
    ].includes(input.issueKind) || typeof input.remarks !== "string" ||
    input.remarks.length > 10000 || typeof input.holdReason !== "string" ||
    input.holdReason.length > 2000 || typeof input.layoutReviewed !== "boolean"
  ) throw new DocumentConversionError("Invalid review notes.", 400);
  await client.queryArray(
    "UPDATE upload_review_jobs SET review=$2,updated_at=now() WHERE id=$1",
    [id, JSON.stringify(input)],
  );
  return getUploadJob(id, owner, admin);
}
export async function bindUploadReview(
  id: string,
  owner: string,
  documentId: number,
  filePath: string,
) {
  const job = await getUploadJob(id, owner);
  if (
    job.state !== "ready" || job.result?.filePath !== filePath ||
    (job.documentId && job.documentId !== documentId)
  ) {
    throw new DocumentConversionError(
      "The upload review does not match this document.",
      409,
    );
  }
  await client.queryArray(
    "UPDATE upload_review_jobs SET document_id=$2,updated_at=now() WHERE id=$1 AND (document_id IS NULL OR document_id=$2)",
    [id, documentId],
  );
}
export async function uploadPublicationHold(
  documentId: number,
): Promise<string | null> {
  const rows = (await client.queryObject<Row>(
    "SELECT j.review,j.result,d.file_path FROM upload_review_jobs j JOIN documents d ON d.id=j.document_id WHERE j.document_id=$1",
    [documentId],
  )).rows;
  for (const r of rows) {
    const path = resolveStoredPdfPath(r.file_path);
    if (
      !path ||
      await sha256File(path).catch(() => null) !== r.result?.metadata?.sha256
    ) {
      return "The manuscript changed. Prepare and review its current PDF before publication.";
    }
  }
  return rows.map((r) =>
    r.result?.filePath !== r.file_path
      ? "The manuscript changed. Review its current PDF before publication."
      : publicationHold({ ...emptyUploadReview(), ...r.review })
  ).find(Boolean) ?? null;
}
export async function bindCompiledUploadReviews(
  ids: string[],
  owner: string,
  compiledId: number,
) {
  for (const id of ids) {
    await getUploadJob(id, owner);
    await client.queryArray(
      "UPDATE upload_review_jobs SET compiled_document_id=$2 WHERE id=$1 AND (compiled_document_id IS NULL OR compiled_document_id=$2)",
      [id, compiledId],
    );
  }
}
export async function compiledUploadPublicationHold(id: number) {
  const rows = (await client.queryObject<Row>(
    "SELECT j.review,j.result,j.document_id,j.compiled_document_id,d.file_path,c.cover_file_path,c.foreword FROM upload_review_jobs j LEFT JOIN documents d ON d.id=j.document_id LEFT JOIN compiled_documents c ON c.id=j.compiled_document_id WHERE j.compiled_document_id=$1 OR (d.compiled_parent_id=$1 AND d.deleted_at IS NULL)",
    [id],
  )).rows;
  for (const row of rows) {
    const stored = row.document_id
      ? row.file_path
      : [row.cover_file_path, row.foreword].find((path) =>
        path === row.result?.filePath
      );
    const path = stored ? resolveStoredPdfPath(stored) : null;
    if (
      !path || stored !== row.result?.filePath ||
      await sha256File(path).catch(() => null) !== row.result?.metadata?.sha256
    ) {
      return "A publication file changed. Review its current PDF before publication.";
    }
  }
  return rows.map((r) =>
    publicationHold({ ...emptyUploadReview(), ...r.review })
  ).find(Boolean) ?? null;
}
export async function uploadAsset(
  id: string,
  owner: string,
  asset: string,
  admin = false,
) {
  const job = await getUploadJob(id, owner, admin);
  if (asset === "manifest") {
    const manifest = JSON.parse(
      await Deno.readTextFile(join(UPLOAD_ORIGINALS_ROOT, id, "manifest.json")),
    );
    return {
      bytes: new TextEncoder().encode(
        JSON.stringify(
          { ...manifest, review: job.review, documentId: job.documentId },
          null,
          2,
        ),
      ),
      type: "application/json",
      name: "conversion-manifest.json",
    };
  }
  if (asset === "final") {
    return {
      bytes: await Deno.readFile(join(UPLOAD_ORIGINALS_ROOT, id, "final.pdf")),
      type: "application/pdf",
      name: "converted.pdf",
    };
  }
  const match = /^(\d+)\.(source|pdf)$/u.exec(asset);
  if (!match || !job.components[Number(match[1])]) {
    throw new DocumentConversionError("Source not found.", 404);
  }
  return {
    bytes: await Deno.readFile(join(UPLOAD_ORIGINALS_ROOT, id, asset)),
    type: match[2] === "pdf" ? "application/pdf" : "application/octet-stream",
    name: match[2] === "source"
      ? job.components[Number(match[1])].name
      : "component.pdf",
  };
}
