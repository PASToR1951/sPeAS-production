-- Create a view that maps document_categories to existing categories table
CREATE OR REPLACE VIEW document_categories AS
SELECT 
    id, 
    category_name AS category,
    NOW() AS created_at,
    NOW() AS updated_at
FROM categories;

-- Make sure categories table has the required entries
INSERT INTO categories (category_name) VALUES 
('THESIS'),
('DISSERTATION'),
('CONFLUENCE'),
('SYNERGY')
ON CONFLICT (category_name) DO NOTHING; 