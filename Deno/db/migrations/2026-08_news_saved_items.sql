-- Authenticated saved-news records. Existing rows require no backfill.
CREATE TABLE IF NOT EXISTS public.user_saved_news_posts (
  user_id VARCHAR(50) NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  news_post_id BIGINT NOT NULL REFERENCES public.news_posts(id) ON DELETE CASCADE,
  saved_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, news_post_id)
);

CREATE INDEX IF NOT EXISTS idx_user_saved_news_posts_user_saved
  ON public.user_saved_news_posts (user_id, saved_at DESC);
