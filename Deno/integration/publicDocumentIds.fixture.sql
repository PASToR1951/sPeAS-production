-- Seed before migration 0015 to exercise UUID backfill as well as new inserts.
INSERT INTO compiled_documents (id, category, volume, start_year, end_year, review_status, deleted_at)
VALUES (8, 'CONFLUENCE', 1, 2024, 2025, 'approved', NULL),
       (9, 'CONFLUENCE', 2, 2024, 2025, 'pending_review', NULL),
       (10, 'CONFLUENCE', 3, 2024, 2025, 'approved', CURRENT_TIMESTAMP);

INSERT INTO documents (id, title, file_path, document_type, review_status, is_public, compiled_parent_id, deleted_at)
VALUES (6, 'Public UUID fixture', 'storage/thesis/public-id.pdf', 'THESIS', 'approved', TRUE, NULL, NULL),
       (7, 'Private UUID fixture', 'storage/thesis/public-id.pdf', 'THESIS', 'approved', FALSE, NULL, NULL),
       (8, 'Legacy collection fixture', 'storage/thesis/public-id.pdf', 'THESIS', 'approved', TRUE, NULL, NULL),
       (9, 'Pending UUID fixture', 'storage/thesis/public-id.pdf', 'THESIS', 'pending_review', TRUE, NULL, NULL),
       (10, 'Deleted UUID fixture', 'storage/thesis/public-id.pdf', 'THESIS', 'approved', TRUE, NULL, CURRENT_TIMESTAMP),
       (11, 'Public child UUID fixture', 'storage/thesis/public-id.pdf', 'THESIS', 'approved', TRUE, 8, NULL),
       (12, 'Private child UUID fixture', 'storage/thesis/public-id.pdf', 'THESIS', 'approved', FALSE, 8, NULL),
       (13, 'Pending child UUID fixture', 'storage/thesis/public-id.pdf', 'THESIS', 'pending_review', TRUE, 8, NULL),
       (14, 'Pending parent UUID fixture', 'storage/thesis/public-id.pdf', 'THESIS', 'approved', TRUE, 9, NULL),
       (15, 'Deleted parent UUID fixture', 'storage/thesis/public-id.pdf', 'THESIS', 'approved', TRUE, 10, NULL);

INSERT INTO compiled_document_items (compiled_document_id, document_id, position)
VALUES (8, 11, 1), (8, 12, 2), (8, 13, 3)
ON CONFLICT (compiled_document_id, document_id) DO UPDATE SET position=EXCLUDED.position;
SELECT setval('documents_id_seq', 15, true);
SELECT setval('compiled_documents_id_seq', 10, true);
