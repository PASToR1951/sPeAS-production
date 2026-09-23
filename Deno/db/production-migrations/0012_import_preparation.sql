ALTER TABLE documents ADD COLUMN publication_date_precision text NOT NULL DEFAULT 'legacy' CHECK (publication_date_precision IN ('year','month','day','legacy'));
ALTER TABLE documents ADD COLUMN original_program text;
ALTER TABLE documents ADD COLUMN original_major text;
ALTER TABLE compiled_documents ADD COLUMN contents_revision integer NOT NULL DEFAULT 1;
ALTER TABLE compiled_documents ADD COLUMN contents_needs_resolution boolean NOT NULL DEFAULT false;
CREATE TABLE compiled_membership_audit (id bigserial PRIMARY KEY, recorded_at timestamptz NOT NULL DEFAULT now(), reason text NOT NULL, original_row jsonb NOT NULL);
INSERT INTO compiled_membership_audit(reason, original_row)
 SELECT 'duplicate_pair', to_jsonb(c) FROM compiled_document_items c WHERE EXISTS (SELECT 1 FROM compiled_document_items earlier WHERE earlier.compiled_document_id=c.compiled_document_id AND earlier.document_id=c.document_id AND earlier.id<c.id);
DELETE FROM compiled_document_items c WHERE EXISTS (SELECT 1 FROM compiled_document_items earlier WHERE earlier.compiled_document_id=c.compiled_document_id AND earlier.document_id=c.document_id AND earlier.id<c.id);
INSERT INTO compiled_membership_audit(reason, original_row)
 SELECT 'conflicting_parent', to_jsonb(c) FROM compiled_document_items c JOIN documents d ON d.id=c.document_id WHERE (d.compiled_parent_id IS NOT NULL AND d.compiled_parent_id<>c.compiled_document_id) OR EXISTS (SELECT 1 FROM compiled_document_items x WHERE x.document_id=c.document_id AND x.compiled_document_id<>c.compiled_document_id);
UPDATE compiled_documents SET contents_needs_resolution=true WHERE id IN (SELECT compiled_document_id FROM compiled_document_items WHERE document_id IN (SELECT (original_row->>'document_id')::int FROM compiled_membership_audit WHERE reason='conflicting_parent')) OR id IN (SELECT d.compiled_parent_id FROM documents d WHERE d.id IN (SELECT (original_row->>'document_id')::int FROM compiled_membership_audit WHERE reason='conflicting_parent'));
UPDATE documents d SET compiled_parent_id=c.compiled_document_id FROM compiled_document_items c WHERE d.id=c.document_id AND d.compiled_parent_id IS NULL AND NOT EXISTS (SELECT 1 FROM compiled_document_items x WHERE x.document_id=c.document_id AND x.compiled_document_id<>c.compiled_document_id);
INSERT INTO compiled_document_items(compiled_document_id,document_id) SELECT compiled_parent_id,id FROM documents d WHERE compiled_parent_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM compiled_document_items c WHERE c.document_id=d.id);
ALTER TABLE compiled_document_items ADD COLUMN position integer;
WITH positions AS (SELECT id,row_number() OVER(PARTITION BY compiled_document_id ORDER BY id)::int AS p FROM compiled_document_items) UPDATE compiled_document_items c SET position=p.p FROM positions p WHERE p.id=c.id;
ALTER TABLE compiled_document_items ALTER COLUMN position SET NOT NULL;
ALTER TABLE compiled_document_items ADD CONSTRAINT compiled_positive_position CHECK(position>0);
ALTER TABLE compiled_document_items ADD CONSTRAINT compiled_unique_paper UNIQUE(compiled_document_id,document_id);
ALTER TABLE compiled_document_items ADD CONSTRAINT compiled_unique_position UNIQUE(compiled_document_id,position) DEFERRABLE INITIALLY DEFERRED;

-- Compatibility writers receive a serialized append position. Both historical
-- membership representations are kept in the same transaction, including unlink.
CREATE FUNCTION import_membership_before() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent integer;
BEGIN
 PERFORM id FROM compiled_documents WHERE id=NEW.compiled_document_id FOR UPDATE;
 SELECT compiled_parent_id INTO parent FROM documents WHERE id=NEW.document_id FOR UPDATE;
 IF parent IS NOT NULL AND parent<>NEW.compiled_document_id THEN RAISE EXCEPTION 'Paper already has a different primary collection'; END IF;
 IF EXISTS(SELECT 1 FROM compiled_document_items WHERE document_id=NEW.document_id AND compiled_document_id<>NEW.compiled_document_id) THEN RAISE EXCEPTION 'Resolve conflicting collection membership first'; END IF;
 IF NEW.position IS NULL THEN SELECT coalesce(max(position),0)+1 INTO NEW.position FROM compiled_document_items WHERE compiled_document_id=NEW.compiled_document_id; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER import_membership_before BEFORE INSERT ON compiled_document_items FOR EACH ROW EXECUTE FUNCTION import_membership_before();
CREATE FUNCTION import_membership_after() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN
   UPDATE documents SET compiled_parent_id=NULL WHERE id=OLD.document_id AND compiled_parent_id=OLD.compiled_document_id;
   UPDATE compiled_documents SET contents_revision=contents_revision+1 WHERE id=OLD.compiled_document_id;
   RETURN OLD;
 END IF;
 UPDATE documents SET compiled_parent_id=NEW.compiled_document_id WHERE id=NEW.document_id AND compiled_parent_id IS DISTINCT FROM NEW.compiled_document_id;
 UPDATE compiled_documents SET contents_revision=contents_revision+1 WHERE id=NEW.compiled_document_id;
 RETURN NEW;
