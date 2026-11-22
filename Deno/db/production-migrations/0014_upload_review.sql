CREATE TABLE upload_review_jobs (
 id uuid PRIMARY KEY,
 owner_id text NOT NULL,
 fingerprint text NOT NULL,
 state text NOT NULL CHECK(state IN ('staging','processing','ready','failed')),
 options jsonb NOT NULL,
 components jsonb NOT NULL DEFAULT '[]',
 review jsonb NOT NULL DEFAULT '{"completeness":"unchecked","remarks":"","holdReason":"","issueKind":"none","layoutReviewed":false}',
 result jsonb,
 error text,
 document_id integer REFERENCES documents(id) ON DELETE SET NULL,
 compiled_document_id integer REFERENCES compiled_documents(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(owner_id,fingerprint)
);
CREATE INDEX upload_review_document ON upload_review_jobs(document_id);
CREATE INDEX upload_review_compiled ON upload_review_jobs(compiled_document_id);
GRANT SELECT,INSERT,UPDATE,DELETE ON upload_review_jobs TO peas_app;
ALTER TABLE import_jobs ADD COLUMN progress jsonb NOT NULL DEFAULT '{}';
ALTER TABLE import_assets ADD COLUMN retained_source_path text;
ALTER TABLE import_assets ADD COLUMN retained_preview_path text;

-- Enforce the private review boundary for every publication writer.
CREATE FUNCTION check_upload_publication_review() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.is_public OR NEW.review_status='approved') AND EXISTS (
   SELECT 1 FROM upload_review_jobs j WHERE j.document_id=NEW.id AND (
     j.result->>'filePath' IS DISTINCT FROM NEW.file_path OR
     j.review->>'completeness' IS DISTINCT FROM 'complete' OR
     j.review->>'layoutReviewed' IS DISTINCT FROM 'true' OR
     length(trim(coalesce(j.review->>'holdReason','')))>0)
 ) THEN RAISE EXCEPTION 'Resolve the manuscript completeness, PDF review, and publication hold before approval'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER check_upload_publication_review BEFORE UPDATE ON documents FOR EACH ROW EXECUTE FUNCTION check_upload_publication_review();

CREATE FUNCTION check_compiled_upload_review() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.review_status='approved' AND EXISTS (
   SELECT 1 FROM upload_review_jobs j WHERE j.compiled_document_id=NEW.id AND (
     (j.result->>'filePath' IS DISTINCT FROM NEW.cover_file_path AND j.result->>'filePath' IS DISTINCT FROM NEW.foreword) OR
     j.review->>'completeness' IS DISTINCT FROM 'complete' OR
     j.review->>'layoutReviewed' IS DISTINCT FROM 'true' OR
     length(trim(coalesce(j.review->>'holdReason','')))>0)
 ) THEN RAISE EXCEPTION 'Resolve the publication source review and hold before approval'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER check_compiled_upload_review BEFORE UPDATE ON compiled_documents FOR EACH ROW EXECUTE FUNCTION check_compiled_upload_review();
