import { UserLibraryModel } from "../models/userLibraryModel.ts";
import { createDocument, updateDocument } from "../controllers/documentController.ts";
import { startAbstractWorker, failAbstractJob } from "../services/abstractExtractionWorkerService.ts";
import { getAbstractWorkerDiagnostics, retryAbstractReview, AbstractWorkerUnavailableError, applyAbstractReview } from "../services/abstractReviewService.ts";
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
  listImportBatches,
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
import { prepareUpload,getUploadJob,saveUploadReview,bindUploadReview,uploadPublicationHold,uploadAsset,retryUploadJob,bindCompiledUploadReviews,compiledUploadPublicationHold } from "../services/uploadReviewService.ts";
import { emptyUploadReview } from "../../shared/uploadReview.ts";
import { currentIssueRendition, prepareIssueRendition, reviewIssueRendition } from "../services/issueRenditionService.ts";
import { fetchDocuments } from "../services/documentService.ts";
import { prepareIssueRevision, publishIssueRevision, reviewIssueRevision, startIssueRevision } from "../services/issueRevisionService.ts";

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
      await t.step("Retained upload reviews enforce ownership, duplicate reuse, manifests and publication holds",async()=>{
        const bytes=await syntheticPdf(2),id=crypto.randomUUID();
        const options={documentType:"THESIS",storagePath:"storage/thesis",uploaderHash:"synthetic"};
        const job=await prepareUpload(id,owner,[{name:"first.pdf",content:bytes},{name:"second.pdf",content:bytes}],options);
        assertEquals(job.state,"ready",job.error||"");
        assertEquals(job.result?.metadata.pageCount,4);
        assertEquals(job.components.map(c=>[c.firstPage,c.lastPage]),[[1,2],[3,4]]);
        const duplicate=await prepareUpload(crypto.randomUUID(),owner,[{name:"first.pdf",content:bytes},{name:"second.pdf",content:bytes}],options);
        assertEquals(duplicate.id,id);
        await assertRejects(()=>getUploadJob(id,"another-owner"),Error,"not found");
        assertEquals((await uploadAsset(id,owner,"0.source")).bytes,bytes);
        const manifest=JSON.parse(new TextDecoder().decode((await uploadAsset(id,owner,"manifest")).bytes));
        assertEquals(manifest.components.length,2);
        assertEquals(manifest.finalSha256,job.result?.metadata.sha256);
        const created=await createDocument(new Request("http://localhost/documents",{method:"POST",body:JSON.stringify({title:"Upload review fixture",document_type:"THESIS",publication_date:"2027-01-01",publication_date_precision:"month",abstract:"Manually confirmed.",file_path:job.result!.filePath,is_public:false,review_status:"pending_review",uploaded_by:owner,classification:{topicIds:[topic],keywords:[]}})}));
        const record=await created.json();assertEquals(created.status,201,JSON.stringify(record));
        await bindUploadReview(id,owner,record.id,job.result!.filePath);
        await client.queryArray("INSERT INTO abstract_extraction_jobs(target_type,document_id,status,method,candidate_text,confidence,quality_flags,page_start,page_end) VALUES('document',$1,'needs_review','pdf_text','Original two-page candidate',0.8,'[\"abrupt_ending\"]',2,3)",[record.id]);
        const corrected=await applyAbstractReview("document",record.id,"save_manual",owner,"Administrator-corrected complete abstract.");
        assertEquals(corrected.method,"manual");
        assertEquals(corrected.originalExtraction?.method,"pdf_text");
        assertEquals(corrected.originalExtraction?.candidate,"Original two-page candidate");
        assertEquals(corrected.originalExtraction?.pageEnd,3);
        assertEquals(corrected.originalExtraction?.qualityFlags,["abrupt_ending"]);
        assert(await uploadPublicationHold(record.id));
        await assertRejects(()=>client.queryArray("UPDATE documents SET is_public=TRUE,review_status='approved' WHERE id=$1",[record.id]),Error,"Resolve the manuscript");
        await saveUploadReview(id,owner,{...emptyUploadReview(),completeness:"complete",layoutReviewed:true,holdReason:"Missing approval letter"});
        assertEquals(await uploadPublicationHold(record.id),"Missing approval letter");
        await saveUploadReview(id,owner,{...emptyUploadReview(),completeness:"complete",layoutReviewed:true});
        assertEquals(await uploadPublicationHold(record.id),null);
        await client.queryArray("UPDATE documents SET is_public=TRUE,review_status='approved' WHERE id=$1",[record.id]);
        await assertRejects(()=>retryUploadJob(id,owner),Error,"already ready");
        const coverOptions={documentType:"CONFLUENCE",storagePath:"storage/confluence/covers",uploaderHash:"synthetic",reviewContext:"first-volume"};
        const cover=await prepareUpload(crypto.randomUUID(),owner,[{name:"cover.pdf",content:bytes}],coverOptions);
        const anotherCover=await prepareUpload(crypto.randomUUID(),owner,[{name:"cover.pdf",content:bytes}],{...coverOptions,reviewContext:"second-volume"});
        assert(cover.id!==anotherCover.id,"A common cover must remain reusable across distinct publications");
        const parent=(await client.queryObject<{id:number}>("INSERT INTO compiled_documents(category,start_year,end_year,volume,issue_number,review_status,cover_file_path,cover_page_count,front_cover_page,back_cover_page) VALUES('CONFLUENCE',2026,2026,99,1,'pending_review',$1,2,1,2) RETURNING id",[cover.result!.filePath])).rows[0].id;
        await bindCompiledUploadReviews([cover.id],owner,parent);
        assert(await compiledUploadPublicationHold(parent));
        await assertRejects(()=>client.queryArray("UPDATE compiled_documents SET review_status='approved' WHERE id=$1",[parent]),Error,"Resolve the publication");
        await saveUploadReview(cover.id,owner,{...emptyUploadReview(),completeness:"complete",layoutReviewed:true});
        assertEquals(await compiledUploadPublicationHold(parent),null);
        await client.queryArray("UPDATE compiled_documents SET cover_file_path='storage/confluence/changed.pdf' WHERE id=$1",[parent]);
        assert((await compiledUploadPublicationHold(parent))?.includes("changed"));
        await client.queryArray("DELETE FROM compiled_documents WHERE id=$1",[parent]);
      });
      await t.step("Ordinary document create/edit retains private month precision", async () => {
        const result = await createDocument(new Request("http://localhost/documents", { method: "POST", body: JSON.stringify({ title: "Month precision fixture", document_type: "DISSERTATION", publication_date: "2021-05-01", publication_date_precision: "month", abstract: "A synthetic manually reviewed abstract.", file_path: "storage/dissertation/synthetic.pdf", is_public: false, review_status: "pending_review", uploaded_by: owner, classificationActorRole: "admin", authors: [{ id: author, full_name: "Synthetic Author" }], classification: { topicIds: [topic], keywords: [] } }) }));
        const record = await result.json();
        assertEquals(result.status, 201, JSON.stringify(record));
        assertEquals(record.publication_date_precision, "month");
        assertEquals(record.is_public, false);
        assertEquals(record.review_status, "pending_review");
        const edit = await updateDocument(new Request(`http://localhost/documents/${record.id}`, { method: "PUT", body: JSON.stringify({ title: "Updated title" }) }));
        assertEquals(edit.status, 200);
        assertEquals((await edit.json()).publication_date_precision, "month");
        const invalid = await updateDocument(new Request(`http://localhost/documents/${record.id}`, { method: "PUT", body: JSON.stringify({ publication_date: "2021-05-23", publication_date_precision: "month" }) }));
        assertEquals(invalid.status, 422);
        await UserLibraryModel.addToLibrary(owner, record.id);
        const privateLibrary = await UserLibraryModel.getUserLibrary(owner);
        assertEquals(privateLibrary.items[0].publication_date_precision, "legacy");
        await client.queryArray("UPDATE documents SET review_status='approved',is_public=TRUE WHERE id=$1", [record.id]);
        const publicLibrary = await UserLibraryModel.getUserLibrary(owner);
        assertEquals(publicLibrary.items[0].publication_date_precision, "month");
        await client.queryArray("DELETE FROM documents WHERE id=$1", [record.id]);
      });
      await t.step("Unavailable extraction dependencies preserve queued records and retry budgets", async () => {
        const id = (await client.queryObject<{ id: number }>("INSERT INTO documents(title,document_type,file_path,is_public,review_status) VALUES('Dependency fixture','THESIS','storage/thesis/fixture.pdf',FALSE,'pending_review') RETURNING id")).rows[0].id;
        const jobId = (await client.queryObject<{ id: number }>("INSERT INTO abstract_extraction_jobs(target_type,document_id) VALUES('document',$1) RETURNING id", [id])).rows[0].id;
        await client.queryArray("INSERT INTO abstract_extraction_worker_state(state_id) VALUES(TRUE) ON CONFLICT DO NOTHING");
        const oldPath = Deno.env.get("ABSTRACT_OCR_LANGUAGES");
        let stop: (() => void) | undefined;
        try {
          Deno.env.set("ABSTRACT_OCR_LANGUAGES", "unavailable-test-language");
          stop = await startAbstractWorker();
          let ready = false;
          for (let i = 0; i < 100; i++) {
            const state = await getAbstractWorkerDiagnostics();
            if (state.workerAvailable && state.checkedAt) { ready = true; break; }
            await new Promise((resolve) => setTimeout(resolve, 20));
          }
          assert(ready, "The worker must report failed dependency checks");
          assertEquals((await getAbstractWorkerDiagnostics()).extractionReady, false);
          const queued = (await client.queryObject<{ status: string; attempt_count: number }>("SELECT status,attempt_count FROM abstract_extraction_jobs WHERE id=$1", [jobId])).rows[0];
          assertEquals(queued, { status: "queued", attempt_count: 0 });
          await assertRejects(() => retryAbstractReview("document", id), AbstractWorkerUnavailableError);
        } finally {
          stop?.();
          if (oldPath === undefined) Deno.env.delete("ABSTRACT_OCR_LANGUAGES"); else Deno.env.set("ABSTRACT_OCR_LANGUAGES", oldPath);
        }
        await client.queryArray("UPDATE abstract_extraction_jobs SET status='processing',attempt_count=1 WHERE id=$1", [jobId]);
        const job = { id: jobId, target_type: "document" as const, document_id: id, compiled_document_id: null, attempt_count: 1 };
        await failAbstractJob(job, "ABSTRACT_TIMEOUT");
        assertEquals((await client.queryObject<{ status: string }>("SELECT status FROM abstract_extraction_jobs WHERE id=$1", [jobId])).rows[0].status, "queued");
        await client.queryArray("UPDATE abstract_extraction_jobs SET status='processing' WHERE id=$1", [jobId]);
        await failAbstractJob(job, "PDFINFO_UNAVAILABLE");
        assertEquals((await client.queryObject<{ status: string }>("SELECT status FROM abstract_extraction_jobs WHERE id=$1", [jobId])).rows[0].status, "failed");
        assertEquals((await client.queryObject<{ is_public: boolean }>("SELECT is_public FROM documents WHERE id=$1", [id])).rows[0].is_public, false);
        await client.queryArray("DELETE FROM documents WHERE id=$1", [id]);
      });
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
              Deno.build.os === "windows" ? "qualified" : "unavailable",
            );
            Deno.env.set(keys[1], Deno.execPath());
            Deno.env.set(keys[2], "impossible-qualified-version");
            await assertRejects(
              () => convertWord("synthetic.docx", "unused"),
              Error,
              "qualified",
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
      await t.step("Metadata editing while preparing preserves the job state and entered fields", async () => {
        const {batch,item}=await paper();
        await queueImportJob(batch.id,item.id,owner,item.revision,"assemble");
        const pending=(await getImportBatch(batch.id,owner)).items[0];
        const edited=await updateImportItem(batch.id,item.id,owner,{revision:pending.revision,metadata:{...pending.metadata,title:"Metadata entered while preparation runs"}});
        assertEquals(edited.state,"preparing");
        const job=await claimImportJob("metadata-preparation-worker");assert(job);assertEquals(job.item_id,item.id);
        await processImportJob(job);
        const completed=(await getImportBatch(batch.id,owner)).items[0];
        assertEquals(completed.metadata.title,"Metadata entered while preparation runs");
        assertEquals(completed.metadataRevision,edited.metadataRevision);
        assertEquals(completed.recipeRevision,edited.recipeRevision);
        assertEquals(completed.state,"needs_review");assert(completed.finalSha256);
        assertEquals(completed.abstractDiagnostics?.sourceSha256,completed.finalSha256);
        const reviewed=await approve(completed);
        assertEquals(reviewed.review.extractionSnapshot?.candidate,completed.abstractCandidate);
        assertEquals(reviewed.review.extractionSnapshot?.diagnostics.sourceSha256,completed.finalSha256);
      });
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
            "Prepare and review the complete issue PDF",
          );
          await client.queryArray(
            "UPDATE compiled_documents SET category='CONFLUENCE' WHERE id=$1",
            [batch.compiledDocumentId],
          );
          const complete = await prepareIssueRendition(batch.compiledDocumentId!);
          assertEquals(complete.pages, 6);
          await reviewIssueRendition(batch.compiledDocumentId!, complete.fingerprint, owner);
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
          assertEquals(await canViewCompilation(undefined, batch.compiledDocumentId), false);
          await assertRejects(() => volumeContents(batch.compiledDocumentId!));
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
      await t.step("Retest F01: reviewed separate-paper order survives discovery order, commit retries, reader and manifest", async () => {
        let { batch, item } = await paper("compiled");
        const items = [item];
        for (let i = 1; i < 5; i++) items.push((await paper("compiled", batch.id)).item);
        const editorialOrder = [items[4], items[3], items[0], items[1], items[2]].map(paper => paper.id);
        const cover = await stageImportAsset(batch.id, owner, "separate-covers.pdf", stream(await syntheticPdf()));
        batch = await getImportBatch(batch.id, owner);
        await saveImportCollection(batch.id, owner, batch.revision, {
          category: "SYNERGY", startYear: 2022, endYear: 2023, volume: 7, issue: null,
          department: "CASE", coverAssetId: cover.id, frontPage: 1, backPage: 2,
          reviewed: true, sourceArrangement: "separate_papers", paperOrder: editorialOrder,
        });
        const committed = new Map<string, number>();
        for (const item of items) {
          const ready = await approve(await prepare(item));
          const documentId = await commitImportItem(batch.id, ready.id, owner);
          committed.set(item.id, documentId);
          assertEquals(await commitImportItem(batch.id, ready.id, owner), documentId);
        }
        batch = await getImportBatch(batch.id, owner);
        const expected = editorialOrder.map(id => committed.get(id)!);
        const contents = await volumeContents(batch.compiledDocumentId!, { id: owner, role: "admin" });
        assertEquals(contents.papers.map(paper => paper.id), expected);
        const complete = await prepareIssueRendition(batch.compiledDocumentId!);
        assertEquals(complete.manifest.papers.map((paper: { id: number }) => Number(paper.id)), expected);
        assertEquals(complete.pages, 12);
        assertEquals(complete.manifest.components.filter((part: { assetId: string }) => part.assetId.startsWith("Paper ")).map((part: { assetId: string }) => Number(part.assetId.match(/^Paper (\d+)-/)![1])), expected);
      });
      await t.step("Consolidated evidence: two reversed-discovery QA papers retain reviewed positions through batch commit", async () => {
        const batch = await createImportBatch(owner, "compiled", crypto.randomUUID());
        const items: ImportItem[] = [];
        for (const [number, pages] of [[2, 22], [1, 18]]) {
          const asset = await stageImportAsset(batch.id, owner, `QA-fixture-${number}.pdf`, stream(await syntheticPdf(pages)));
          let item = await createImportItem(batch.id, owner, crypto.randomUUID(), {
            ...emptyImportMetadata(), title: `QA fixture ${number} - not for publication`,
            documentType: "SYNERGY", publicationDate: "2026", datePrecision: "year",
            authorIds: [author], topicIds: [topic],
          });
          item = await updateImportItem(batch.id, item.id, owner, { revision: item.revision, recipe: { parts: [{ assetId: asset.id, included: true, role: "QA paper" }] } });
          items.push(await approve(await prepare(item)));
        }
        const covers = await stageImportAsset(batch.id, owner, "QA-covers.pdf", stream(await syntheticPdf(2)));
        await saveImportCollection(batch.id, owner, (await getImportBatch(batch.id, owner)).revision, {
          category: "SYNERGY", startYear: 2026, endYear: 2026, volume: 999, issue: null,
          department: "Private QA", coverAssetId: covers.id, frontPage: 1, backPage: 2,
          reviewed: true, sourceArrangement: "separate_papers", paperOrder: [items[1].id, items[0].id],
        });
        await commitImportItem(batch.id, items[0].id, owner);
        const partial = (await listImportBatches(owner)).find(row => row.id === batch.id)!;
        assertEquals([partial.committedPapers, partial.includedPapers], [1, 2]);
        const results = await commitImportBatch(batch.id, owner, items.map(item => item.id));
        assert(results.every(result => result.documentId), JSON.stringify(results));
        const expected = [results[1].documentId!, results[0].documentId!];
        const parent = (await getImportBatch(batch.id, owner)).compiledDocumentId!;
        assertEquals((await volumeContents(parent, { id: owner, role: "admin" })).papers.map(paper => paper.id), expected);
        const output = await prepareIssueRendition(parent);
        assertEquals(output.pages, 42);
        assertEquals(output.manifest.papers.map((paper: { id: number }) => Number(paper.id)), expected);
        assertEquals(output.manifest.components.filter((part: { assetId: string }) => part.assetId.startsWith("Paper ")).map((part: { finalFirst: number; finalLast: number }) => [part.finalFirst, part.finalLast]), [[2, 19], [20, 41]]);
        assertEquals(await commitImportBatch(batch.id, owner, items.map(item => item.id)), results);
        const summary = (await listImportBatches(owner)).find(row => row.id === batch.id)!;
        assertEquals([summary.committedPapers, summary.includedPapers], [2, 2]);
        assertEquals(await canViewCompilation(undefined, parent), false);
        assertEquals(await currentIssueRendition(parent), null);
      });
      await t.step("Complete issue ranges: private extraction, idempotent assembly, stale revision and holds", async () => {
        const batch = await createImportBatch(owner, "compiled", crypto.randomUUID());
        await saveImportCollection(batch.id, owner, batch.revision, { category: "SYNERGY", startYear: 0, endYear: 0, volume: 0, issue: null, department: "Unfinished editorial metadata", coverAssetId: "", frontPage: 1, backPage: 2, reviewed: false, sourceArrangement: "complete_issue" });
        assertEquals((await getImportBatch(batch.id, owner)).collection?.department, "Unfinished editorial metadata");
        assertEquals((await getImportBatch(batch.id, owner)).compiledDocumentId, null);
        const main = await stageImportAsset(batch.id, owner, "issue.pdf", stream(await syntheticPdf(8)));
        const covers = await stageImportAsset(batch.id, owner, "covers.pdf", stream(await syntheticPdf(2)));
        await saveImportCollection(batch.id, owner, (await getImportBatch(batch.id, owner)).revision, {
          category: "SYNERGY", startYear: 2022, endYear: 2023, volume: 7, issue: null, department: "CASE",
          coverAssetId: covers.id, frontPage: 1, backPage: 2, reviewed: true,
          sourceArrangement: "complete_issue", mainAssetId: main.id, pageSections: [{ first: 1, last: 2, role: "front_matter" }],
        });
        const items: ImportItem[] = [];
        for (const [index, [first, last]] of [[3, 5], [6, 8]].entries()) {
          let item = await createImportItem(batch.id, owner, `issue:${batch.id}:${index}`, { ...emptyImportMetadata(), title: `Issue paper ${index + 1}`, publicationDate: "2023", documentType: "SYNERGY", authorIds: [author], topicIds: [topic] });
          item = await updateImportItem(batch.id, item.id, owner, { revision: item.revision, recipe: { parts: [{ assetId: main.id, included: true, role: "Paper", firstPage: first, lastPage: last }] } });
          items.push(await approve(await prepare(item)));
        }
        const ids: number[] = [];
        for (const item of items) ids.push(await commitImportItem(batch.id, item.id, owner));
        let current = await getImportBatch(batch.id, owner);
        assert(current.compiledDocumentId);
        assertEquals(await canViewDocument(undefined, ids[0]), false);
        const output = await prepareIssueRendition(current.compiledDocumentId);
        assertEquals(output.pages, 10);
        assertEquals(output.manifest.sourceRanges.map((range: any) => [range.issueFirst, range.issueLast, range.standaloneFirst, range.standaloneLast]), [[4,6,1,3],[7,9,1,3]]);
        assertEquals((await prepareIssueRendition(current.compiledDocumentId)).id, output.id);
        assertEquals(await currentIssueRendition(current.compiledDocumentId!), null);
        await assertRejects(() => publishImportBatch(batch.id, owner, current.revision), Error, "complete issue");
        await reviewIssueRendition(current.compiledDocumentId, output.fingerprint, owner);
        const prepared = await currentIssueRendition(current.compiledDocumentId);
        assert(prepared);
        const preparedPath = resolveStoredPdfPath(prepared.file_path)!;
        await Deno.writeTextFile(preparedPath, "%PDF-damaged-output");
        assertEquals(await currentIssueRendition(current.compiledDocumentId), null);
        await assertRejects(() => publishImportBatch(batch.id, owner, current.revision), Error, "complete issue");
        const repaired = await prepareIssueRendition(current.compiledDocumentId);
        assertEquals(repaired.id, output.id);
        assertEquals(repaired.pages, 10);
        assertEquals(repaired.reviewed, false);
        await reviewIssueRendition(current.compiledDocumentId, repaired.fingerprint, owner);
        assertEquals(await commitImportItem(batch.id, items[0].id, owner), ids[0]);
        current = await getImportBatch(batch.id, owner);
        await publishImportBatch(batch.id, owner, current.revision);
        assertEquals(await canViewCompilation(undefined, current.compiledDocumentId), true);
        for (const search of ["SYNERGY", "2022-2023", "Vol. 7", "CASE"]) {
          const found = await fetchDocuments({ search, publicOnly: true });
          assert(found.documents.some(d=>d.is_compiled&&d.id===current.compiledDocumentId), `Issue identity search failed: ${search}`);
          assert(found.documents.some(d=>!d.is_compiled&&d.id===ids[0]), `Paper issue context search failed: ${search}`);
        }
        await client.queryArray("UPDATE import_batches SET expires_at=now()-interval '1 day' WHERE id=$1", [batch.id]);
        await purgeExpiredImports();
        const retained = (await client.queryObject<Record<string, any>>("SELECT retained_preview_path FROM import_assets WHERE id=$1", [main.id])).rows[0].retained_preview_path;
        assert(retained);
        const published = await currentIssueRendition(current.compiledDocumentId!);
        assert(published);
        await Deno.remove(resolveStoredPdfPath(published.file_path)!);
        const recovered = await prepareIssueRendition(current.compiledDocumentId!);
        assertEquals(recovered.id, output.id);
        assertEquals(recovered.pages, 10);
        assertEquals(recovered.reviewed, false);
        assertEquals((await client.queryObject<Record<string, any>>("SELECT retained_preview_path FROM import_assets WHERE id=$1", [main.id])).rows[0].retained_preview_path, retained);
        await reviewIssueRendition(current.compiledDocumentId!, recovered.fingerprint, owner);
        const results = await fetchDocuments({ search: "Issue paper 1", publicOnly: true });
        assert(results.documents.some(d => d.id === ids[0] && !d.is_compiled));
        assertEquals(results.paperCount, 1);
        assert(results.documents.find(d => d.id === ids[0] && !d.is_compiled)?.parent_issue?.label.includes("CASE"));
        const heldNotes = { ...emptyUploadReview(), completeness: "complete", layoutReviewed: true, holdReason: "Editorial hold" };
        await client.queryArray("UPDATE import_items SET metadata=jsonb_set(metadata,'{reviewNotes}',$2::jsonb) WHERE id=$1", [items[0].id, JSON.stringify(heldNotes)]);
        assertEquals(await canViewCompilation(undefined, current.compiledDocumentId), false);
        assertEquals((await fetchDocuments({ search: "Issue paper 1", publicOnly: true })).documents.length, 0);
        await client.queryArray("UPDATE documents SET title='Changed revision' WHERE id=$1", [ids[0]]);
        assertEquals(await currentIssueRendition(current.compiledDocumentId!), null);
        await assertRejects(() => reviewIssueRendition(current.compiledDocumentId!, output.fingerprint, owner), Error, "changed");
        await client.queryArray("UPDATE documents SET is_public=false WHERE id=$1", [ids[0]]);
        assertEquals(await canViewCompilation(undefined, current.compiledDocumentId), false);
        assertEquals(await canViewDocument(undefined, ids[1]), false);
      });
      await t.step("Preparation group boundaries accept 20 files and 100 MB, reject excess and preserve draft metadata", async () => {
        const batch = await createImportBatch(owner, "compiled", crypto.randomUUID());
        const bytes = await syntheticPdf(1);
        const assets = [];
        for (let i=0;i<21;i++) assets.push(await stageImportAsset(batch.id,owner,`boundary-${i}.pdf`,stream(bytes)));
        let item = await createImportItem(batch.id,owner,crypto.randomUUID(),{...emptyImportMetadata(),title:"Retained boundary-test metadata"});
        const parts = assets.map(asset=>({assetId:asset.id,included:true,role:"Paper component"}));
        item = await updateImportItem(batch.id,item.id,owner,{revision:item.revision,recipe:{parts:parts.slice(0,20)}});
        await assertRejects(()=>updateImportItem(batch.id,item.id,owner,{revision:item.revision,recipe:{parts}}),Error,"20 files");
        // Declared-size boundary without allocating 100 MB. Streaming limits are
        // independently tested by stageStream's interrupted/oversized transfer tests.
        await client.queryArray("UPDATE import_assets SET size=5000000 WHERE id=ANY($1::uuid[])",[assets.slice(0,20).map(asset=>asset.id)]);
        item = await updateImportItem(batch.id,item.id,owner,{revision:item.revision,recipe:{parts:parts.slice(0,20)}});
        await client.queryArray("UPDATE import_assets SET size=5000001 WHERE id=$1",[assets[0].id]);
        await assertRejects(()=>updateImportItem(batch.id,item.id,owner,{revision:item.revision,recipe:{parts:parts.slice(0,20)}}),Error,"100 MB");
        const restored = await getImportBatch(batch.id,owner);
        assertEquals(restored.items[0].metadata.title,"Retained boundary-test metadata");
        assertEquals(restored.items[0].revision,item.revision);
        assertEquals(restored.assets.length,21);
      });
      if (Deno.env.get("ISSUE_SOURCE_QUALIFICATION") === "1") {
        await t.step("Original journal sources: private five-paper imports, reviewed 85/87-page outputs and direct author search", async () => {
          const originalPapers = {
            CONFLUENCE: [
              { title: "Unveiling Brand Salience: Exploring Impressions among College Students Towards St. Paul University Dumaguete, its Personnel and Graduates", authors: ["Sr. Helen Malubay, SPC", "Chesa Filosofo"] },
              { title: "Paulinian Synchronous Learning Platform In-Depth Analysis: Basis for an Enhanced Online Learning Model", authors: ["Regidor Carale, Ed.D.", "Marissa Carale, Ed.D."] },
              { title: "Taking Actions in the Field: The SPUD Pre-Service Teachers’ Action Research Experience", authors: ["Irish Udtohan, MS"] },
              { title: "Students’ Readiness for Paulinian Blended Learning (PBL)", authors: ["Janice Cuevas, MBA", "Dr. Maria Kathleen June Marino"] },
              { title: "By-term Subject Loading: Its Perceived Advantages and Disadvantages among College Faculty", authors: ["Roel Jumawan, Ed.D.", "Erven Noay, MA"] },
            ],
            SYNERGY: [
              { title: "Implementing Group-based Flipped Classroom Approach to Enhance Conceptual Understanding and Satisfaction in Learning Science", authors: ["Renzil Jean A. Abrasado"] },
              { title: "Teaching Science Process Skills through Computer Simulations to Grade 9 Students", authors: ["Abegail Kyle C. Catacutan"] },
              { title: "The Utilization of Educational Videos with the Method as a Supplementary Teaching Material to Enhance Students Cognitive Skills in Learning Science 10", authors: ["Lovella M. Janguin"] },
              { title: "The Integration of E-mind Mapping to Increase Student’s Achievement in Learning Science", authors: ["Elmie Q. Rosario"] },
              { title: "Quantification of Plate Waste in the School Canteen of St. Paul University Dumaguete", authors: ["John Kenneth Baldonado"] },
            ],
          };
          for (const fixture of [
            { category: "CONFLUENCE" as const, folder: "Confluence", main: "CONFLUENCE AY 2021-2022, VOL.12, NO. 1 FINAAAL.pdf", cover: "CONFLUENCE COVER 21-22.pdf", year: 2021, volume: 12, issue: 1, department: "", total: 85, front: 4, ranges: [[5,24],[25,44],[45,57],[58,70],[71,83]] },
            { category: "SYNERGY" as const, folder: "Synergy", main: "CASE SYNERGY 2022-2023 FINAL.pdf", cover: "CASE - Synergy (1).pdf", year: 2022, volume: 7, issue: null, department: "CASE", total: 87, front: 3, ranges: [[4,20],[21,41],[42,53],[54,71],[72,85]] },
          ]) {
            const batch = await createImportBatch(owner, "compiled", crypto.randomUUID());
            const sourceRoot = new URL(`../../import/${fixture.folder}/`, import.meta.url);
            const main = await stageImportAsset(batch.id, owner, fixture.main, stream(await Deno.readFile(new URL(fixture.main, sourceRoot))));
            const cover = await stageImportAsset(batch.id, owner, fixture.cover, stream(await Deno.readFile(new URL(fixture.cover, sourceRoot))));
            await saveImportCollection(batch.id, owner, (await getImportBatch(batch.id, owner)).revision, {
              category: fixture.category, startYear: fixture.year, endYear: fixture.year + 1, volume: fixture.volume, issue: fixture.issue, department: fixture.department,
              coverAssetId: cover.id, frontPage: 1, backPage: 2, reviewed: true, sourceArrangement: "complete_issue", mainAssetId: main.id,
              pageSections: [{ first: 1, last: fixture.front, role: "front_matter" }],
            });
            const ids: number[] = [];
            const preparedItems: ImportItem[] = [];
            for (const [index, [first,last]] of fixture.ranges.entries()) {
              const original = originalPapers[fixture.category][index];
              const sourceAuthorIds: string[] = [];
              for (const fullName of original.authors) {
                const existing = await client.queryObject<{id:string}>("SELECT id FROM authors WHERE full_name=$1",[fullName]);
                sourceAuthorIds.push(existing.rows[0]?.id ?? (await client.queryObject<{id:string}>("INSERT INTO authors(full_name) VALUES($1) RETURNING id",[fullName])).rows[0].id);
              }
              let item = await createImportItem(batch.id, owner, `${batch.id}:source:${index}`, {
                ...emptyImportMetadata(), title: original.title,
                documentType: fixture.category, publicationDate: String(fixture.year + 1), authorIds: sourceAuthorIds, topicIds: [topic],
                printedPageRange: {first:String(first-fixture.front),last:String(last-fixture.front)},
              });
              item = await updateImportItem(batch.id, item.id, owner, { revision: item.revision, recipe: { parts: [{ assetId: main.id, included: true, role: "Paper", firstPage: first, lastPage: last }] } });
              item = await prepare(item);
              assertEquals(item.pageCount, last - first + 1);
              item = await approve(item); // Test review only; does not assert original abstract/editorial approval.
              preparedItems.push(item);
            }
            for (const [index,item] of preparedItems.entries()) {
              const id = await commitImportItem(batch.id, item.id, owner);
              ids.push(id);
              assertEquals(await commitImportItem(batch.id, item.id, owner),id);
              const byline = await client.queryObject<{full_name:string}>("SELECT a.full_name FROM document_authors da JOIN authors a ON a.id=da.author_id WHERE da.document_id=$1 ORDER BY da.author_order",[id]);
              assertEquals(byline.rows.map(row=>row.full_name),originalPapers[fixture.category][index].authors);
            }
            const current = await getImportBatch(batch.id, owner);
            assert(current.compiledDocumentId);
            assertEquals(current.items.length, 5);
            for (const id of ids) assertEquals(await canViewDocument(undefined, id), false);
            const output = await prepareIssueRendition(current.compiledDocumentId);
            assertEquals(output.pages, fixture.total);
            assertEquals(output.manifest.sourceRanges.map((range: any) => [range.issueFirst, range.issueLast, range.standaloneFirst, range.standaloneLast]), fixture.ranges.map(([first,last]) => [first+1,last+1,1,last-first+1]));
            await reviewIssueRendition(current.compiledDocumentId, output.fingerprint, owner);
            await publishImportBatch(batch.id, owner, (await getImportBatch(batch.id, owner)).revision);
            if (fixture.category === "SYNERGY") {
              const found = await fetchDocuments({ search: "Abrasado", publicOnly: true });
              const paper = found.documents.find(d => !d.is_compiled && d.id === ids[0]);
              assert(paper);
              assert(paper.parent_issue?.label.includes("CASE"));
            }
            await client.queryArray("UPDATE documents SET is_public=false WHERE id=$1", [ids[0]]);
            assertEquals(await canViewCompilation(undefined, current.compiledDocumentId), false);
            for (const id of ids) assertEquals(await canViewDocument(undefined, id), false);
          }
        });
      }
      await t.step("Mixed complete issue and corrected paper: explicit authority replaces original pages once", async () => {
        const batch = await createImportBatch(owner, "compiled", crypto.randomUUID());
        const main = await stageImportAsset(batch.id, owner, "main.pdf", stream(await syntheticPdf(8)));
        const cover = await stageImportAsset(batch.id, owner, "cover.pdf", stream(await syntheticPdf(2)));
        const replacementPdf = await PDFDocument.load(await syntheticPdf(4));
        replacementPdf.getPages().forEach(page => page.setSize(444, 800));
        const replacement = await stageImportAsset(batch.id, owner, "authoritative-correction.pdf", stream(await replacementPdf.save()));
        await saveImportCollection(batch.id, owner, (await getImportBatch(batch.id, owner)).revision, { category: "CONFLUENCE", startYear: 2021, endYear: 2022, volume: 12, issue: 1, department: "", coverAssetId: cover.id, frontPage: 1, backPage: 2, mainAssetId: main.id, sourceArrangement: "complete_issue", pageSections: [{ first: 1, last: 2, role: "front_matter" }], reviewed: true });
        let first = await createImportItem(batch.id, owner, `replacement:${batch.id}:1`, { ...emptyImportMetadata(), title: "Corrected paper", documentType: "CONFLUENCE", publicationDate: "2022", authorIds: [author], topicIds: [topic], issueSourceRange: { assetId: main.id, firstPage: 3, lastPage: 5 } });
        first = await updateImportItem(batch.id, first.id, owner, { revision: first.revision, recipe: { parts: [{ assetId: replacement.id, included: true, role: "Authoritative correction" }] } });
        first = await approve(await prepare(first));
        let second = await createImportItem(batch.id, owner, `replacement:${batch.id}:2`, { ...emptyImportMetadata(), title: "Unchanged paper", documentType: "CONFLUENCE", publicationDate: "2022", authorIds: [author], topicIds: [topic] });
        second = await updateImportItem(batch.id, second.id, owner, { revision: second.revision, recipe: { parts: [{ assetId: main.id, included: true, role: "Paper range", firstPage: 6, lastPage: 8 }] } });
        second = await approve(await prepare(second));
        await assertRejects(() => commitImportItem(batch.id, first.id, owner), Error, "explicitly confirm");
        first = await updateImportItem(batch.id, first.id, owner, { revision: first.revision, metadata: { ...first.metadata, issueReplacementConfirmed: true } });
        first = await approve(first);
        const firstId = await commitImportItem(batch.id, first.id, owner);
        await commitImportItem(batch.id, second.id, owner);
        const saved = await getImportBatch(batch.id, owner);
        assert(saved.compiledDocumentId);
        const assembled = await prepareIssueRendition(saved.compiledDocumentId);
        assertEquals(assembled.pages, 11);
        assertEquals(assembled.manifest.sourceRanges.map((r: any) => [r.issueFirst, r.issueLast]), [[4,7],[8,10]]);
        const row = await currentIssueRendition(saved.compiledDocumentId, false);
        assert(row);
        const output = await PDFDocument.load(await Deno.readFile(resolveStoredPdfPath(row.file_path)!));
        assertEquals(output.getPages().slice(3, 7).map(p => p.getWidth()), [444,444,444,444]);
        assertEquals(assembled.manifest.sourceRanges[0].originalIssueRange, { assetId: main.id, firstPage: 3, lastPage: 5 });
        assertEquals((await prepareIssueRendition(saved.compiledDocumentId)).id, assembled.id);
        assertEquals(await canViewDocument(undefined, firstId), false);
        assertEquals(await canViewCompilation(undefined, saved.compiledDocumentId), false);
        await reviewIssueRendition(saved.compiledDocumentId,assembled.fingerprint,owner);
        await publishImportBatch(batch.id,owner,(await getImportBatch(batch.id,owner)).revision);
        const correction = await startIssueRevision(saved.compiledDocumentId,owner,crypto.randomUUID());
        assertEquals(correction.collection?.sourceArrangement,"complete_issue");
        assert(correction.collection?.pageSections?.some(section=>section.role==='front_matter'&&section.first===2&&section.last===3));
        await saveImportCollection(correction.id,owner,correction.revision,{...correction.collection!,reviewed:true});
        for(let clone of correction.items){
          clone=await updateImportItem(correction.id,clone.id,owner,{revision:clone.revision,metadata:{...clone.metadata,reviewNotes:{...emptyUploadReview(),completeness:'complete',layoutReviewed:true}}});
          await approve(await prepare(clone));
        }
        const preserved=await prepareIssueRevision(correction.id,owner);
        assertEquals(preserved.pages,11);
        assertEquals((await currentIssueRendition(saved.compiledDocumentId))?.sha256,assembled.sha256);
      });
      await t.step("Embedded covers are kept once and contradictory separate covers require explicit exclusion", async () => {
        const batch=await createImportBatch(owner,"compiled",crypto.randomUUID());
        const main=await stageImportAsset(batch.id,owner,"embedded-issue.pdf",stream(await syntheticPdf(8)));
        const separate=await stageImportAsset(batch.id,owner,"separate-covers.pdf",stream(await syntheticPdf(2)));
        const forewordPdf = await PDFDocument.create();
        forewordPdf.addPage([444, 800]);
        const foreword = await stageImportAsset(batch.id, owner, "foreword.pdf", stream(await forewordPdf.save()));
        const collection={category:"SYNERGY" as const,startYear:2022,endYear:2023,volume:7,issue:null,department:"CASE",coverAssetId:separate.id,frontPage:1,backPage:2,mainAssetId:main.id,sourceArrangement:"complete_issue" as const,reviewed:true,pageSections:[{first:1,last:1,role:"cover" as const},{first:2,last:2,role:"front_matter" as const},{first:8,last:8,role:"cover" as const}]};
        await saveImportCollection(batch.id,owner,(await getImportBatch(batch.id,owner)).revision,collection);
        let item=await createImportItem(batch.id,owner,`embedded:${batch.id}`,{...emptyImportMetadata(),title:"Embedded cover paper",documentType:"SYNERGY",publicationDate:"2023",authorIds:[author],topicIds:[topic]});
        item=await updateImportItem(batch.id,item.id,owner,{revision:item.revision,recipe:{parts:[{assetId:main.id,included:true,role:"Paper range",firstPage:3,lastPage:7}]}});
        item=await approve(await prepare(item));
        await assertRejects(()=>commitImportItem(batch.id,item.id,owner),Error,"embedded covers");
        await saveImportCollection(batch.id,owner,(await getImportBatch(batch.id,owner)).revision,{...collection,coverAssetId:main.id,frontPage:1,backPage:8,forewordAssetId:foreword.id});
        await commitImportItem(batch.id,item.id,owner);
        const saved=await getImportBatch(batch.id,owner);assert(saved.compiledDocumentId);
        const output=await prepareIssueRendition(saved.compiledDocumentId);
        assertEquals(output.pages, 9);
        assertEquals(output.manifest.components.map((part: { sourceFirst: number; sourceLast: number; finalFirst: number; finalLast: number }) =>
          [part.sourceFirst, part.sourceLast, part.finalFirst, part.finalLast]
        ), [[1, 1, 1, 1], [1, 1, 2, 2], [2, 8, 3, 9]]);
        assertEquals(output.manifest.sourceRanges.map((range: { issueFirst: number; issueLast: number }) =>
          [range.issueFirst, range.issueLast]
        ), [[4, 8]]);
        const row = await currentIssueRendition(saved.compiledDocumentId, false);
        assert(row);
        const pdf = await PDFDocument.load(await Deno.readFile(resolveStoredPdfPath(row.file_path)!));
        assertEquals(pdf.getPage(1).getWidth(), 444);

        // Recreate the manifest of an output saved by the old complete-issue assembly.
        const oldComponents = output.manifest.components.filter((part: { sourceSha256: string }) => part.sourceSha256 !== foreword.sha256);
        await client.queryArray("UPDATE issue_renditions SET manifest=jsonb_set(manifest,'{components}',$2::jsonb),reviewed_at=now() WHERE id=$1", [output.id, JSON.stringify(oldComponents)]);
        assertEquals(await currentIssueRendition(saved.compiledDocumentId), null);
        const repaired = await prepareIssueRendition(saved.compiledDocumentId);
        assertEquals(repaired.reviewed, false);
        assertEquals(repaired.manifest.components, output.manifest.components);
      });
      await t.step("Published issue correction preserves live assets and IDs until atomic reviewed replacement", async () => {
        let { batch, item } = await paper("compiled");
        const cover = await stageImportAsset(batch.id, owner, "cover.pdf", stream(await syntheticPdf(2)));
        await saveImportCollection(batch.id, owner, (await getImportBatch(batch.id,owner)).revision, { category:"CONFLUENCE",startYear:2020,endYear:2021,volume:2,issue:1,department:"",coverAssetId:cover.id,frontPage:1,backPage:2,reviewed:true });
        item = await approve(await prepare(item));
        const documentId = await commitImportItem(batch.id,item.id,owner);
        batch = await getImportBatch(batch.id,owner); assert(batch.compiledDocumentId);
        const parentId = batch.compiledDocumentId;
        const oldOutput = await prepareIssueRendition(parentId);
        await reviewIssueRendition(parentId,oldOutput.fingerprint,owner);
        await publishImportBatch(batch.id,owner,batch.revision);
        const original = (await client.queryObject<Record<string,any>>("SELECT id,public_id,title,file_path,content_sha256 FROM documents WHERE id=$1",[documentId])).rows[0];
        const oldPublic = await currentIssueRendition(parentId); assert(oldPublic);
        const beforeCount = Number((await client.queryObject<{count:string}>("SELECT count(*)::text AS count FROM documents")).rows[0].count);
        const beforeAuthors = Number((await client.queryObject<{count:string}>("SELECT count(*)::text AS count FROM authors")).rows[0].count);
        const key = crypto.randomUUID();
        const correction = await startIssueRevision(parentId,owner,key);
        assertEquals((await startIssueRevision(parentId,owner,key)).id,correction.id);
        assertEquals(correction.items.length,1);
        assertEquals(correction.revisionTarget?.id,parentId);
        await assertRejects(()=>commitImportItem(correction.id,correction.items[0].id,owner),Error,"revision review");
        const correctedSource = await stageImportAsset(correction.id,owner,"corrected.pdf",stream(await syntheticPdf(4)));
        const finishDraft = async (workspaceId:string,title:string,replacementAsset?:string) => {
          let current = await getImportBatch(workspaceId,owner);
          await saveImportCollection(workspaceId,owner,current.revision,{...current.collection!,reviewed:true});
          let draftItem = current.items[0];
          draftItem = await updateImportItem(workspaceId,draftItem.id,owner,{revision:draftItem.revision,metadata:{...draftItem.metadata,title,reviewNotes:{...emptyUploadReview(),completeness:"complete",layoutReviewed:true}},...(replacementAsset?{recipe:{parts:[{assetId:replacementAsset,included:true,role:"Corrected authoritative paper"}]}}:{})});
          draftItem = await approve(await prepare(draftItem));
          const output = await prepareIssueRevision(workspaceId,owner);
          await reviewIssueRevision(workspaceId,owner,output.fingerprint);
          return {draftItem,output};
        };
        const {draftItem,output} = await finishDraft(correction.id,"Reviewed atomic correction",correctedSource.id);
        assertEquals(output.pages,6);
        assertEquals((await currentIssueRendition(parentId))?.sha256,oldPublic.sha256);
        assertEquals((await client.queryObject<{title:string}>("SELECT title FROM documents WHERE id=$1",[documentId])).rows[0].title,original.title);
        const stale = await startIssueRevision(parentId,owner,crypto.randomUUID());
        const staleOutput = (await finishDraft(stale.id,"Stale correction")).output;
        await client.queryArray(`CREATE FUNCTION fail_issue_revision_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id=${documentId} AND NEW.title='Reviewed atomic correction' AND NEW.is_public THEN RAISE EXCEPTION 'synthetic revision failure'; END IF; RETURN NEW; END $$`);
        await client.queryArray("CREATE TRIGGER fail_issue_revision_test BEFORE UPDATE ON documents FOR EACH ROW EXECUTE FUNCTION fail_issue_revision_test()");
        await assertRejects(()=>publishIssueRevision(correction.id,owner,output.fingerprint),Error,"synthetic revision failure");
        await client.queryArray("DROP TRIGGER fail_issue_revision_test ON documents"); await client.queryArray("DROP FUNCTION fail_issue_revision_test()");
        assertEquals((await currentIssueRendition(parentId))?.sha256,oldPublic.sha256);
        assertEquals((await client.queryObject<{title:string}>("SELECT title FROM documents WHERE id=$1",[documentId])).rows[0].title,original.title);
        assertEquals((await getImportBatch(correction.id,owner)).items[0].documentId,null);
        await Promise.all([publishIssueRevision(correction.id,owner,output.fingerprint),publishIssueRevision(correction.id,owner,output.fingerprint)]);
        const revised = (await client.queryObject<Record<string,any>>("SELECT id,public_id,title,file_path,pages FROM documents WHERE id=$1",[documentId])).rows[0];
        assertEquals(revised.id,original.id); assertEquals(revised.public_id,original.public_id); assertEquals(revised.pages,4); assertEquals(revised.title,"Reviewed atomic correction");
        assertEquals((await currentIssueRendition(parentId))?.sha256,output.sha256);
        assertEquals((await currentIssueRendition(parentId))?.page_count,6);
        assertEquals(await canViewDocument(undefined,documentId),true);
        assertEquals(Number((await client.queryObject<{count:string}>("SELECT count(*)::text AS count FROM documents")).rows[0].count),beforeCount);
        assertEquals(Number((await client.queryObject<{count:string}>("SELECT count(*)::text AS count FROM authors")).rows[0].count),beforeAuthors);
        assertEquals((await getImportBatch(correction.id,owner)).items[0].documentId,documentId);
        const history = (await client.queryObject<Record<string,any>>("SELECT previous_revision,published_at FROM issue_revisions WHERE batch_id=$1",[correction.id])).rows[0];
        assert(history.published_at); assertEquals(history.previous_revision.catalog.papers[0].file_path,original.file_path);
        await assertRejects(()=>publishIssueRevision(stale.id,owner,staleOutput.fingerprint),Error,"published issue changed");
        assertEquals((await currentIssueRendition(parentId))?.sha256,output.sha256);
      });
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
