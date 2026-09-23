import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { PDFDocument, StandardFonts } from "npm:pdf-lib@1.17.1";
import { unzipSync } from "npm:fflate@0.8.2";
import { client } from "../db/denopost_conn.ts";
import { pool } from "../config/db.ts";
import {
  createImportBatch,
  createImportItem,
  getImportBatch,
  queueImportJob,
  reviewImportItem,
  stageImportAsset,
  updateImportItem,
} from "../services/importPreparationService.ts";
import {
  claimImportJob,
  processImportJob,
  purgeAbandonedImportCopies,
  purgeExpiredImports,
  recoverImportJobs,
} from "../services/importWorkerService.ts";
import {
  commitImportBatch,
  commitImportItem,
  publishImportBatch,
  saveImportCollection,
} from "../services/importCommitService.ts";
import { exportImportSources } from "../services/importExportService.ts";
import {
  boundedCommand,
  convertWord,
  digestFile,
  stagingPath,
} from "../services/importStorageService.ts";
import {
  canViewCompilation,
  canViewDocument,
} from "../services/contentAuthorizationService.ts";
import {
  getVolumeMembershipReview,
  replaceVolumeContents,
  resolveVolumeMembership,
  volumeContents,
} from "../services/volumeContentsService.ts";
import {
  emptyImportMetadata,
  type ImportItem,
  type ImportMode,
} from "../../shared/imports.ts";
import { resolveStoredPdfPath } from "../services/abstractExtractionService.ts";
import { STORAGE_ROOT } from "../config/storage.ts";

if (
  Deno.env.get("DENO_ENV") !== "test" ||
  Deno.env.get("PGDATABASE") !== "peas_import_test" ||
  !Deno.env.get("IMPORT_STAGING_ROOT")?.includes("peas-import-test-")
) throw new Error("Only the isolated import test harness may run this suite");
const owner = "import-test-admin";
let author: string, topic: number;
async function syntheticPdf(count = 2) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < count; i++) {
    const p = pdf.addPage();
    p.drawText(`Synthetic manuscript ${i + 1}`, {
      x: 50,
      y: 790,
      font,
      size: 12,
    });
    p.drawText("ABSTRACT", { x: 50, y: 750, font, size: 12 });
    for (let n = 0; n < 12; n++) {
      p.drawText(
        "This research examines classroom learning and teaching methods in schools.",
        { x: 50, y: 730 - n * 15, font, size: 10 },
      );
    }
    p.drawText("Keywords: education, learning", {
      x: 50,
      y: 520,
      font,
      size: 10,
    });
  }
  return pdf.save();
}
function stream(bytes: Uint8Array) {
  return new Blob([bytes as BlobPart]).stream();
}
async function paper(mode: ImportMode = "batch", existingBatch?: string) {
  const batch = existingBatch
    ? await getImportBatch(existingBatch, owner)
    : await createImportBatch(owner, mode, crypto.randomUUID());
  const asset = await stageImportAsset(
    batch.id,
    owner,
    `synthetic/${crypto.randomUUID()}.pdf`,
    stream(await syntheticPdf()),
  );
  let item = await createImportItem(batch.id, owner, crypto.randomUUID(), {
    ...emptyImportMetadata(),
    title: "Synthetic reviewed manuscript",
    publicationDate: "2020",
    datePrecision: "year",
    authorIds: [author],
    topicIds: [topic],
  });
  item = await updateImportItem(batch.id, item.id, owner, {
    revision: item.revision,
    recipe: {
      parts: [{
        assetId: asset.id,
        included: true,
        role: "complete manuscript",
      }],
    },
  });
  return { batch, asset, item };
}
async function prepare(item: ImportItem) {
  await queueImportJob(item.batchId, item.id, owner, item.revision, "assemble");
  const job = await claimImportJob("integration-worker");
  assert(job);
  await processImportJob(job);
  return (await getImportBatch(item.batchId, owner)).items.find((i) =>
    i.id === item.id
  )!;
}
async function approve(item: ImportItem) {
  const batch = await getImportBatch(item.batchId, owner);
  return reviewImportItem(item.batchId, item.id, owner, {
    revision: item.revision,
    finalSha256: item.finalSha256!,
    metadataReviewed: true,
    layoutReviewed: true,
    componentHashes: Object.fromEntries(
      batch.assets.filter((a) =>
        item.recipe.parts.some((p) => p.assetId === a.id && p.included)
      ).map((a) => [a.id, a.previewSha256!]),
    ),
    abstractAction: "mark_unavailable",
  });
}

