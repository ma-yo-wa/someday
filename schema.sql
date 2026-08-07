-- =====================================================================
--  OUR SPACE — shared planning app for two
--  Supabase / Postgres schema, RLS, audit triggers, realtime
--  Run this in the Supabase SQL editor (or `supabase db push`).
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- 1. PROFILES  (mirrors auth.users, holds display name + accent colour)
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  color        text not null default '#E4436B',
  created_at   timestamptz not null default now()
);

-- Auto-create a profile row whenever someone signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ---------------------------------------------------------------------
-- 2. SPACES  (exactly one private space per couple)
-- ---------------------------------------------------------------------
create table if not exists public.spaces (
  id            uuid primary key default gen_random_uuid(),
  name          text not null default 'Someday',
  partner_1_id  uuid not null references public.profiles(id) on delete cascade,
  partner_2_id  uuid references public.profiles(id) on delete set null,
  invite_code   text unique not null default encode(gen_random_bytes(4), 'hex'),
  created_at    timestamptz not null default now(),

  -- A space is a pair, never a self-pair.
  constraint partners_are_distinct check (partner_2_id is null or partner_1_id <> partner_2_id)
);

create index if not exists spaces_partner_1_idx on public.spaces(partner_1_id);
create index if not exists spaces_partner_2_idx on public.spaces(partner_2_id);


-- ---------------------------------------------------------------------
-- 3. ACTIVITIES  (unified table: Idea = null date_time, Plan = set date_time)
-- ---------------------------------------------------------------------
create table if not exists public.activities (
  id          uuid primary key default gen_random_uuid(),
  space_id    uuid not null references public.spaces(id) on delete cascade,
  title       text not null check (length(btrim(title)) > 0),
  description text,
  image_url   text,
  created_by  uuid not null references public.profiles(id),
  date_time   timestamptz,            -- NULL  => Idea (bucket list)
                                      -- SET   => Plan (on the calendar)
  all_day     boolean not null default false,
  -- Pending when-suggestion (one at a time). Cleared on accept/dismiss/date change.
  suggested_date_time timestamptz,
  suggested_ends_at   timestamptz,
  suggested_all_day   boolean not null default false,
  suggested_by        uuid references public.profiles(id) on delete set null,
  suggested_at        timestamptz,
  suggested_note      text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists activities_space_idx      on public.activities(space_id);
create index if not exists activities_date_idx       on public.activities(space_id, date_time);
-- Partial index: the bucket list is the hottest read path.
create index if not exists activities_ideas_idx      on public.activities(space_id, created_at desc)
  where date_time is null;


-- ---------------------------------------------------------------------
-- 4. AUDIT LOGS  (the "History" timeline on each item)
-- ---------------------------------------------------------------------
create table if not exists public.audit_logs (
  id          uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.activities(id) on delete cascade,
  space_id    uuid not null references public.spaces(id) on delete cascade,
  user_id     uuid references public.profiles(id) on delete set null,
  action_type text not null check (action_type in
                ('created','scheduled','rescheduled','unscheduled','edited','deleted',
                 'suggested','suggestion_accepted','suggestion_dismissed')),
  details     text,
  timestamp   timestamptz not null default now()
);

create index if not exists audit_logs_activity_idx on public.audit_logs(activity_id, timestamp);
create index if not exists audit_logs_space_idx    on public.audit_logs(space_id, timestamp desc);


-- ---------------------------------------------------------------------
-- 5. MEMBERSHIP HELPER
--    SECURITY DEFINER so RLS on spaces doesn't recurse.
-- ---------------------------------------------------------------------
create or replace function public.is_space_member(target_space uuid)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.spaces s
    where s.id = target_space
      and (s.partner_1_id = auth.uid() or s.partner_2_id = auth.uid())
  );
$$;


-- ---------------------------------------------------------------------
-- 6. AUDIT TRIGGERS
--    History is written by the database, not the client, so it can never
--    be skipped or forged from the frontend.
-- ---------------------------------------------------------------------
create or replace function public.log_activity_insert()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.audit_logs (activity_id, space_id, user_id, action_type, details)
  values (new.id, new.space_id, new.created_by,
          'created',
          case when new.date_time is null
               then 'added the idea "' || new.title || '"'
               else 'created the plan "' || new.title || '"' end);

  -- Born with a date? That's also a scheduling event.
  if new.date_time is not null then
    insert into public.audit_logs (activity_id, space_id, user_id, action_type, details)
    values (new.id, new.space_id, new.created_by, 'scheduled',
            'set it for ' || to_char(new.date_time, 'Mon DD, YYYY at HH12:MI AM'));
  end if;

  return new;
end;
$$;

