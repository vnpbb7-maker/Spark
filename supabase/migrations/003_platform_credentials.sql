-- Run this SQL in your Supabase SQL Editor

create table platform_credentials (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users not null,
  platform text not null,
  credentials jsonb not null,
  created_at timestamptz default now(),
  unique(user_id, platform)
);

alter table platform_credentials enable row level security;

create policy "本人のみ操作可"
on platform_credentials for all
using (auth.uid() = user_id);
