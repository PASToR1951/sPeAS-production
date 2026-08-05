-- Migration to add abstract_foreword column to compiled_documents table
-- This column will store the abstract text extracted from the foreword PDF file

-- Add abstract_foreword column to store the extracted abstract text from the foreword PDF file
ALTER TABLE public.compiled_documents ADD COLUMN abstract_foreword TEXT;

-- Add comment to explain the purpose of the column
COMMENT ON COLUMN public.compiled_documents.abstract_foreword IS 'Abstract text extracted from the foreword PDF file';

-- Note: The foreword column will continue to store the file path to the foreword PDF file 