create or replace function public.log_activity_update()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  actor uuid := coalesce(auth.uid(), new.created_by);
begin
  -- Date transitions get their own semantic action types.
  if old.date_time is distinct from new.date_time then
    if old.date_time is null then
      insert into public.audit_logs (activity_id, space_id, user_id, action_type, details)
      values (new.id, new.space_id, actor, 'scheduled',
              'moved this onto the calendar for ' || to_char(new.date_time, 'Mon DD, YYYY at HH12:MI AM'));
    elsif new.date_time is null then
      insert into public.audit_logs (activity_id, space_id, user_id, action_type, details)
      values (new.id, new.space_id, actor, 'unscheduled',
              'sent this back to the bucket list');
    else
      insert into public.audit_logs (activity_id, space_id, user_id, action_type, details)
      values (new.id, new.space_id, actor, 'rescheduled',
              'moved it to ' || to_char(new.date_time, 'Mon DD, YYYY at HH12:MI AM'));
    end if;
  end if;

  if old.title is distinct from new.title then
    insert into public.audit_logs (activity_id, space_id, user_id, action_type, details)
    values (new.id, new.space_id, actor, 'edited',
            'renamed it to "' || new.title || '"');
  end if;

  if old.description is distinct from new.description then
    insert into public.audit_logs (activity_id, space_id, user_id, action_type, details)
    values (new.id, new.space_id, actor, 'edited', 'updated the notes');
  end if;

  if old.image_url is distinct from new.image_url then
    insert into public.audit_logs (activity_id, space_id, user_id, action_type, details)
    values (new.id, new.space_id, actor, 'edited', 'changed the cover');
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists activities_audit_insert on public.activities;
create trigger activities_audit_insert
  after insert on public.activities
  for each row execute function public.log_activity_insert();

drop trigger if exists activities_audit_update on public.activities;
create trigger activities_audit_update
  before update on public.activities
  for each row execute function public.log_activity_update();


-- ---------------------------------------------------------------------
-- 7. ROW LEVEL SECURITY
--    Both partners are equal admins inside their own space, and no one
--    outside the space can see a single row.
-- ---------------------------------------------------------------------
alter table public.profiles   enable row level security;
alter table public.spaces     enable row level security;
alter table public.activities enable row level security;
alter table public.audit_logs enable row level security;

-- profiles ------------------------------------------------------------
drop policy if exists "read own and partner profile" on public.profiles;
create policy "read own and partner profile" on public.profiles
  for select using (
    id = auth.uid()
    or exists (
      select 1 from public.spaces s
      where (s.partner_1_id = auth.uid() and s.partner_2_id = profiles.id)
         or (s.partner_2_id = auth.uid() and s.partner_1_id = profiles.id)
    )
  );

drop policy if exists "update own profile" on public.profiles;
create policy "update own profile" on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- spaces --------------------------------------------------------------
drop policy if exists "read own space" on public.spaces;
create policy "read own space" on public.spaces
  for select using (partner_1_id = auth.uid() or partner_2_id = auth.uid());

drop policy if exists "create own space" on public.spaces;
create policy "create own space" on public.spaces
  for insert with check (partner_1_id = auth.uid());

-- Lets partner 2 join via invite code, and either partner rename the space.
drop policy if exists "members update space" on public.spaces;
create policy "members update space" on public.spaces
  for update using (
    partner_1_id = auth.uid()
    or partner_2_id = auth.uid()
    or partner_2_id is null
  );

-- activities ----------------------------------------------------------
-- Equal rights by design: either partner may edit or delete anything.
drop policy if exists "members read activities" on public.activities;
create policy "members read activities" on public.activities
  for select using (public.is_space_member(space_id));

drop policy if exists "members insert activities" on public.activities;
create policy "members insert activities" on public.activities
  for insert with check (public.is_space_member(space_id) and created_by = auth.uid());

drop policy if exists "members update activities" on public.activities;
create policy "members update activities" on public.activities
  for update using (public.is_space_member(space_id))
  with check (public.is_space_member(space_id));

drop policy if exists "members delete activities" on public.activities;
create policy "members delete activities" on public.activities
  for delete using (public.is_space_member(space_id));

-- audit_logs ----------------------------------------------------------
-- Read-only from the client; only the triggers write here.
drop policy if exists "members read audit" on public.audit_logs;
create policy "members read audit" on public.audit_logs
  for select using (public.is_space_member(space_id));


-- ---------------------------------------------------------------------
-- 8. REALTIME
--    Adding the tables to the publication is what makes
--    supabase.channel(...).on('postgres_changes', ...) fire.
-- ---------------------------------------------------------------------
alter publication supabase_realtime add table public.activities;
alter publication supabase_realtime add table public.audit_logs;

-- REPLICA IDENTITY FULL so DELETE events carry the old row (we need
-- old.id on the client to remove the card from the board).
alter table public.activities replica identity full;
alter table public.audit_logs replica identity full;


-- ---------------------------------------------------------------------
-- 9. RPC: join a space with an invite code
-- ---------------------------------------------------------------------
create or replace function public.join_space(code text)
returns public.spaces
language plpgsql
security definer set search_path = public
as $$
declare
  target public.spaces;
begin
  select * into target from public.spaces where invite_code = code;

  if target.id is null then
    raise exception 'No space found for that invite code';
  end if;

  if target.partner_2_id is not null and target.partner_2_id <> auth.uid() then
    raise exception 'This space already has two partners';
  end if;

  if target.partner_1_id = auth.uid() then
    return target;
  end if;

  update public.spaces
     set partner_2_id = auth.uid()
   where id = target.id
  returning * into target;

  return target;
end;
$$;
