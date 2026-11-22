-- Private replacement workspaces reference existing catalog identities.
CREATE TABLE issue_revisions (
 batch_id uuid PRIMARY KEY REFERENCES import_batches(id),
 compiled_document_id integer NOT NULL REFERENCES compiled_documents(id),
 base_fingerprint text NOT NULL,
 targets jsonb NOT NULL DEFAULT '{}',
 prepared jsonb,
 reviewed_by text,
 reviewed_at timestamptz,
 published_at timestamptz,
 previous_revision jsonb,
 created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT,INSERT,UPDATE,DELETE ON issue_revisions TO peas_app;
CREATE INDEX issue_revisions_parent ON issue_revisions(compiled_document_id);
ALTER TABLE import_items ADD COLUMN abstract_diagnostics jsonb NOT NULL DEFAULT '{}';
