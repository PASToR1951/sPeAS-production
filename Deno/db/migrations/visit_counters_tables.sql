-- Migration to create counter-based visit tracking tables

-- Document visits table
CREATE TABLE IF NOT EXISTS document_visits (
  doc_id VARCHAR(50),
  date DATE DEFAULT CURRENT_DATE,
  visitor_type VARCHAR(10) NOT NULL CHECK (visitor_type IN ('guest', 'user')),
  visit_count INT DEFAULT 1,
  PRIMARY KEY (doc_id, date, visitor_type)
);

-- Author visits table
CREATE TABLE IF NOT EXISTS author_visits_counter (
  author_id VARCHAR(50),
  date DATE DEFAULT CURRENT_DATE,
  visitor_type VARCHAR(10) NOT NULL CHECK (visitor_type IN ('guest', 'user')),
  visit_count INT DEFAULT 1,
  PRIMARY KEY (author_id, date, visitor_type)
);

-- Page visits table
CREATE TABLE IF NOT EXISTS page_visits_counter (
  page_path VARCHAR(255),
  date DATE DEFAULT CURRENT_DATE,
  visitor_type VARCHAR(10) NOT NULL CHECK (visitor_type IN ('guest', 'user')),
  visit_count INT DEFAULT 1,
  PRIMARY KEY (page_path, date, visitor_type)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_document_visits_date ON document_visits(date);
CREATE INDEX IF NOT EXISTS idx_author_visits_counter_date ON author_visits_counter(date);
CREATE INDEX IF NOT EXISTS idx_page_visits_counter_date ON page_visits_counter(date);

-- Add comments
COMMENT ON TABLE document_visits IS 'Counter-based tracking of document visits by date';
COMMENT ON TABLE author_visits_counter IS 'Counter-based tracking of author profile visits by date';
COMMENT ON TABLE page_visits_counter IS 'Counter-based tracking of page visits by date'; 