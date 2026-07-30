-- =====================================================================
--  001 — multi-day plans, plus two fixes to the original schema
--
--  Safe to run on a database that already has schema.sql applied, and
--  safe to run twice.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Plans can span days
--
--    date_time stays the start, so nothing that reads it today changes
--    and no existing row needs migrating. ends_at null means "one day",
--    which is almost every plan.
-- ---------------------------------------------------------------------
alter table public.activities
  add column if not exists ends_at timestamptz;

-- A plan can't finish before it starts, and a bucket-list item can't
-- have an end at all — it has no beginning to measure from.
alter table public.activities
  drop constraint if exists activities_span_valid;
alter table public.activities
  add constraint activities_span_valid check (
    ends_at is null
    or (date_time is not null and ends_at >= date_time)
  );

-- The calendar asks "what overlaps this month", which without this index
-- is a sequential scan over the whole space once a couple has a few
-- years of history.
create index if not exists activities_span_idx
  on public.activities(space_id, date_time, ends_at)
  where date_time is not null;


-- ---------------------------------------------------------------------
-- 2. History for the end date
--
--    Rewritten rather than patched: the original only watched date_time,
--    so stretching a plan across three days left no trace in the
--    timeline even though it's exactly the kind of change the other
--    person wants to know about.
-- ---------------------------------------------------------------------
create or replace function public.log_activity_update()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  actor uuid := coalesce(auth.uid(), new.created_by);
begin
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

  if old.ends_at is distinct from new.ends_at then
    insert into public.audit_logs (activity_id, space_id, user_id, action_type, details)
    values (new.id, new.space_id, actor, 'rescheduled',
            case when new.ends_at is null
                 then 'made it a single day'
                 else 'made it run until ' || to_char(new.ends_at, 'Mon DD, YYYY') end);
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

  -- Unscheduling takes the span with it, so a bucket-list item can never
  -- keep a stale end date.
  if new.date_time is null then
    new.ends_at := null;
  end if;

  new.updated_at := now();
  return new;
end;
$$;


-- ---------------------------------------------------------------------
-- 3. FIX: the space update policy was open to any signed-in user
--
--    The original allowed UPDATE when `partner_2_id is null`, with no
--    further qualification — so anyone with an account could write to
--    any space that hadn't been joined yet, including making themselves
--    partner 2 without ever seeing an invite code. Only the space id
--    stood in the way, and an id is not a secret.
--
--    Joining runs through join_space(), which is SECURITY DEFINER and
--    bypasses RLS on its own, so that clause bought nothing.
-- ---------------------------------------------------------------------
drop policy if exists "members update space" on public.spaces;
create policy "members update space" on public.spaces
  for update using (
    partner_1_id = auth.uid()
    or partner_2_id = auth.uid()
  )
  with check (
    partner_1_id = auth.uid()
    or partner_2_id = auth.uid()
  );

-- Leaving a space you were invited into. Deleting is partner 1's alone.
drop policy if exists "owner deletes space" on public.spaces;
create policy "owner deletes space" on public.spaces
  for delete using (partner_1_id = auth.uid());


-- ---------------------------------------------------------------------
-- 4. Seeing who invited you, before you've accepted
--
--    The profiles policy only lets you read someone once you're already
--    partners, which makes the one screen where a name matters most —
--    "Mayowa wants to share a space with you" — impossible to render.
--    This returns the inviter's name and nothing else, and only to
--    somebody holding a valid code.
-- ---------------------------------------------------------------------
create or replace function public.peek_invite(code text)
returns table (space_id uuid, space_name text, inviter_name text, is_open boolean)
language sql
stable
security definer set search_path = public
as $$
  select s.id,
         s.name,
         p.display_name,
         s.partner_2_id is null
    from public.spaces s
    join public.profiles p on p.id = s.partner_1_id
   where s.invite_code = code;
$$;

revoke all on function public.peek_invite(text) from public;
grant execute on function public.peek_invite(text) to anon, authenticated;


-- ---------------------------------------------------------------------
-- 5. Joining, with the empty-space self-heal
--
--    If you signed up cold before opening the invite, you already have a
--    space of your own. When it's empty there is nothing to decide, so
--    it's dropped and you're moved across without being asked. When it
--    isn't, this refuses and the client asks what you want to do with
--    the things you've already added.
-- ---------------------------------------------------------------------
create or replace function public.join_space(code text)
returns public.spaces
language plpgsql
security definer set search_path = public
as $$
declare
  target public.spaces;
  mine   public.spaces;
  mine_count int;
begin
  select * into target from public.spaces where invite_code = code;

  if target.id is null then
    raise exception 'No space found for that invite code'
      using errcode = 'no_data_found';
  end if;

  if target.partner_1_id = auth.uid() then
    return target;                        -- your own link
  end if;

  if target.partner_2_id = auth.uid() then
    return target;                        -- already joined; tapping twice is fine
  end if;

  if target.partner_2_id is not null then
    raise exception 'This space already has two people in it'
      using errcode = 'card_error';
  end if;

  -- Anything of your own standing in the way?
  select * into mine
    from public.spaces
   where partner_1_id = auth.uid()
   limit 1;

  if mine.id is not null then
    select count(*) into mine_count from public.activities where space_id = mine.id;

    if mine_count > 0 or mine.partner_2_id is not null then
      raise exception 'You already have a space with things in it'
        using errcode = 'integrity_constraint_violation';
    end if;

    delete from public.spaces where id = mine.id;
  end if;

  update public.spaces
     set partner_2_id = auth.uid()
   where id = target.id
  returning * into target;

  return target;
end;
$$;


-- ---------------------------------------------------------------------
-- 6. Moving your things across, for the case above where we had to ask
-- ---------------------------------------------------------------------
create or replace function public.join_space_bringing_items(code text)
returns public.spaces
language plpgsql
security definer set search_path = public
as $$
declare
  target public.spaces;
  mine   public.spaces;
begin
  select * into target from public.spaces where invite_code = code;
  if target.id is null then
    raise exception 'No space found for that invite code'
      using errcode = 'no_data_found';
  end if;
  if target.partner_2_id is not null and target.partner_2_id <> auth.uid() then
    raise exception 'This space already has two people in it'
      using errcode = 'card_error';
  end if;

  select * into mine from public.spaces where partner_1_id = auth.uid() limit 1;

  if mine.id is not null and mine.id <> target.id then
    update public.activities set space_id = target.id where space_id = mine.id;
    update public.audit_logs  set space_id = target.id where space_id = mine.id;
    delete from public.spaces where id = mine.id;
  end if;

  update public.spaces
     set partner_2_id = auth.uid()
   where id = target.id and partner_2_id is null
  returning * into target;

  select * into target from public.spaces where invite_code = code;
  return target;
end;
$$;


-- ---------------------------------------------------------------------
-- 7. Signing up creates your space, so the client never has to
--
--    One less round trip, and no window where you're signed in with
--    nowhere to put anything.
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  name text;
begin
  name := coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1));

  insert into public.profiles (id, display_name)
  values (new.id, name)
  on conflict (id) do nothing;

  insert into public.spaces (partner_1_id, name)
  values (new.id, 'Someday');

  return new;
end;
$$;
