CREATE TABLE IF NOT EXISTS site_experience_versions (
  id SERIAL PRIMARY KEY,
  status VARCHAR(20) NOT NULL CHECK (status IN ('draft', 'published', 'archived')),
  version INTEGER NOT NULL,
  config JSONB NOT NULL,
  created_by VARCHAR(50),
  updated_by VARCHAR(50),
  published_by VARCHAR(50),
  created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  published_at TIMESTAMP WITHOUT TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_site_experience_versions_status
  ON site_experience_versions(status);

CREATE INDEX IF NOT EXISTS idx_site_experience_versions_version
  ON site_experience_versions(version DESC);

CREATE TABLE IF NOT EXISTS site_assets (
  id SERIAL PRIMARY KEY,
  file_path VARCHAR(500) NOT NULL,
  kind VARCHAR(80) NOT NULL,
  alt_text VARCHAR(255),
  mime_type VARCHAR(120) NOT NULL,
  size_bytes INTEGER NOT NULL,
  created_by VARCHAR(50),
  created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_site_assets_kind
  ON site_assets(kind);

CREATE TABLE IF NOT EXISTS user_experience_preferences (
  user_id VARCHAR(50) PRIMARY KEY,
  preferences JSONB NOT NULL,
  created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
