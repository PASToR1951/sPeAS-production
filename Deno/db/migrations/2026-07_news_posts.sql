CREATE TABLE IF NOT EXISTS news_posts (
  id BIGSERIAL PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  slug VARCHAR(255) NOT NULL UNIQUE,
  excerpt TEXT NOT NULL,
  body TEXT NOT NULL,
  body_format VARCHAR(20) NOT NULL DEFAULT 'plain',
  cover_image_url TEXT,
  cover_image_alt VARCHAR(255) NOT NULL DEFAULT '',
  author_name VARCHAR(160) NOT NULL DEFAULT 'Office of Research & Publications',
  status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  published_at TIMESTAMPTZ,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMPTZ
);

ALTER TABLE news_posts ADD COLUMN IF NOT EXISTS body_format VARCHAR(20) NOT NULL DEFAULT 'plain';
ALTER TABLE news_posts ADD COLUMN IF NOT EXISTS cover_image_alt VARCHAR(255) NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_news_posts_public_feed
  ON news_posts (published_at DESC)
  WHERE status = 'published' AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS news_post_authors (
  news_post_id BIGINT NOT NULL REFERENCES news_posts(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES authors(id) ON DELETE CASCADE,
  position SMALLINT NOT NULL DEFAULT 0,
  PRIMARY KEY (news_post_id, author_id)
);

CREATE INDEX IF NOT EXISTS idx_news_post_authors_author
  ON news_post_authors (author_id, news_post_id);

CREATE TABLE IF NOT EXISTS news_post_works (
  news_post_id BIGINT NOT NULL REFERENCES news_posts(id) ON DELETE CASCADE,
  record_type VARCHAR(20) NOT NULL CHECK (record_type IN ('document', 'compiled')),
  record_id INTEGER NOT NULL,
  position SMALLINT NOT NULL DEFAULT 0,
  PRIMARY KEY (news_post_id, record_type, record_id)
);

CREATE INDEX IF NOT EXISTS idx_news_post_works_record
  ON news_post_works (record_type, record_id, news_post_id);
