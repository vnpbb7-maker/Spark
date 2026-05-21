-- profilesテーブルにis_adminとplanカラムを追加
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT false;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS plan TEXT DEFAULT 'free';

-- skillive.info@gmail.com を管理者・無制限プランに設定
UPDATE profiles SET is_admin = true, plan = 'unlimited'
WHERE id = (SELECT id FROM auth.users WHERE email = 'skillive.info@gmail.com');

-- vnpbb7@gmail.com も管理者として設定（既存の開発者アカウント）
UPDATE profiles SET is_admin = true, plan = 'unlimited'
WHERE id = (SELECT id FROM auth.users WHERE email = 'vnpbb7@gmail.com');
