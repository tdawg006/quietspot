-- QuietSpot database. Paste this whole file into Supabase > SQL Editor > New query > Run.

-- 1. Tables ---------------------------------------------------------------
create table if not exists public.spaces (
  id         text primary key,
  name       text not null,
  building   text not null,
  rule       text not null check (rule in ('silent','talk')),
  outlets    boolean not null default false,
  cap        int  not null default 0,
  image_path text            -- file name inside the "campus-photos" bucket
);

create table if not exists public.reports (
  id         uuid primary key default gen_random_uuid(),
  space_id   text not null references public.spaces(id) on delete cascade,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  occ        int  not null check (occ in (10,40,75,100)),
  noise      int  not null check (noise between 0 and 2),
  created_at timestamptz not null default now()
);
create index if not exists reports_space_time on public.reports (space_id, created_at desc);

-- 2. Row Level Security: who may read / write what ------------------------
alter table public.spaces  enable row level security;
alter table public.reports enable row level security;

drop policy if exists "anyone can read spaces"  on public.spaces;
drop policy if exists "anyone can read reports" on public.reports;
drop policy if exists "logged-in users can report" on public.reports;

create policy "anyone can read spaces"  on public.spaces  for select using (true);
create policy "anyone can read reports" on public.reports for select using (true);
create policy "logged-in users can report" on public.reports
  for insert to authenticated with check (user_id = auth.uid());

-- 3. Same user cannot report the same space twice within 5 minutes --------
create or replace function public.enforce_cooldown() returns trigger
language plpgsql set search_path = public as $$
begin
  if exists (select 1 from public.reports
             where user_id = new.user_id and space_id = new.space_id
               and created_at > now() - interval '5 minutes') then
    raise exception 'COOLDOWN';
  end if;
  return new;
end $$;

drop trigger if exists reports_cooldown on public.reports;
create trigger reports_cooldown before insert on public.reports
  for each row execute function public.enforce_cooldown();

-- 4. The campus spaces (same six as the original app) ---------------------
insert into public.spaces (id, name, building, rule, outlets, cap, image_path) values
  ('lib2','Main Library, 2nd floor','Library','silent',true,120,'lib2.jpg'),
  ('lib3','Main Library, 3rd floor','Library','silent',false,90,'lib3.jpg'),
  ('disc','Group Study Rooms','Library','talk',true,40,'disc.jpg'),
  ('cafe','Student Centre Café','Student Centre','talk',true,60,'cafe.jpg'),
  ('eng','Engineering Block Atrium','Engineering','talk',false,50,'eng.jpg'),
  ('read','Reading Garden Pavilion','Outdoors','silent',false,30,'read.jpg')
on conflict (id) do nothing;

-- 5. Public bucket for the campus pictures --------------------------------
insert into storage.buckets (id, name, public)
values ('campus-photos','campus-photos',true)
on conflict (id) do nothing;

-- 6. OPTIONAL: allow only university e-mails to sign up -------------------
-- Check your real domain first, then remove the two "--" lines below to enable.
-- create or replace function public.only_uni_emails() returns trigger language plpgsql security definer as $$
-- begin if new.email not ilike '%@dsu.edu.in' then raise exception 'Use your university email'; end if; return new; end $$;
-- create trigger enforce_uni_email before insert on auth.users for each row execute function public.only_uni_emails();
