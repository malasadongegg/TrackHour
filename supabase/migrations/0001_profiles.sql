-- TrackHour phase 2: saved profiles.
--
-- PRIVACY: this table stores AGGREGATE numbers and a card design only.
-- Never raw exports, message text, conversation titles, or per-message
-- timestamps. `aggregates` holds the same shape the card renderer consumes
-- (per-tool stats and per-day active minutes), nothing finer.

create table public.profiles (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null unique references auth.users (id) on delete cascade,
  -- Public handle used in card URLs, e.g. /api/card?u=mark
  slug        text not null unique check (slug ~ '^[a-z0-9_-]{3,40}$'),
  -- Sharing is opt-in. A card URL only works while this is true.
  is_public   boolean not null default false,
  -- A CardConfig. Untrusted on read: the renderer always re-normalizes it.
  card_config jsonb not null default '{}'::jsonb check (pg_column_size(card_config) < 8192),
  -- { timeZone, updatedAt, all, byTool, daysByTool }. See card/src/types.ts.
  aggregates  jsonb not null default '{}'::jsonb check (pg_column_size(aggregates) < 262144),
  updated_at  timestamptz not null default now()
);

create index profiles_public_slug_idx on public.profiles (slug) where is_public;

alter table public.profiles enable row level security;

-- Owners have full control of their own row.
create policy "owner can read" on public.profiles
  for select using (auth.uid() = user_id);
create policy "owner can insert" on public.profiles
  for insert with check (auth.uid() = user_id);
create policy "owner can update" on public.profiles
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "owner can delete" on public.profiles
  for delete using (auth.uid() = user_id);

-- The card endpoint reads public profiles with the anon key. It can see only
-- rows their owner made public, and nothing here is sensitive by design.
create policy "public profiles are readable" on public.profiles
  for select using (is_public);

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();
