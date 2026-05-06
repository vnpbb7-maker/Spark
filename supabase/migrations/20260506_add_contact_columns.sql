-- Add public contact info columns to targets table
ALTER TABLE targets ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE targets ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE targets ADD COLUMN IF NOT EXISTS website text;
ALTER TABLE targets ADD COLUMN IF NOT EXISTS contact_url text;
