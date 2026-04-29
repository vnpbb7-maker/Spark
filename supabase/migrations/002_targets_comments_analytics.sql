-- Run this SQL in your Supabase SQL Editor

create table targets (
  id uuid default gen_random_uuid() primary key,
  campaign_id uuid references campaigns not null,
  platform text not null,
  username text not null,
  profile_url text,
  post_url text,
  post_content text,
  bio text,
  match_reason text,
  match_score int default 0,
  status text default 'pending',
  contacted_at timestamptz,
  created_at timestamptz default now()
);

alter table targets enable row level security;

create policy "キャンペーンオーナーのみ操作可"
on targets for all
using (
  exists (
    select 1 from campaigns
    where campaigns.id = targets.campaign_id
    and campaigns.user_id = auth.uid()
  )
);

create table comments (
  id uuid default gen_random_uuid() primary key,
  target_id uuid references targets not null,
  campaign_id uuid references campaigns not null,
  platform text not null,
  content text not null,
  approach text,
  approved boolean default false,
  approved_at timestamptz,
  posted_at timestamptz,
  response_text text,
  responded_at timestamptz,
  created_at timestamptz default now()
);

alter table comments enable row level security;

create policy "キャンペーンオーナーのみ操作可"
on comments for all
using (
  exists (
    select 1 from campaigns
    where campaigns.id = comments.campaign_id
    and campaigns.user_id = auth.uid()
  )
);

create table analytics (
  id uuid default gen_random_uuid() primary key,
  campaign_id uuid references campaigns not null,
  date date not null,
  platform text,
  targets_found int default 0,
  comments_posted int default 0,
  responses int default 0,
  conversions int default 0,
  created_at timestamptz default now()
);

-- Realtime有効化
alter publication supabase_realtime add table targets;
alter publication supabase_realtime add table comments;
