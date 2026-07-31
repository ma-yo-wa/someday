-- =====================================================================
--  003 — shared Google calendar overlays (not plans)
--
--  Each partner can import one calendar’s events into the space so the
--  other can see what they’re up to. These are never activities.
-- =====================================================================

create table if not exists public.external_events (
  id             uuid primary key default gen_random_uuid(),
  space_id       uuid not null references public.spaces(id) on delete cascade,
  owner_id       uuid not null references public.profiles(id) on delete cascade,
  -- Stable id from Google (etc.) so re-import updates instead of stacking.
  source_id      text not null,
  title          text,
  location       text,
  starts_at      timestamptz not null,
  ends_at        timestamptz not null,
  all_day        boolean not null default false,
  calendar_name  text not null default 'Google',
  updated_at     timestamptz not null default now(),
  unique (space_id, owner_id, source_id)
);

create index if not exists external_events_space_idx
  on public.external_events(space_id, starts_at);
create index if not exists external_events_owner_idx
  on public.external_events(space_id, owner_id);

alter table public.external_events enable row level security;

drop policy if exists "members read external events" on public.external_events;
create policy "members read external events" on public.external_events
  for select using (public.is_space_member(space_id));

drop policy if exists "owner insert external events" on public.external_events;
create policy "owner insert external events" on public.external_events
  for insert with check (
    public.is_space_member(space_id) and owner_id = auth.uid()
  );

drop policy if exists "owner update external events" on public.external_events;
create policy "owner update external events" on public.external_events
  for update using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists "owner delete external events" on public.external_events;
create policy "owner delete external events" on public.external_events
  for delete using (owner_id = auth.uid());

alter table public.external_events replica identity full;

-- Table Editor / SQL create doesn't always grant API roles.
grant select, insert, update, delete on public.external_events to authenticated;
grant select on public.external_events to anon;

do $$
begin
  alter publication supabase_realtime add table public.external_events;
exception
  when duplicate_object then null;
end $$;
