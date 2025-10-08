-- Add 'processing' to export_status enum
ALTER TYPE export_status ADD VALUE IF NOT EXISTS 'processing';
