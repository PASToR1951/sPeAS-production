-- Create the page_visits table if it doesn't exist
CREATE TABLE IF NOT EXISTS page_visits (
    id SERIAL PRIMARY KEY,
    page_url VARCHAR(255) NOT NULL,
    visitor_type VARCHAR(10) NOT NULL,
    user_id VARCHAR(50),
    ip_address VARCHAR(45),
    visit_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    metadata JSONB
);

-- Add index on page_url for faster lookups
CREATE INDEX IF NOT EXISTS idx_page_visits_page_url ON page_visits(page_url);

-- Add index on visit_date for time-based queries
CREATE INDEX IF NOT EXISTS idx_page_visits_visit_date ON page_visits(visit_date);

-- Add index on metadata -> documentId for document visit queries
CREATE INDEX IF NOT EXISTS idx_page_visits_document_id ON page_visits((metadata->>'documentId')); 