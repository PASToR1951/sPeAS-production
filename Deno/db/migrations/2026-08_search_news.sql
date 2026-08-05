-- Allow public search analytics to classify published news article selections.
ALTER TABLE public.search_activity_rollups
  DROP CONSTRAINT IF EXISTS search_activity_rollups_term_type_check;

ALTER TABLE public.search_activity_rollups
  ADD CONSTRAINT search_activity_rollups_term_type_check
  CHECK (term_type IN ('work', 'news', 'author', 'topic', 'keyword', 'agenda', 'free_text));
