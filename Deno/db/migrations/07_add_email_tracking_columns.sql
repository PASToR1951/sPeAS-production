-- Migration: Add email tracking columns to document_requests table
ALTER TABLE document_requests 
ADD COLUMN IF NOT EXISTS email_sent BOOLEAN DEFAULT NULL,
ADD COLUMN IF NOT EXISTS email_error TEXT DEFAULT NULL;
 
-- Add is_entire_collection and child_documents columns if not already present
ALTER TABLE document_requests 
ADD COLUMN IF NOT EXISTS is_entire_collection BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS child_documents INTEGER[] DEFAULT NULL; 