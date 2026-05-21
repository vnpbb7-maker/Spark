-- conversions テーブル（クリック追跡）
CREATE TABLE IF NOT EXISTS conversions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE,
  target_id UUID REFERENCES targets(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  clicked_at TIMESTAMPTZ DEFAULT NOW(),
  ip_address TEXT,
  user_agent TEXT
);

CREATE INDEX IF NOT EXISTS idx_conversions_campaign ON conversions(campaign_id);
CREATE INDEX IF NOT EXISTS idx_conversions_target ON conversions(target_id);
CREATE INDEX IF NOT EXISTS idx_conversions_user ON conversions(user_id);

ALTER TABLE conversions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_bypass" ON conversions
  FOR ALL USING (auth.role() = 'service_role');

-- campaignsテーブルにenable_trackingカラムを追加
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS enable_tracking BOOLEAN DEFAULT false;
