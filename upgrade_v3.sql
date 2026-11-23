-- Run AFTER the existing schema.sql. Safe to rerun.
alter table public.spaces add column if not exists description text not null default '';
alter table public.spaces add column if not exists latitude double precision;
alter table public.spaces add column if not exists longitude double precision;
alter table public.spaces add column if not exists created_by uuid references auth.users(id) on delete set null;
alter table public.spaces add column if not exists created_at timestamptz not null default now();
alter table public.spaces drop constraint if exists spaces_valid_coordinates;
alter table public.spaces add constraint spaces_valid_coordinates check (
  (latitude is null and longitude is null) or
  (latitude between -90 and 90 and longitude between -180 and 180)
);
alter table public.spaces drop constraint if exists spaces_cap_valid;
alter table public.spaces add constraint spaces_cap_valid check (cap between 1 and 5000);
alter table public.spaces drop constraint if exists spaces_description_length;
alter table public.spaces add constraint spaces_description_length check (char_length(description) <= 500 and char_length(name) <= 90 and char_length(building) <= 90);
drop policy if exists "students can add spaces" on public.spaces;
create policy "students can add spaces" on public.spaces for insert to authenticated
with check (created_by = (select auth.uid()));

create table if not exists public.space_photos (
  id uuid primary key default gen_random_uuid(),
  space_id text not null references public.spaces(id) on delete cascade,
  path text not null unique,
  uploaded_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists space_photos_space_idx on public.space_photos(space_id);
alter table public.space_photos enable row level security;
drop policy if exists "public can see photo metadata" on public.space_photos;
create policy "public can see photo metadata" on public.space_photos for select using (true);
drop policy if exists "owners can add photo metadata" on public.space_photos;
create policy "owners can add photo metadata" on public.space_photos for insert to authenticated
with check (uploaded_by = (select auth.uid()) and exists (
  select 1 from public.spaces s where s.id = space_id and s.created_by = (select auth.uid())
) and split_part(path,'/',1) = (select auth.uid())::text
and split_part(path,'/',2) = space_id);

-- Existing bucket remains public for read-only display. Restrict writes to
-- authenticated students and their own UUID-prefixed paths.
drop policy if exists "students upload own campus photos" on storage.objects;
create policy "students upload own campus photos" on storage.objects for insert to authenticated
with check (bucket_id = 'campus-photos' and (storage.foldername(name))[1] = (select auth.uid())::text
and exists (select 1 from public.spaces s where s.id = (storage.foldername(name))[2]
and s.created_by = (select auth.uid())));
drop policy if exists "students remove own campus photos" on storage.objects;
create policy "students remove own campus photos" on storage.objects for delete to authenticated
using (bucket_id = 'campus-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