Deno.test({
  name: "Real PostgreSQL / storage / worker import acceptance",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async (t) => {
    try {
      await client.queryArray(
        "INSERT INTO users(id,email,name,role) VALUES($1,'import-test@example.invalid','Synthetic Administrator','admin')",
        [owner],
      );
      author = (await client.queryObject<{ id: string }>(
        "INSERT INTO authors(full_name,email,affiliation,department) VALUES('Synthetic Author','private@example.invalid','Private affiliation','Private department') RETURNING id",
      )).rows[0].id;
      topic = (await client.queryObject<{ id: number }>(
        "INSERT INTO topics(name,normalized_name,status) VALUES('Synthetic topic','synthetic topic','approved') RETURNING id",
      )).rows[0].id;
      await t.step(
        "P05: absent converter, disabled isolation, unqualified version and timeout give recoverable errors",
        async () => {
          const keys = [
            "IMPORT_CONVERTER_ISOLATED",
            "IMPORT_LIBREOFFICE_PATH",
            "IMPORT_LIBREOFFICE_VERSION",
          ];
          const saved = keys.map((key) => Deno.env.get(key));
          try {
            Deno.env.set(keys[0], "false");
            await assertRejects(
              () => convertWord("synthetic.docx", "unused"),
              Error,
              "disabled",
            );
            Deno.env.set(keys[0], "true");
            Deno.env.set(keys[1], "/nonexistent/peas-converter");
            await assertRejects(
              () => convertWord("synthetic.docx", "unused"),
              Error,
              "unavailable",
            );
            Deno.env.set(keys[1], Deno.execPath());
            Deno.env.set(keys[2], "impossible-qualified-version");
            await assertRejects(
              () => convertWord("synthetic.docx", "unused"),
              Error,
              "not qualified",
            );
            await assertRejects(
              () =>
                boundedCommand(Deno.execPath(), [
                  "eval",
                  "await new Promise((resolve)=>setTimeout(resolve,30000))",
                ], 100),
              Error,
              "timed out",
            );
          } finally {
            keys.forEach((key, i) =>
              saved[i] === undefined
                ? Deno.env.delete(key)
                : Deno.env.set(key, saved[i]!)
            );
          }
        },
      );
      await t.step(
        "V01/V02: migration deduplicates with audit, appends parent-only papers, and blocks conflicting primary parents",
        async () => {
          const migrated = (await client.queryObject<
            { id: number; contents_needs_resolution: boolean }
          >("SELECT id,contents_needs_resolution FROM compiled_documents WHERE volume=901"))
            .rows[0];
          const papers =
            (await client.queryObject<{ title: string; position: number }>(
              "SELECT d.title,c.position FROM compiled_document_items c JOIN documents d ON d.id=c.document_id WHERE c.compiled_document_id=$1 ORDER BY c.position",
              [migrated.id],
            )).rows;
          assertEquals(papers, [{ title: "Migration linked", position: 1 }, {
            title: "Migration parent only",
            position: 2,
          }]);
          assertEquals(
            (await client.queryObject(
              "SELECT id FROM compiled_membership_audit WHERE reason='duplicate_pair'",
            )).rows.length,
            1,
          );
          const conflicts = (await client.queryObject<
            { id: number; contents_needs_resolution: boolean }
          >("SELECT id,contents_needs_resolution FROM compiled_documents WHERE volume IN(902,903)"))
            .rows;
          assert(conflicts.every((p) => p.contents_needs_resolution));
          for (const p of conflicts) {
            await assertRejects(
              () => volumeContents(p.id, { id: owner, role: "admin" }),
              Error,
              "membership needs",
            );
          }
          const review = await getVolumeMembershipReview(conflicts[0].id);
          const assignments = review.papers.map((p) => ({
            paperId: p.id,
            parentId: p.primaryParent,
          }));
          await assertRejects(
            () =>
              resolveVolumeMembership(
                conflicts[0].id,
                review.collections.map((c) => ({
                  ...c,
                  revision: c.revision - 1,
                })),
                assignments,
                owner,
              ),
            Error,
            "changed",
          );
          await resolveVolumeMembership(
            conflicts[0].id,
            review.collections,
            assignments,
            owner,
          );
          for (const parent of conflicts) {
            await volumeContents(parent.id, { id: owner, role: "admin" });
          }
          const links =
            (await client.queryObject<{ compiled_document_id: number }>(
              "SELECT compiled_document_id FROM compiled_document_items WHERE document_id=$1",
              [assignments[0].paperId],
            )).rows;
          assertEquals(links.map((p) => p.compiled_document_id), [
            assignments[0].parentId,
          ]);
        },
      );
      await t.step(
        "I01/D01: completed file retry reuses immutable asset; mismatched source rejected",
        async () => {
          const { batch, asset } = await paper("single");
          const original = await Deno.readFile(
            stagingPath(batch.id, `${asset.id}.pdf`),
          );
          const again = await stageImportAsset(
            batch.id,
            owner,
            asset.relativePath,
            stream(original),
          );
          assertEquals(again.id, asset.id);
          await assertRejects(() =>
            stageImportAsset(
              batch.id,
              owner,
              asset.relativePath,
              stream(awaitableBytes),
            ), Error);
        },
      );
      await t.step(
        "R02/R03/R04/R05/R06/D04/P06: review gates, no staging records, simultaneous idempotent private commit, explicit publication",
        async () => {
          let { batch, asset, item } = await paper();
          const count = Number(
            (await client.queryObject<{ n: bigint }>(
              "SELECT count(*) AS n FROM documents",
            )).rows[0].n,
          );
          await assertRejects(() => commitImportItem(batch.id, item.id, owner));
          item = await updateImportItem(batch.id, item.id, owner, {
            revision: item.revision,
            metadata: {
              ...item.metadata,
              authorIds: [author.toUpperCase()],
            },
          });
          item = await prepare(item);
          assert(item.finalSha256);
          assertEquals(item.finalSha256, asset.sha256);
          assertEquals(
            Number(
              (await client.queryObject<{ n: bigint }>(
                "SELECT count(*) AS n FROM documents",
              )).rows[0].n,
            ),
            count,
          );
          item = await approve(item);
          const [first, second] = await Promise.all([
            commitImportItem(batch.id, item.id, owner),
            commitImportItem(batch.id, item.id, owner),
          ]);
          assertEquals(first, second);
          assertEquals(await canViewDocument(undefined, first), false);
          batch = await getImportBatch(batch.id, owner);
          await client.queryArray(
            "UPDATE documents SET title='Unreviewed catalog title' WHERE id=$1",
            [first],
          );
          await assertRejects(
            () => publishImportBatch(batch.id, owner, batch.revision),
            Error,
            "changed outside this workspace",
          );
          await client.queryArray(
            "UPDATE documents SET title=$2 WHERE id=$1",
            [first, item.metadata.title],
          );
          await client.queryArray(
            "DELETE FROM document_authors WHERE document_id=$1",
            [first],
          );
          await assertRejects(
            () => publishImportBatch(batch.id, owner, batch.revision),
            Error,
            "authors or classification changed",
          );
          await client.queryArray(
            "INSERT INTO document_authors(document_id,author_id,author_order) VALUES($1,$2,1)",
            [first, author],
          );
          assertEquals(await canViewDocument(undefined, first), false);
          await publishImportBatch(batch.id, owner, batch.revision);
          assertEquals(await canViewDocument(undefined, first), true);
          const record = (await client.queryObject<
            { publication_date_precision: string; document_type: string }
          >(
            "SELECT publication_date_precision,document_type FROM documents WHERE id=$1",
            [first],
          )).rows[0];
          assertEquals(record.publication_date_precision, "year");
          assertEquals(record.document_type, "THESIS");
          const other = await paper();
          await client.queryArray(
            "UPDATE import_items SET external_key=$2 WHERE id=$1",
            [other.item.id, item.externalKey],
          );
          let candidate = await prepare({
            ...other.item,
            externalKey: item.externalKey,
          });
          candidate = await approve(candidate);
          await assertRejects(
            () => commitImportItem(other.batch.id, candidate.id, owner),
            Error,
            "already belongs",
          );
        },
      );
      await t.step(
        "D02/D03/R03: dead worker recovery and superseded output cannot approve a newer recipe",
        async () => {
          let { batch, item } = await paper();
          await queueImportJob(
            batch.id,
            item.id,
            owner,
            item.revision,
            "assemble",
          );
          const job = await claimImportJob("dead-worker");
          assert(job);
          await client.queryArray(
            "UPDATE import_jobs SET heartbeat_at=now()-interval '3 minutes' WHERE id=$1",
            [job.id],
          );
          await recoverImportJobs();
          const replacement = await claimImportJob("replacement-worker");
          assert(replacement);
          assert(replacement.lease_token !== job.lease_token);
          item = await updateImportItem(batch.id, item.id, owner, {
            revision: item.revision,
            recipe: {
              parts: item.recipe.parts.map((p) => ({ ...p, lastPage: 1 })),
            },
          });
          await processImportJob(job);
          await processImportJob(replacement);
          assertEquals(
            (await getImportBatch(batch.id, owner)).items[0].finalSha256,
            null,
          );
          item = await prepare(item);
          item = await approve(item);
          const previous = item;
          item = await updateImportItem(batch.id, item.id, owner, {
            revision: item.revision,
            metadata: { ...item.metadata, title: "Corrected title" },
          });
          assertEquals(item.finalSha256, previous.finalSha256);
          assertEquals(item.review.metadataRevision, undefined);
          await assertRejects(() => commitImportItem(batch.id, item.id, owner));
        },
      );
      await t.step(
        "D05/D06/D07: forced authorship failure rolls back every record; per-paper results retain successful commits",
        async () => {
          const { batch, item } = await paper();
          const ready = await approve(await prepare(item));
          await client.queryArray(
            "CREATE FUNCTION reject_import_author() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic failure'; END $$; CREATE TRIGGER reject_import_author BEFORE INSERT ON document_authors FOR EACH ROW EXECUTE FUNCTION reject_import_author();",
          );
          try {
            await assertRejects(() =>
              commitImportItem(batch.id, ready.id, owner)
            );
            assertEquals(
              (await client.queryObject(
                "SELECT id FROM documents WHERE file_path LIKE $1",
                [`%${item.id}%`],
              )).rows.length,
              0,
            );
          } finally {
            await client.queryArray(
              "DROP TRIGGER reject_import_author ON document_authors; DROP FUNCTION reject_import_author();",
            );
          }
          const incomplete = await createImportItem(
            batch.id,
            owner,
            crypto.randomUUID(),
          );
          const results = await commitImportBatch(batch.id, owner, [
            ready.id,
            incomplete.id,
          ]);
          assert(results[0].documentId);
          assert(results[1].error);
        },
      );
      await t.step(
        "R07/V02/V03/V09: compiled pending parent, atomic publication, ordered membership and public allowlist",
        async () => {
          let { batch, item } = await paper("compiled");
          const cover = await stageImportAsset(
            batch.id,
            owner,
            "covers.pdf",
            stream(await syntheticPdf()),
          );
          batch = await getImportBatch(batch.id, owner);
          await saveImportCollection(batch.id, owner, batch.revision, {
            category: "CONFLUENCE",
            startYear: 2020,
            endYear: 2021,
            volume: 1,
            issue: 1,
            department: "Synthetic",
            coverAssetId: cover.id,
            frontPage: 1,
            backPage: 2,
            reviewed: true,
          });
          item = await approve(await prepare(item));
          const first = await commitImportItem(batch.id, item.id, owner);
          batch = await getImportBatch(batch.id, owner);
          assert(batch.compiledDocumentId);
          assertEquals(
            await canViewCompilation(undefined, batch.compiledDocumentId),
            false,
          );
          const secondPaper = await paper("compiled", batch.id);
          await assertRejects(async () =>
            publishImportBatch(
              batch.id,
              owner,
              (await getImportBatch(batch.id, owner)).revision,
            )
          );
          const second = await commitImportItem(
            batch.id,
            (await approve(await prepare(secondPaper.item))).id,
            owner,
          );
          batch = await getImportBatch(batch.id, owner);
          await client.queryArray(
            "UPDATE compiled_documents SET category='SYNERGY' WHERE id=$1",
            [batch.compiledDocumentId],
          );
          await assertRejects(
            () => publishImportBatch(batch.id, owner, batch.revision),
            Error,
            "Collection membership or review status changed",
          );
          await client.queryArray(
            "UPDATE compiled_documents SET category='CONFLUENCE' WHERE id=$1",
            [batch.compiledDocumentId],
          );
          await publishImportBatch(batch.id, owner, batch.revision);
          let contents = await volumeContents(batch.compiledDocumentId!);
          assertEquals(contents.papers.map((p) => p.id), [first, second]);
          assertEquals(contents.papers[0].publicationDate, "2020-01-01");
          assertEquals(Object.keys(contents.papers[0].authors[0]).sort(), [
            "full_name",
            "id",
          ]);
          assert(!JSON.stringify(contents).includes("private@example"));
          await replaceVolumeContents(
            batch.compiledDocumentId!,
            contents.revision,
            [second, first],
            owner,
          );
          await assertRejects(
            () =>
              replaceVolumeContents(
                batch.compiledDocumentId!,
                contents.revision,
                [first, second],
                owner,
              ),
            Error,
            "changed",
          );
          contents = await volumeContents(batch.compiledDocumentId!);
          assertEquals(contents.papers.map((p) => p.id), [second, first]);
          await client.queryArray(
            "UPDATE documents SET is_public=false WHERE id=$1",
            [first],
          );
          assertEquals(
            (await volumeContents(batch.compiledDocumentId!)).papers.map((p) =>
              p.id
            ),
            [second],
          );
          await client.queryArray(
            "DELETE FROM compiled_document_items WHERE document_id=$1",
            [second],
          );
          assertEquals(
            (await client.queryObject<{ compiled_parent_id: null }>(
              "SELECT compiled_parent_id FROM documents WHERE id=$1",
              [second],
            )).rows[0].compiled_parent_id,
            null,
          );
        },
      );
      await t.step(
        "E01/E03/E04/E05: ZIP source hashes, live lease protection and timed cleanup preserve final PDFs and provenance",
        async () => {
          let { batch, item, asset } = await paper();
          item = await approve(await prepare(item));
          const documentId = await commitImportItem(batch.id, item.id, owner);
          batch = await getImportBatch(batch.id, owner);
          await publishImportBatch(batch.id, owner, batch.revision);
          const archive = await exportImportSources(batch.id, owner);
          const entries = unzipSync(
            await Deno.readFile(stagingPath(batch.id, `${archive.id}.zip`)),
          );
          const manifest = JSON.parse(
            new TextDecoder().decode(entries["manifest.json"]),
          );
          assertEquals(manifest.assets[0].sha256, asset.sha256);
          assertEquals(
            entries[`originals/${asset.relativePath}`],
            await Deno.readFile(stagingPath(batch.id, `${asset.id}.pdf`)),
          );
          await client.queryArray(
            "UPDATE import_batches SET expires_at=now()-interval '1 day' WHERE id=$1",
            [batch.id],
          );
          await client.queryArray(
            "UPDATE import_jobs SET status='processing',heartbeat_at=now() WHERE item_id=$1",
            [item.id],
          );
          await purgeExpiredImports();
          assertEquals(
            (await getImportBatch(batch.id, owner)).status,
            "published",
          );
          await client.queryArray(
            "UPDATE import_jobs SET status='done' WHERE item_id=$1",
            [item.id],
          );
          await purgeExpiredImports();
          assertEquals(
            (await getImportBatch(batch.id, owner)).status,
            "expired",
          );
          await assertRejects(() => Deno.stat(stagingPath(batch.id)));
          const document = (await client.queryObject<{ file_path: string }>(
            "SELECT file_path FROM documents WHERE id=$1",
            [documentId],
          )).rows[0];
          assertEquals(
            await digestFile(resolveStoredPdfPath(document.file_path)!),
            asset.sha256,
          );
          const orphan = `${STORAGE_ROOT}/imports/${item.id}-${
            "0".repeat(64)
          }.pdf`;
          await Deno.writeTextFile(orphan, "abandoned synthetic copy");
          const old = new Date(Date.now() - 2 * 86_400_000);
          await Deno.utime(orphan, old, old);
          await Deno.utime(resolveStoredPdfPath(document.file_path)!, old, old);
          assert(await purgeAbandonedImportCopies() >= 1);
          await assertRejects(() => Deno.stat(orphan));
          assertEquals(
            await digestFile(resolveStoredPdfPath(document.file_path)!),
            asset.sha256,
          );
          assertEquals(
            (await client.queryObject(
              "SELECT * FROM import_provenance WHERE document_id=$1",
              [documentId],
            )).rows.length,
            1,
          );
          await client.queryArray("DELETE FROM documents WHERE id=$1", [
            documentId,
          ]);
          assertEquals(
            (await getImportBatch(batch.id, owner)).items.find((i) =>
              i.id === item.id
            )?.state,
            "ignored",
          );
          assertEquals(
            (await client.queryObject(
              "SELECT 1 FROM import_provenance WHERE document_id=$1",
              [documentId],
            )).rows.length,
            0,
          );
          await purgeAbandonedImportCopies();
          await assertRejects(
            () =>
              Deno.stat(
                `${STORAGE_ROOT}/${
                  document.file_path.replace(/^storage\//, "")
                }`,
              ),
            Deno.errors.NotFound,
          );
        },
      );
    } finally {
      await pool.end();
    }
  },
});
const awaitableBytes = new TextEncoder().encode("%PDF-broken replacement");