END $$;
CREATE TRIGGER import_membership_after AFTER INSERT OR DELETE OR UPDATE OF position ON compiled_document_items FOR EACH ROW EXECUTE FUNCTION import_membership_after();
CREATE FUNCTION import_primary_parent_after() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND NEW.compiled_parent_id IS NOT DISTINCT FROM OLD.compiled_parent_id THEN RETURN NEW; END IF;
 DELETE FROM compiled_document_items WHERE document_id=NEW.id AND compiled_document_id IS DISTINCT FROM NEW.compiled_parent_id;
 IF NEW.compiled_parent_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM compiled_document_items WHERE document_id=NEW.id AND compiled_document_id=NEW.compiled_parent_id) THEN
 INSERT INTO compiled_document_items(compiled_document_id,document_id) VALUES(NEW.compiled_parent_id,NEW.id);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER import_primary_parent_after AFTER INSERT OR UPDATE OF compiled_parent_id ON documents FOR EACH ROW EXECUTE FUNCTION import_primary_parent_after();

CREATE TABLE import_batches (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id varchar NOT NULL, idempotency_key text NOT NULL,
 mode text NOT NULL CHECK(mode IN ('single','compiled','batch')), status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','cancelled','expired')),
 revision integer NOT NULL DEFAULT 1, collection jsonb, compiled_document_id integer REFERENCES compiled_documents(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(), last_activity_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL DEFAULT now()+interval '30 days', published_at timestamptz,
 UNIQUE(owner_id,idempotency_key)
);
CREATE TABLE import_assets (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), batch_id uuid NOT NULL REFERENCES import_batches(id), relative_path text NOT NULL, path_key text NOT NULL,
 sha256 text NOT NULL CHECK(sha256~'^[a-f0-9]{64}$'), size bigint NOT NULL CHECK(size>0 AND size<=100000000), kind text NOT NULL CHECK(kind IN ('pdf','doc','docx','catalog')),
 source_path text NOT NULL, preview_path text, preview_sha256 text, page_count integer, conversion jsonb, error text, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(batch_id,path_key)
);
CREATE TABLE import_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), batch_id uuid NOT NULL REFERENCES import_batches(id), external_key text NOT NULL,
 revision integer NOT NULL DEFAULT 1, metadata_revision integer NOT NULL DEFAULT 1, recipe_revision integer NOT NULL DEFAULT 1,
 metadata jsonb NOT NULL, recipe jsonb NOT NULL DEFAULT '{"parts":[]}', review jsonb NOT NULL DEFAULT '{}',
 state text NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','preparing','needs_review','ready','committed','failed','ignored','expired')),
 final_path text, final_sha256 text, page_count integer, page_mapping jsonb NOT NULL DEFAULT '[]', abstract_candidate jsonb,
 document_id integer UNIQUE REFERENCES documents(id) ON DELETE SET NULL, error text, UNIQUE(batch_id,external_key)
);
CREATE TABLE import_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), batch_id uuid NOT NULL REFERENCES import_batches(id), item_id uuid NOT NULL REFERENCES import_items(id), recipe_revision integer NOT NULL,
 kind text NOT NULL CHECK(kind IN ('prepare','assemble')), status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','processing','done','failed','superseded')),
 attempts integer NOT NULL DEFAULT 0, worker_id text, lease_token uuid, heartbeat_at timestamptz, available_at timestamptz NOT NULL DEFAULT now(), error text,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(item_id,recipe_revision,kind)
);
CREATE INDEX import_jobs_queue ON import_jobs(available_at,created_at) WHERE status='queued';
CREATE TABLE import_provenance (
 document_id integer PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE, item_id uuid NOT NULL UNIQUE REFERENCES import_items(id), batch_id uuid NOT NULL REFERENCES import_batches(id),
 external_key text NOT NULL, metadata jsonb NOT NULL, recipe jsonb NOT NULL, review jsonb NOT NULL, source_manifest jsonb NOT NULL, page_mapping jsonb NOT NULL, final_sha256 text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE import_external_records (external_key text PRIMARY KEY, document_id integer NOT NULL REFERENCES documents(id) ON DELETE CASCADE, item_id uuid NOT NULL REFERENCES import_items(id));
CREATE TABLE import_exports (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),batch_id uuid NOT NULL REFERENCES import_batches(id),file_path text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE import_worker_state (worker_id text PRIMARY KEY,heartbeat_at timestamptz NOT NULL DEFAULT now(),converter_version text,converter_ready boolean NOT NULL DEFAULT false,diagnostic text);
GRANT SELECT,INSERT,UPDATE,DELETE ON import_worker_state TO peas_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON import_batches,import_assets,import_items,import_jobs,import_provenance,import_external_records,import_exports,compiled_membership_audit TO peas_app;
GRANT USAGE,SELECT,UPDATE ON SEQUENCE compiled_membership_audit_id_seq TO peas_app;

-- Preserve the existing explicit permanent-delete workflow. Staging retention
-- alone never invokes this trigger or removes repository provenance.
CREATE FUNCTION import_document_removed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 UPDATE import_items SET document_id=NULL,state='ignored',revision=revision+1,
   error='Repository record was permanently deleted' WHERE document_id=OLD.id;
 RETURN OLD;
END $$;
CREATE TRIGGER import_document_removed BEFORE DELETE ON documents FOR EACH ROW EXECUTE FUNCTION import_document_removed();
