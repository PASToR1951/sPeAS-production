-- Normalize author-name matching without rewriting existing display values.
-- Duplicate directory rows are consolidated first so the unique index can be
-- applied safely to databases that predate normalized author matching.

BEGIN;

CREATE TEMP TABLE peas_author_name_map ON COMMIT DROP AS
WITH ranked AS (
  SELECT
    a.id,
    FIRST_VALUE(a.id) OVER (
      PARTITION BY LOWER(REGEXP_REPLACE(BTRIM(a.full_name), '[[:space:]]+', ' ', 'g'))
      ORDER BY
        ((a.spud_id IS NOT NULL)::int + (a.affiliation IS NOT NULL)::int +
         (a.department IS NOT NULL)::int + (a.email IS NOT NULL)::int +
         (a.orcid_id IS NOT NULL)::int + (a.biography IS NOT NULL)::int +
         (a.profile_picture IS NOT NULL)::int) DESC,
        a.created_at ASC NULLS LAST,
        a.id ASC
    ) AS canonical_id
  FROM public.authors a
)
SELECT id, canonical_id
FROM ranked;

-- Keep non-null metadata from duplicate rows when the canonical row is
-- missing that field. If both rows disagree, the canonical row wins.
CREATE TEMP TABLE peas_author_canonical_data ON COMMIT DROP AS
SELECT
  map.canonical_id,
  COALESCE(MAX(a.spud_id) FILTER (WHERE a.id = map.canonical_id), MAX(a.spud_id)) AS spud_id,
  COALESCE(MAX(a.affiliation) FILTER (WHERE a.id = map.canonical_id), MAX(a.affiliation)) AS affiliation,
  COALESCE(MAX(a.department) FILTER (WHERE a.id = map.canonical_id), MAX(a.department)) AS department,
  COALESCE(MAX(a.email) FILTER (WHERE a.id = map.canonical_id), MAX(a.email)) AS email,
  COALESCE(MAX(a.orcid_id) FILTER (WHERE a.id = map.canonical_id), MAX(a.orcid_id)) AS orcid_id,
  COALESCE(MAX(a.biography) FILTER (WHERE a.id = map.canonical_id), MAX(a.biography)) AS biography,
  COALESCE(MAX(a.profile_picture) FILTER (WHERE a.id = map.canonical_id), MAX(a.profile_picture)) AS profile_picture
FROM peas_author_name_map map
JOIN public.authors a ON a.id = map.id
GROUP BY map.canonical_id;

UPDATE public.authors canonical
SET spud_id = data.spud_id,
    affiliation = data.affiliation,
    department = data.department,
    email = data.email,
    orcid_id = data.orcid_id,
    biography = data.biography,
    profile_picture = data.profile_picture,
    updated_at = CURRENT_TIMESTAMP
FROM peas_author_canonical_data data
WHERE canonical.id = data.canonical_id
  AND (canonical.spud_id, canonical.affiliation, canonical.department,
       canonical.email, canonical.orcid_id, canonical.biography,
       canonical.profile_picture)
      IS DISTINCT FROM
      (data.spud_id, data.affiliation, data.department, data.email,
       data.orcid_id, data.biography, data.profile_picture);

-- Rebuild affected document links so two duplicate rows cannot collide on the
-- document_authors primary key. The earliest author position wins.
CREATE TEMP TABLE peas_document_author_links ON COMMIT DROP AS
SELECT da.document_id, m.canonical_id AS author_id, MIN(da.author_order) AS author_order
FROM public.document_authors da
JOIN peas_author_name_map m ON m.id = da.author_id
GROUP BY da.document_id, m.canonical_id;

CREATE TEMP TABLE peas_affected_documents ON COMMIT DROP AS
SELECT DISTINCT document_id
FROM public.document_authors da
JOIN peas_author_name_map m ON m.id = da.author_id
WHERE m.id <> m.canonical_id;

DELETE FROM public.document_authors da
USING peas_affected_documents affected
WHERE da.document_id = affected.document_id;

INSERT INTO public.document_authors (document_id, author_id, author_order)
SELECT document_id,
       author_id,
       ROW_NUMBER() OVER (PARTITION BY document_id ORDER BY author_order, author_id)::integer
FROM peas_document_author_links
WHERE document_id IN (SELECT document_id FROM peas_affected_documents);

-- Apply the same merge to ordered news-author references.
CREATE TEMP TABLE peas_news_author_links ON COMMIT DROP AS
SELECT npa.news_post_id, m.canonical_id AS author_id, MIN(npa.position) AS position
FROM public.news_post_authors npa
JOIN peas_author_name_map m ON m.id = npa.author_id
GROUP BY npa.news_post_id, m.canonical_id;

CREATE TEMP TABLE peas_affected_news_posts ON COMMIT DROP AS
SELECT DISTINCT news_post_id
FROM public.news_post_authors npa
JOIN peas_author_name_map m ON m.id = npa.author_id
WHERE m.id <> m.canonical_id;

DELETE FROM public.news_post_authors npa
USING peas_affected_news_posts affected
WHERE npa.news_post_id = affected.news_post_id;

INSERT INTO public.news_post_authors (news_post_id, author_id, position)
SELECT news_post_id,
       author_id,
       ROW_NUMBER() OVER (PARTITION BY news_post_id ORDER BY position, author_id)::smallint
FROM peas_news_author_links
WHERE news_post_id IN (SELECT news_post_id FROM peas_affected_news_posts);

UPDATE public.author_visits visits
SET author_id = map.canonical_id
FROM peas_author_name_map map
WHERE visits.author_id = map.id
  AND map.id <> map.canonical_id;

DELETE FROM public.authors authors
USING peas_author_name_map map
WHERE authors.id = map.id
  AND map.id <> map.canonical_id;

CREATE UNIQUE INDEX IF NOT EXISTS authors_normalized_full_name_key
  ON public.authors (LOWER(REGEXP_REPLACE(BTRIM(full_name), '[[:space:]]+', ' ', 'g')));

COMMIT;
