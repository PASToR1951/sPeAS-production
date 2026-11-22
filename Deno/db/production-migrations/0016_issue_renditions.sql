-- Existing catalog identities remain unchanged. Outputs are immutable revisions.
CREATE TABLE issue_renditions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 compiled_document_id integer NOT NULL REFERENCES compiled_documents(id),
 fingerprint text NOT NULL,
 file_path text NOT NULL,
 sha256 text NOT NULL,
 page_count integer NOT NULL CHECK(page_count > 0),
 manifest jsonb NOT NULL,
 reviewed_by text,
 reviewed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(compiled_document_id,fingerprint)
);
GRANT SELECT,INSERT,UPDATE,DELETE ON issue_renditions TO peas_app;
CREATE INDEX issue_renditions_parent ON issue_renditions(compiled_document_id);

-- A held/withdrawn child must also hide the issue containing its pages.
CREATE FUNCTION privatize_issue_after_paper_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.compiled_parent_id IS NOT NULL AND
   (NEW.deleted_at IS NOT NULL OR NEW.review_status <> 'approved' OR NOT NEW.is_public) THEN
   UPDATE compiled_documents SET review_status='pending_review',updated_at=now()
   WHERE id=NEW.compiled_parent_id AND review_status='approved';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER privatize_issue_after_paper_change AFTER UPDATE OF review_status,is_public,deleted_at ON documents
 FOR EACH ROW EXECUTE FUNCTION privatize_issue_after_paper_change();

CREATE FUNCTION privatize_reviewed_issue_hold() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE notes jsonb;
BEGIN
 IF TG_TABLE_NAME='import_items' THEN notes := NEW.metadata->'reviewNotes';
 ELSE notes := NEW.review; END IF;
 IF notes IS NOT NULL AND (notes->>'completeness' IS DISTINCT FROM 'complete' OR
    length(trim(coalesce(notes->>'holdReason','')))>0 OR
    (TG_TABLE_NAME='upload_review_jobs' AND notes->>'layoutReviewed' IS DISTINCT FROM 'true')) THEN
   IF NEW.document_id IS NOT NULL THEN
     UPDATE documents SET is_public=false,review_status='pending_review',updated_at=now() WHERE id=NEW.document_id;
   END IF;
   IF TG_TABLE_NAME='upload_review_jobs' THEN
     UPDATE compiled_documents SET review_status='pending_review',updated_at=now() WHERE id=NEW.compiled_document_id;
   END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER privatize_import_review_hold AFTER UPDATE OF metadata ON import_items FOR EACH ROW EXECUTE FUNCTION privatize_reviewed_issue_hold();
CREATE TRIGGER privatize_upload_review_hold AFTER UPDATE OF review ON upload_review_jobs FOR EACH ROW EXECUTE FUNCTION privatize_reviewed_issue_hold();

CREATE FUNCTION check_import_issue_hold() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.is_public OR NEW.review_status='approved') AND EXISTS (
   SELECT 1 FROM import_items i WHERE i.document_id=NEW.id AND i.metadata ? 'reviewNotes' AND (
     i.metadata->'reviewNotes'->>'completeness' IS DISTINCT FROM 'complete' OR
     length(trim(coalesce(i.metadata->'reviewNotes'->>'holdReason','')))>0)
 ) THEN RAISE EXCEPTION 'Resolve the paper completeness and hold before publication'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER check_import_issue_hold BEFORE UPDATE ON documents FOR EACH ROW EXECUTE FUNCTION check_import_issue_hold();
