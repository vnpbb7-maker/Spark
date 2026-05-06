-- Cache analysis results on campaigns and support copy
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS analysis_cache jsonb;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS copied_from uuid REFERENCES campaigns(id);
