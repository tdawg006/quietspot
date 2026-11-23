-- Run AFTER upgrade_v3.sql. Safe to rerun. Never expose service_role keys in browser code.
create table if not exists public.space_confirmations (
  space_id text not null references public.spaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(space_id,user_id)
);
create table if not exists public.space_flags (
  space_id text not null references public.spaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(space_id,user_id)
);
create table if not exists public.space_corrections (
  id uuid primary key default gen_random_uuid(),
  space_id text not null references public.spaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  details text not null check (char_length(details) between 10 and 1000),
  status text not null default 'pending' check (status in ('pending','accepted','rejected')),
  created_at timestamptz not null default now()
);
create index if not exists space_corrections_pending_idx on public.space_corrections(status,created_at desc);
alter table public.space_confirmations enable row level security;
alter table public.space_flags enable row level security;
alter table public.space_corrections enable row level security;
drop policy if exists "read confirmations" on public.space_confirmations;
create policy "read confirmations" on public.space_confirmations for select to anon,authenticated using (true);
drop policy if exists "confirm as yourself" on public.space_confirmations;
create policy "confirm as yourself" on public.space_confirmations for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists "read flags" on public.space_flags;
create policy "read flags" on public.space_flags for select to anon,authenticated using (true);
drop policy if exists "flag as yourself" on public.space_flags;
create policy "flag as yourself" on public.space_flags for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists "submit correction" on public.space_corrections;
create policy "submit correction" on public.space_corrections for insert to authenticated with check (user_id = (select auth.uid()) and status = 'pending');
drop policy if exists "read own corrections" on public.space_corrections;
create policy "read own corrections" on public.space_corrections for select to authenticated using (user_id = (select auth.uid()));
-- Review suggestions/flags from Supabase dashboard. No browser-side approval rights.
-- Corrections are suggestions, not automatic edits.
