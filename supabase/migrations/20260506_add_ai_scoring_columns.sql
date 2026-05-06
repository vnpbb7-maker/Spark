-- Add AI scoring columns to targets table
ALTER TABLE targets ADD COLUMN IF NOT EXISTS priority text;
ALTER TABLE targets ADD COLUMN IF NOT EXISTS ai_reason text;
ALTER TABLE targets ADD COLUMN IF NOT EXISTS estimated_age text;
ALTER TABLE targets ADD COLUMN IF NOT EXISTS estimated_role text;
