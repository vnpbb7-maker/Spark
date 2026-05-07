-- Multi-factor scoring columns
ALTER TABLE targets ADD COLUMN IF NOT EXISTS relevance_score integer;
ALTER TABLE targets ADD COLUMN IF NOT EXISTS intent_score integer;
ALTER TABLE targets ADD COLUMN IF NOT EXISTS influence_score integer;
ALTER TABLE targets ADD COLUMN IF NOT EXISTS accessibility_score integer;
