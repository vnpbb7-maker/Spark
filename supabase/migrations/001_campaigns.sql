-- Run this SQL in your Supabase SQL Editor

create table campaigns (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users not null,
  product_url text,
  product_description text not null,
  target_personas jsonb,
  platforms text[] default '{}',
  status text default 'running',
  daily_limit int default 50,
  tone text default 'casual',
  auto_mode boolean default false,
  created_at timestamptz default now()
);

alter table campaigns enable row level security;

create policy "ユーザーは自分のキャンペーンのみ操作可"
on campaigns for all
using (auth.uid() = user_id);
