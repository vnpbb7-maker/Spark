-- sent_history: 送信済み企業を記録し、重複送信を防ぐ
CREATE TABLE IF NOT EXISTS sent_history (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  company_name TEXT,
  website_url  TEXT,
  email        TEXT,
  sent_at      TIMESTAMPTZ DEFAULT NOW(),
  campaign_id  UUID,
  send_method  TEXT -- 'email' | 'form' | 'dm'
);

CREATE INDEX IF NOT EXISTS idx_sent_history_user_domain
  ON sent_history(user_id, website_url);

CREATE INDEX IF NOT EXISTS idx_sent_history_user_email
  ON sent_history(user_id, email);

-- RLS: ユーザーは自分の履歴のみ参照・操作可能
ALTER TABLE sent_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sent_history_select_own" ON sent_history
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "sent_history_insert_own" ON sent_history
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "sent_history_delete_own" ON sent_history
  FOR DELETE USING (auth.uid() = user_id);
