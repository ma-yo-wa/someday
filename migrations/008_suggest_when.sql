-- =====================================================================
--  008 — suggest a when without locking it in
--
--  Either person can propose a date/time (optional reason). The other
--  Accepts, Dismisses, or Suggests something else. One pending
--  suggestion per activity — not a chat thread.
-- =====================================================================

alter table public.activities
  add column if not exists suggested_date_time timestamptz,
  add column if not exists suggested_ends_at   timestamptz,
  add column if not exists suggested_all_day   boolean not null default false,
  add column if not exists suggested_by        uuid references public.profiles(id) on delete set null,
  add column if not exists suggested_at        timestamptz,
  add column if not exists suggested_note      text;

alter table public.audit_logs drop constraint if exists audit_logs_action_type_check;
alter table public.audit_logs add constraint audit_logs_action_type_check
  check (action_type in (
    'created',
    'scheduled',
    'rescheduled',
    'unscheduled',
    'edited',
    'deleted',
    'suggested',
    'suggestion_accepted',
    'suggestion_dismissed'
  ));


-- ---------------------------------------------------------------------
-- Audit: suggestion set / accepted / dismissed
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
      -- Accepting a suggestion is the story; skip the generic reschedule line.
      if not (
        old.suggested_date_time is not null
        and new.suggested_date_time is null
        and new.date_time is not distinct from old.suggested_date_time
      ) then
        insert into public.audit_logs (activity_id, space_id, user_id, action_type, details)
        values (new.id, new.space_id, actor, 'rescheduled',
                'moved it to ' || to_char(new.date_time, 'Mon DD, YYYY at HH12:MI AM'));
      end if;
    end if;
  end if;

  if old.ends_at is distinct from new.ends_at
     and not (
       old.suggested_date_time is not null
       and new.suggested_date_time is null
       and new.date_time is not distinct from old.suggested_date_time
     ) then
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

  -- Suggestion proposed or replaced.
  if new.suggested_date_time is not null
     and new.suggested_by is not null
     and (
       old.suggested_date_time is distinct from new.suggested_date_time
       or old.suggested_by is distinct from new.suggested_by
       or old.suggested_ends_at is distinct from new.suggested_ends_at
     ) then
    insert into public.audit_logs (activity_id, space_id, user_id, action_type, details)
    values (
      new.id, new.space_id, new.suggested_by, 'suggested',
      'suggested ' ||
        case when new.suggested_all_day
             then to_char(new.suggested_date_time, 'Mon DD, YYYY')
             else to_char(new.suggested_date_time, 'Mon DD, YYYY at HH12:MI AM')
        end
    );
  end if;

  -- Suggestion cleared.
  if old.suggested_date_time is not null and new.suggested_date_time is null then
    if new.date_time is not distinct from old.suggested_date_time
       and new.date_time is distinct from old.date_time then
      insert into public.audit_logs (activity_id, space_id, user_id, action_type, details)
      values (new.id, new.space_id, actor, 'suggestion_accepted',
              'accepted the suggested time');
    elsif new.date_time is not distinct from old.date_time
          and new.ends_at is not distinct from old.ends_at then
      insert into public.audit_logs (activity_id, space_id, user_id, action_type, details)
      values (
        new.id, new.space_id, actor, 'suggestion_dismissed',
        case when actor is not distinct from old.suggested_by
             then 'cancelled the suggestion'
             else 'dismissed the suggestion'
        end
      );
    end if;
    -- else: date changed to something else (Change the date) — reschedule covers it
  end if;

  if new.date_time is null then
    new.ends_at := null;
    new.suggested_date_time := null;
    new.suggested_ends_at := null;
    new.suggested_by := null;
    new.suggested_at := null;
    new.suggested_all_day := false;
    new.suggested_note := null;
  end if;

  new.updated_at := now();
  return new;
end;
$$;


-- ---------------------------------------------------------------------
-- Push: suggested + accepted (no buzz for dismiss/cancel)
-- ---------------------------------------------------------------------
create or replace function public.notify_partner()
returns trigger
language plpgsql
security definer set search_path = public, private
as $$
declare
  kind        text;
  actor       uuid := coalesce(auth.uid(), new.created_by);
  recipient   uuid;
  actor_name  text;
  title       text;
  body        text;
begin
  if tg_op = 'UPDATE'
     and new.suggested_date_time is not null
     and new.suggested_by is not null
     and (
       old.suggested_date_time is distinct from new.suggested_date_time
       or old.suggested_by is distinct from new.suggested_by
       or old.suggested_ends_at is distinct from new.suggested_ends_at
     ) then
    kind := 'suggested';
    actor := new.suggested_by;
  elsif tg_op = 'UPDATE'
        and old.suggested_date_time is not null
        and new.suggested_date_time is null
        and new.date_time is not distinct from old.suggested_date_time
        and new.date_time is distinct from old.date_time then
    kind := 'suggestion_accepted';
  elsif tg_op = 'INSERT' and new.date_time is null then
    kind := 'idea';
  elsif (tg_op = 'INSERT' and new.date_time is not null)
     or (tg_op = 'UPDATE' and old.date_time is null and new.date_time is not null
         and not (old.suggested_date_time is not null
                  and new.date_time is not distinct from old.suggested_date_time)) then
    kind := 'scheduled';
  elsif tg_op = 'UPDATE'
        and new.description is distinct from old.description
        and coalesce(btrim(new.description), '') <> '' then
    kind := 'notes';
  else
    return new;
  end if;

  select case when s.partner_1_id = actor then s.partner_2_id else s.partner_1_id end
    into recipient
    from public.spaces s
   where s.id = new.space_id;

  if recipient is null then
    return new;
  end if;

  select display_name into actor_name from public.profiles where id = actor;
  actor_name := coalesce(actor_name, 'Someone');

  if kind = 'suggested' then
    title := '💬 ' || actor_name || ' suggested a new time for ' || new.title;
    body  := case
               when coalesce(btrim(new.suggested_note), '') <> '' then left(new.suggested_note, 120)
               when new.suggested_all_day
                 then to_char(new.suggested_date_time at time zone 'UTC', 'Dy, Mon DD')
               else to_char(new.suggested_date_time at time zone 'UTC', 'Dy, Mon DD')
                    || ' at ' || to_char(new.suggested_date_time at time zone 'UTC', 'HH12:MI AM')
             end;
  elsif kind = 'suggestion_accepted' then
    title := '✅ ' || actor_name || ' accepted your time for ' || new.title;
    body  := case when new.all_day
                  then to_char(new.date_time at time zone 'UTC', 'Dy, Mon DD')
                  else to_char(new.date_time at time zone 'UTC', 'Dy, Mon DD')
                       || ' at ' || to_char(new.date_time at time zone 'UTC', 'HH12:MI AM')
             end;
  elsif kind = 'idea' then
    title := '💡 ' || actor_name || ' added “' || new.title || '” to the bucket';
    body  := case
               when coalesce(btrim(new.description), '') <> '' then left(new.description, 120)
               else 'Open Someday when you’re free'
             end;
  elsif kind = 'scheduled' then
    title := '📅 ' || actor_name || ' locked in a date for ' || new.title || '!';
    body  := to_char(new.date_time at time zone 'UTC', 'Dy, Mon DD')
             || case when new.all_day then '' else ' at ' ||
                  to_char(new.date_time at time zone 'UTC', 'HH12:MI AM') end;
  else
    title := '✏️ ' || actor_name || ' updated the notes for ' || new.title || '.';
    body  := left(new.description, 120);
  end if;

  perform private.enqueue_push(recipient, new.space_id, kind, title, body, new.id);
  return new;
end;
$$;
