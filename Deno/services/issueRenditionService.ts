import { createHash } from "node:crypto";
import { resolve } from "https://deno.land/std@0.200.0/path/mod.ts";
import { client, withTransaction } from "../db/denopost_conn.ts";
import { STORAGE_ROOT } from "../config/storage.ts";
import { assembleImportPdf, type AssemblySource } from "./importPdfService.ts";
import { digestFile, ImportError } from "./importStorageService.ts";
import { resolveStoredPdfPath } from "./abstractExtractionService.ts";
import {
  checkedRetainedImportPath,
  retainImportSources,
} from "./retainedImportService.ts";
import {
  issuePaperRange,
  validateIssueRanges,
} from "../../shared/issuePreparation.ts";
import type {
  ImportCollection,
  PageMapping,
  RecipePart,
} from "../../shared/imports.ts";
import { canViewCompilation } from "./contentAuthorizationService.ts";

type Row = Record<string, any>;
const hash = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");

const integrityChecks = new Map<
  string,
  { version: string; sha256: string; checkedAt: number }
>();
/** Immutable prepared files are hashed once per file version, rather than once per PDF byte range. */
export async function storedIssuePdfIntact(
  reference: string,
  expected: string,
): Promise<boolean> {
  const path = resolveStoredPdfPath(reference);
  if (!path) return false;
  try {
    const stat = await Deno.stat(path);
    if (!stat.isFile) return false;
    const version =
      `${stat.size}:${stat.mtime?.getTime()}:${stat.birthtime?.getTime()}:${stat.ino}`;
    const cached = integrityChecks.get(path);
    if (
      cached?.version === version && cached.sha256 === expected &&
      Date.now() - cached.checkedAt < 30_000
    ) return true;
    const actual = await digestFile(path);
    if (actual !== expected) {
      integrityChecks.delete(path);
      return false;
    }
    if (integrityChecks.size >= 256) {
      integrityChecks.delete(integrityChecks.keys().next().value!);
    }
    integrityChecks.set(path, {
      version,
      sha256: actual,
      checkedAt: Date.now(),
    });
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}
const intactRendition = (row: Row) =>
  storedIssuePdfIntact(row.file_path, row.sha256);
const includesForeword = (parent: Row, row: Row) =>
  !parent.foreword || row.manifest.components?.some((part: PageMapping) =>
    part.assetId.startsWith("Front matter-") &&
    (!parent.foreword_content_sha256 ||
      part.sourceSha256 === parent.foreword_content_sha256)
  );

/** Snapshot the actual catalog, never a caller-supplied storage path. */
export async function issueCatalogSnapshot(
  id: number,
  db: Pick<typeof client, "queryObject"> = client,
) {
  const parent = (await db.queryObject<Row>(
    `SELECT id,category,start_year,end_year,volume,issue_number,department,
    cover_file_path,cover_page_count,front_cover_page,back_cover_page,foreword,foreword_content_sha256,abstract_foreword,contents_revision,contents_needs_resolution
    FROM compiled_documents WHERE id=$1 AND deleted_at IS NULL`,
    [id],
  )).rows[0];
  if (!parent || parent.contents_needs_resolution) {
    throw new ImportError(
      "Resolve issue membership before preparing the complete PDF.",
      409,
    );
  }
  const papers = (await db.queryObject<Row>(
    `SELECT d.id,d.title,d.file_path,d.content_sha256,d.pages,d.abstract,d.publication_date::text AS publication_date,d.publication_date_precision,d.document_type,d.original_program,d.original_major,c.position,
    (SELECT jsonb_agg(author_id ORDER BY author_order) FROM document_authors WHERE document_id=d.id) AS author_ids,
    (SELECT jsonb_agg(topic_id ORDER BY topic_order) FROM document_topics WHERE document_id=d.id) AS topic_ids,
    (SELECT jsonb_agg(keyword_id ORDER BY keyword_order) FROM document_keywords WHERE document_id=d.id) AS keyword_ids,
    (SELECT metadata->'printedPageRange' FROM import_provenance WHERE document_id=d.id) AS printed_page_range
    FROM compiled_document_items c JOIN documents d ON d.id=c.document_id
    WHERE c.compiled_document_id=$1 AND d.compiled_parent_id=$1 AND d.deleted_at IS NULL ORDER BY c.position,d.id`,
    [id],
  )).rows;
  if (!papers.length) {
    throw new ImportError(
      "Save the issue's papers before preparing the complete PDF.",
      409,
    );
  }
  return {
    parent,
    papers,
    fingerprint: hash(JSON.stringify({ parent, papers })),
  };
}

export async function validateBatchIssueRanges(
  batchId: string,
  db: Pick<typeof client, "queryObject"> = client,
) {
  const batch = (await db.queryObject<Row>(
    "SELECT collection FROM import_batches WHERE id=$1",
    [batchId],
  )).rows[0];
  const collection = batch?.collection as ImportCollection | null;
  if (collection?.sourceArrangement !== "complete_issue") return;
  const main = (await db.queryObject<Row>(
    "SELECT * FROM import_assets WHERE id=$1 AND batch_id=$2 AND kind='pdf'",
    [collection.mainAssetId, batchId],
  )).rows[0];
  if (!main) throw new ImportError("Choose the prepared main issue PDF.");
  const items = (await db.queryObject<Row>(
    "SELECT id,metadata,recipe FROM import_items WHERE batch_id=$1 AND state<>'ignored' ORDER BY external_key,id",
    [batchId],
  )).rows;
  if (!items.length) throw new ImportError("Add the papers in this issue.");
  const ranges = items.map((item) => {
    try {
      return issuePaperRange({
        id: item.id,
        metadata: item.metadata,
        recipe: item.recipe,
      }, main.id);
    } catch (error) {
      throw new ImportError((error as Error).message);
    }
  });
  const result = validateIssueRanges(
    main.page_count,
    ranges,
    collection.pageSections ?? [],
  );
  if (result.errors.length) {
    throw new ImportError(result.errors.slice(0, 5).join(" "));
  }
  if (result.gaps.length) {
    throw new ImportError(
      `Unaccounted source pages: ${
        result.gaps.join(", ")
      }. Mark front matter, covers or explicitly excluded pages before saving.`,
    );
  }
  if (
    collection.paperOrder?.length &&
    JSON.stringify(collection.paperOrder) !==
      JSON.stringify(
        [...ranges].sort((a, b) => a.first - b.first).map((r) => r.id),
      )
  ) {
    throw new ImportError(
      "For a complete issue source, paper order must match the confirmed physical page ranges.",
    );
  }
  if (
    collection.coverAssetId === main.id &&
    !(collection.pageSections ?? []).some((s) =>
      s.role === "cover" && s.first <= collection.frontPage &&
      s.last >= collection.frontPage
    )
  ) {
    throw new ImportError(
      "Identify the embedded front cover in the page accounting.",
    );
  }
  if (collection.coverAssetId !== main.id && collection.pageSections?.some(section=>section.role==="cover")) throw new ImportError("The main PDF already has embedded covers. Select the main PDF as the cover source, or explicitly exclude those pages before using separate replacement covers.");
  if (
    collection.coverAssetId === main.id &&
    !(collection.pageSections ?? []).some((s) =>
      s.role === "cover" && s.first <= collection.backPage &&
      s.last >= collection.backPage
    )
  ) {
    throw new ImportError(
      "Identify the embedded back cover in the page accounting.",
    );
  }
  if (collection.forewordAssetId === main.id) {
    throw new ImportError(
      "The main issue already contains front matter. Do not append it again as a foreword.",
    );
  }
  return { main, ranges };
}

/** Prepare once, then serve the immutable output. Assembly never runs on a reader request. */
export async function prepareIssueRendition(id: number) {
  const current = await issueCatalogSnapshot(id);
  const existing = (await client.queryObject<Row>(
    "SELECT * FROM issue_renditions WHERE compiled_document_id=$1 AND fingerprint=$2",
    [id, current.fingerprint],
  )).rows[0];
  const existingIncludesForeword = existing &&
    includesForeword(current.parent, existing);
  if (existingIncludesForeword && await intactRendition(existing)) {
    return renditionDto(existing);
  }
  const batch = (await client.queryObject<Row>(
    "SELECT * FROM import_batches WHERE compiled_document_id=$1 ORDER BY created_at DESC LIMIT 1",
    [id],
  )).rows[0];
  const { filePath, sha256, pages, manifest } = await buildIssueRendition(
    current,
    batch,
  );
  return withTransaction(async (db) => {
    await db.queryArray(
      "SELECT id FROM compiled_documents WHERE id=$1 FOR UPDATE",
      [id],
    );
    if (
      (await issueCatalogSnapshot(id, db)).fingerprint !== current.fingerprint
    ) {
      throw new ImportError(
        "Issue changed during assembly. Retry the current revision.",
        409,
      );
    }
    const concurrent = (await db.queryObject<Row>(
      "SELECT * FROM issue_renditions WHERE compiled_document_id=$1 AND fingerprint=$2 FOR UPDATE",
      [id, current.fingerprint],
    )).rows[0];
    // Another preparer may have repaired this revision while we were assembling.
    if (
      concurrent && includesForeword(current.parent, concurrent) &&
      await intactRendition(concurrent) &&
      (!existingIncludesForeword || concurrent.sha256 !== existing.sha256)
    ) return renditionDto(concurrent);
    const row = (await db.queryObject<Row>(
      `INSERT INTO issue_renditions(compiled_document_id,fingerprint,file_path,sha256,page_count,manifest)
      VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(compiled_document_id,fingerprint) DO UPDATE SET file_path=excluded.file_path,sha256=excluded.sha256,page_count=excluded.page_count,manifest=excluded.manifest,reviewed_by=NULL,reviewed_at=NULL RETURNING *`,
      [
        id,
        current.fingerprint,
        filePath,
        sha256,
        pages,
        JSON.stringify(manifest),
      ],
    )).rows[0];
    return renditionDto(row);
  });
}
export async function buildIssueRendition(
  current: { parent: Row; papers: Row[]; fingerprint: string },
  batch?: Row,
  targets?: Record<string, number>,
) {
  const collection = batch?.collection as ImportCollection | undefined;
  const sources: AssemblySource[] = [], parts: RecipePart[] = [];
  const append = async (
    path: string,
    role: string,
    firstPage?: number,
    lastPage?: number,
  ) => {
    const file = resolveStoredPdfPath(path);
    if (!file) {
      throw new ImportError(
        `${role}: PDF is unavailable. Prepare this component and retry.`,
        409,
      );
    }
    const sha256 = await digestFile(file);
    const assetId = `${role}-${sources.length}`;
    sources.push({ id: assetId, sha256, bytes: () => Deno.readFile(file) });
    parts.push({ assetId, included: true, role, firstPage, lastPage });
  };
  const p = current.parent;
  const appendForeword = async () => {
    await append(p.foreword, "Front matter");
    if (
      p.foreword_content_sha256 &&
      sources.at(-1)!.sha256 !== p.foreword_content_sha256
    ) throw new ImportError("Foreword PDF integrity check failed.", 409);
  };
  let sourceRanges: Row[] = [];
  if (batch && collection?.sourceArrangement === "complete_issue") {
    const plan = await validateBatchIssueRanges(batch.id);
    if (!plan) {
      throw new ImportError("Review the complete issue source arrangement.");
    }
    await retainImportSources(batch.id, [
      collection.mainAssetId!,
      collection.coverAssetId,
    ]);
    const main = (await client.queryObject<Row>(
      "SELECT * FROM import_assets WHERE id=$1 AND batch_id=$2",
      [collection.mainAssetId, batch.id],
    )).rows[0];
    const path = await checkedRetainedImportPath(main.retained_source_path);
    if (await digestFile(path) !== main.sha256) {
      throw new ImportError("Main issue integrity check failed.", 409);
    }
    const mainBytes = await Deno.readFile(path);
    const embeddedCovers = collection.coverAssetId === collection.mainAssetId;
    if (!embeddedCovers) {
      await append(
        p.cover_file_path,
        "Front cover",
        p.front_cover_page,
        p.front_cover_page,
      );
    }
    const forewordPage = p.foreword
      ? (embeddedCovers ? p.front_cover_page + 1 : 1)
      : null;
    const excluded = (collection.pageSections ?? []).filter((s) =>
      s.role === "excluded"
    );
    sourceRanges = (await client.queryObject<Row>(
      "SELECT id,document_id,page_mapping,final_sha256,metadata,recipe FROM import_items WHERE batch_id=$1 AND state<>'ignored' ORDER BY external_key,id",
      [batch.id],
    )).rows.map((item) => ({
      ...item,
      document_id: targets?.[item.id] ?? item.document_id,
    }));
    const replacements = plan.ranges.filter((range) => range.replacement);
    // Consecutive kept spans preserve editorial pages in their original order.
    for (let page = 1; page <= main.page_count;) {
      if (page === forewordPage) await appendForeword();
      const replacement = replacements.find((range) => range.first === page);
      if (replacement) {
        const item = sourceRanges.find((item) => item.id === replacement.id)!;
        const paper = current.papers.find((paper) =>
          paper.id === item.document_id
        );
        if (!paper) {
          throw new ImportError(
            "Save and review every replacement paper before issue assembly.",
            409,
          );
        }
        await append(paper.file_path, `Replacement paper ${paper.id}`);
        if (sources.at(-1)!.sha256 !== paper.content_sha256) {
          throw new ImportError(
            `${paper.title}: replacement PDF integrity check failed.`,
            409,
          );
        }
        page = replacement.last + 1;
        continue;
      }
      if (excluded.some((s) => page >= s.first && page <= s.last)) {
        page++;
        continue;
      }
      const first = page;
      while (
        page <= main.page_count &&
        (page === first || page !== forewordPage) &&
        !excluded.some((s) => page >= s.first && page <= s.last) &&
        !replacements.some((range) => range.first === page)
      ) page++;
      const assetId = `main-${first}`;
      sources.push({ id: assetId, sha256: main.sha256, bytes: mainBytes });
      parts.push({
        assetId,
        included: true,
        role: "Main issue",
        firstPage: first,
        lastPage: page - 1,
      });
    }
    if (forewordPage === main.page_count + 1) await appendForeword();
    if (!embeddedCovers) {
      await append(
        p.cover_file_path,
        "Back cover",
        p.back_cover_page,
        p.back_cover_page,
      );
    }
    if (
      sourceRanges.length !== current.papers.length ||
      current.papers.some((paper) =>
        !sourceRanges.some((item) =>
          item.document_id === paper.id &&
          item.final_sha256 === paper.content_sha256
        )
      )
    ) {
      throw new ImportError(
        "A saved paper changed. Reconcile the paper and main issue revision before assembly.",
        409,
      );
    }
  } else {
    if (p.cover_file_path) {
      await append(
        p.cover_file_path,
        "Front cover",
        p.front_cover_page,
        p.front_cover_page,
      );
    }
    if (p.foreword) await appendForeword();
    for (const paper of current.papers) {
      await append(paper.file_path, `Paper ${paper.id}`);
      if (
        paper.content_sha256 && sources.at(-1)!.sha256 !== paper.content_sha256
      ) {
        throw new ImportError(
          `${paper.title}: PDF integrity check failed.`,
          409,
        );
      }
    }
    if (p.cover_file_path) {
      await append(
        p.cover_file_path,
        "Back cover",
        p.back_cover_page,
        p.back_cover_page,
      );
    }
  }
  const assembled = await assembleImportPdf({ parts }, sources);
  for (const item of sourceRanges) {
    if (item.metadata.issueReplacementConfirmed) {
      const component = assembled.mapping.find((m) =>
        m.assetId.startsWith(`Replacement paper ${item.document_id}-`)
      );
      if (!component) {
        throw new ImportError("Replacement paper mapping is missing.", 409);
      }
      item.originalIssueRange = item.metadata.issueSourceRange;
      item.issueFirst = component.finalFirst;
      item.issueLast = component.finalLast;
      item.standaloneFirst = 1;
      item.standaloneLast = component.finalLast - component.finalFirst + 1;
      item.printedPageLabels = item.metadata.printedPageRange ?? null;
      continue;
    }
    const mapping = item.page_mapping[0];
    const component = assembled.mapping.find((m) =>
      m.assetId.startsWith("main-") && mapping.sourceFirst >= m.sourceFirst &&
      mapping.sourceLast <= m.sourceLast
    );
    if (!component) {
      throw new ImportError(
        "A paper crosses an excluded source section. Review its boundaries.",
        409,
      );
    }
    item.issueFirst = component.finalFirst + mapping.sourceFirst -
      component.sourceFirst;
    item.issueLast = component.finalFirst + mapping.sourceLast -
      component.sourceFirst;
    item.standaloneFirst = 1;
    item.standaloneLast = mapping.sourceLast - mapping.sourceFirst + 1;
    item.printedPageLabels = item.metadata.printedPageRange ?? null;
  }
  const sha256 = hash(assembled.bytes);
  const directory = resolve(STORAGE_ROOT, "imports");
  await Deno.mkdir(directory, { recursive: true });
  const name = `issue-${current.parent.id}-${sha256}.pdf`;
  const destination = resolve(directory, name);
  integrityChecks.delete(destination);
  // Atomic replacement also repairs a missing/corrupt copy with this same hash.
  // Readers never see a partially written output during recovery.
  const temporary = `${destination}.${crypto.randomUUID()}.part`;
  try {
    await Deno.writeFile(temporary, assembled.bytes, { createNew: true });
    if (await digestFile(temporary) !== sha256) {
      throw new ImportError(
        "Complete issue write integrity check failed.",
        409,
      );
    }
    await Deno.rename(temporary, destination);
  } finally {
    await Deno.remove(temporary).catch((error) => {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    });
  }
  const manifest = {
    revision: current.fingerprint,
    papers: current.papers,
    sourceRanges,
    components: assembled.mapping,
    pageSections: collection?.pageSections ?? [],
  };
  return {
    filePath: `storage/imports/${name}`,
    sha256,
    pages: assembled.pages,
    manifest,
  };
}

export function renditionDto(row: Row) {
  return {
    id: row.id,
    fingerprint: row.fingerprint,
    sha256: row.sha256,
    pages: row.page_count,
    manifest: row.manifest,
    reviewed: !!row.reviewed_at,
  };
}
export async function currentIssueRendition(id: number, reviewed = true) {
  const current = await issueCatalogSnapshot(id);
  const row = (await client.queryObject<Row>(
    "SELECT * FROM issue_renditions WHERE compiled_document_id=$1 AND fingerprint=$2 AND ($3=false OR reviewed_at IS NOT NULL)",
    [id, current.fingerprint, reviewed],
  )).rows[0];
  return row && includesForeword(current.parent, row) &&
      await intactRendition(row)
    ? row
    : null;
}
export async function reviewIssueRendition(
  id: number,
  fingerprint: string,
  actor: string,
) {
  const row = await currentIssueRendition(id, false);
  if (!row || row.fingerprint !== fingerprint) {
    throw new ImportError(
      "Issue changed. Prepare and review the current PDF.",
      409,
    );
  }
  const path = resolveStoredPdfPath(row.file_path);
  if (!path || await digestFile(path) !== row.sha256) {
    throw new ImportError("Complete issue integrity check failed.", 409);
  }
  await client.queryArray(
    "UPDATE issue_renditions SET reviewed_by=$2,reviewed_at=now() WHERE id=$1",
    [row.id, actor],
  );
}
export async function issueDownloadAvailable(id: number) {
  try {
    return !!await currentIssueRendition(id);
  } catch {
    return false;
  }
}
export async function publicIssueContext(documentId: number) {
  const parent = (await client.queryObject<Row>(
    `SELECT p.id,p.public_id,p.category,p.start_year,p.end_year,p.volume,p.issue_number,p.department
    FROM documents d JOIN compiled_documents p ON p.id=d.compiled_parent_id WHERE d.id=$1`,
    [documentId],
  )).rows[0];
  if (!parent || !await canViewCompilation(undefined, parent.id)) return null;
  return {
    id: parent.public_id || String(parent.id),
    label:
      `${parent.category} · ${parent.start_year}-${parent.end_year} · Vol. ${parent.volume}${
        parent.department
          ? ` · ${parent.department}`
          : parent.issue_number
          ? ` · No. ${parent.issue_number}`
          : ""
      }`,
  };
}
export async function paperPrintedPages(documentId: number) {
  const labels = (await client.queryObject<{ labels: unknown }>(
    "SELECT metadata->'printedPageRange' AS labels FROM import_provenance WHERE document_id=$1",
    [documentId],
  )).rows[0]?.labels as { first?: unknown; last?: unknown } | undefined;
  return labels && typeof labels.first === "string" &&
      typeof labels.last === "string" && labels.first.trim() &&
      labels.last.trim()
    ? { first: labels.first, last: labels.last }
    : null;
}
