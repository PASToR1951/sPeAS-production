import { client, withTransaction } from "../db/denopost_conn.ts";
import { SystemLogsModel } from "../models/systemLogsModel.ts";
import {
  itemDto,
  requireBatch,
  requireEditable,
  type Row,
} from "./importPreparationService.ts";
import { ImportError } from "./importStorageService.ts";
import { itemIsReady } from "../../shared/imports.ts";

export type SubmissionReviewer = {
  id: string;
  role: "admin" | "manuscript_reviewer";
};

export function requireSubmissionReview(
  batch: Row,
  reviewer: SubmissionReviewer,
) {
  if (
    !batch.staff_submission || !batch.submitted_at ||
    batch.status !== "draft" ||
    (reviewer.role !== "admin" &&
      (batch.assigned_reviewer_id !== reviewer.id ||
        batch.owner_id === reviewer.id))
  ) throw new ImportError("Submission not found in your review queue.", 404);
  requireEditable(batch, true);
}

export async function getReviewBatch(
  id: string,
  reviewer: SubmissionReviewer,
  db: Pick<typeof client, "queryObject"> = client,
  lock = false,
) {
  const { rows: [batch] } = await db.queryObject<Row>(
    `SELECT * FROM import_batches WHERE id=$1 ${lock ? "FOR UPDATE" : ""}`,
    [id],
  );
  if (!batch) {
    throw new ImportError("Submission not found in your review queue.", 404);
  }
  requireSubmissionReview(batch, reviewer);
  return batch;
}

export async function submitStaffBatch(
  id: string,
  owner: string,
  revision: number,
) {
  await withTransaction(async (db) => {
    const batch = await requireBatch(id, owner, db, true);
    requireEditable(batch);
    if (!batch.staff_submission || batch.revision !== revision) {
      throw new ImportError(
        "The workspace changed. Reload it before submitting.",
        409,
      );
    }
    const { rows } = await db.queryObject<Row>(
      "SELECT * FROM import_items WHERE batch_id=$1 AND state<>'ignored'",
      [id],
    );
    if (
      !rows.length || rows.some((item) => !itemIsReady(itemDto(item))) ||
      (batch.mode === "compiled" && !batch.collection?.reviewed)
    ) {
      throw new ImportError(
        "Prepare every included paper and save the required review checks before submitting.",
        409,
      );
    }
    const jobs = await db.queryObject(
      "SELECT 1 FROM import_jobs WHERE batch_id=$1 AND status IN ('queued','processing') LIMIT 1",
      [id],
    );
    if (jobs.rows.length) {
      throw new ImportError("Wait for file preparation to finish.", 409);
    }
    await db.queryArray(
      "UPDATE import_batches SET submitted_at=now(),return_note=NULL,revision=revision+1,expires_at=now()+interval '30 days' WHERE id=$1",
      [id],
    );
    await SystemLogsModel.createLog({
      log_type: "document",
      user_id: owner,
      action: "staff_submission_submitted",
      related_id: id,
    }, db);
  });
}

export async function assignStaffBatch(
  id: string,
  admin: SubmissionReviewer,
  reviewerId: string,
  revision: number,
) {
  await withTransaction(async (db) => {
    const batch = await getReviewBatch(id, admin, db, true);
    if (batch.revision !== revision) {
      throw new ImportError("The submission changed. Reload the queue.", 409);
    }
    const { rows } = await db.queryObject(
      "SELECT id FROM users WHERE id=$1 AND role='manuscript_reviewer' AND NOT password_setup_required AND id<>$2",
      [reviewerId, batch.owner_id],
    );
    if (!rows.length) {
      throw new ImportError(
        "Select a Manuscript Reviewer who has completed password setup.",
      );
    }
    await db.queryArray(
      "UPDATE import_batches SET assigned_reviewer_id=$2,revision=revision+1 WHERE id=$1",
      [id, reviewerId],
    );
    await SystemLogsModel.createLog({
      log_type: "document",
      user_id: admin.id,
      action: "staff_submission_assigned",
      related_id: id,
      details: { reviewerId },
    }, db);
  });
}

export async function returnStaffBatch(
  id: string,
  reviewer: SubmissionReviewer,
  note: string,
  revision: number,
) {
  await withTransaction(async (db) => {
    const batch = await getReviewBatch(id, reviewer, db, true);
    if (batch.revision !== revision) {
      throw new ImportError(
        "The submission changed. Reload it before returning.",
        409,
      );
    }
    const { rows } = await db.queryObject(
      `SELECT d.id FROM documents d JOIN import_items i ON i.document_id=d.id
       WHERE i.batch_id=$1 FOR UPDATE OF d`,
      [id],
    );
    const archived = await db.queryObject(
      `UPDATE documents SET deleted_at=now(),updated_at=now()
       WHERE id IN (SELECT document_id FROM import_items WHERE batch_id=$1)
       AND review_status<>'approved' AND NOT is_public RETURNING id`,
      [id],
    );
    if (archived.rows.length !== rows.length) {
      throw new ImportError(
        "A paper is already approved. Review the catalog before returning this submission.",
        409,
      );
    }
    if (batch.compiled_document_id) {
      const parent = await db.queryObject(
        "UPDATE compiled_documents SET deleted_at=now(),updated_at=now() WHERE id=$1 AND review_status<>'approved' RETURNING id",
        [batch.compiled_document_id],
      );
      if (!parent.rows.length) {
        throw new ImportError("The issue is already approved.", 409);
      }
    }
    await db.queryArray(
      "DELETE FROM import_external_records WHERE item_id IN (SELECT id FROM import_items WHERE batch_id=$1)",
      [id],
    );
    await db.queryArray(
      "UPDATE import_items SET document_id=NULL,state='ready',revision=revision+1 WHERE batch_id=$1 AND state='committed'",
      [id],
    );
    await db.queryArray(
      `UPDATE import_batches SET submitted_at=NULL,assigned_reviewer_id=NULL,compiled_document_id=NULL,
       return_note=$2,revision=revision+1,expires_at=now()+interval '30 days' WHERE id=$1`,
      [id, note],
    );
    await SystemLogsModel.createLog({
      log_type: "document",
      user_id: reviewer.id,
      action: "staff_submission_returned",
      related_id: id,
      details: { note },
    }, db);
  });
}
