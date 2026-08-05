CREATE TABLE IF NOT EXISTS legacy_public_release_soak (
  release_id VARCHAR(160) PRIMARY KEY,
  first_started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  legacy_hit_count BIGINT NOT NULL DEFAULT 0 CHECK (legacy_hit_count >= 0),
  last_legacy_hit_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS legacy_public_path_daily_hits (
  release_id VARCHAR(160) NOT NULL REFERENCES legacy_public_release_soak(release_id),
  hit_date DATE NOT NULL DEFAULT CURRENT_DATE,
  path TEXT NOT NULL,
  method VARCHAR(12) NOT NULL,
  response_status SMALLINT NOT NULL CHECK (response_status BETWEEN 100 AND 599),
  hit_count BIGINT NOT NULL DEFAULT 1 CHECK (hit_count > 0),
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (release_id, hit_date, path, method, response_status)
);

CREATE INDEX IF NOT EXISTS idx_legacy_public_path_hits_release
  ON legacy_public_path_daily_hits (release_id, hit_date DESC);
