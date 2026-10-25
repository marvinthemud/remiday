-- REMIDAY database setup. Run once in Supabase: SQL Editor > New query > paste > Run.

create table if not exists public.docs (
  collection text not null,
  id         text not null,
  data       jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (collection, id)
);

create table if not exists public.media (
  id         text primary key,
  mime       text,
  data       text not null,          -- image stored as a data: URI
  created_at timestamptz not null default now()
);

alter table public.docs  enable row level security;
alter table public.media enable row level security;

-- Only a signed-in user (your shared family login) can read or change anything.
drop policy if exists "family only" on public.docs;
create policy "family only" on public.docs  for all to authenticated using (true) with check (true);
drop policy if exists "family only" on public.media;
create policy "family only" on public.media for all to authenticated using (true) with check (true);

-- Live sync between the two phones.
alter publication supabase_realtime add table public.docs;
