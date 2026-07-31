-- =====================================================================
--  006 — push when a partner adds a bucket idea or a dated plan
--
--  Until now only “locked in a date” and note edits buzzed. Adding
--  something to the shared space is the point of the app — ping them.
-- =====================================================================

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
  if tg_op = 'INSERT' and new.date_time is null then
    kind := 'idea';
  elsif (tg_op = 'INSERT' and new.date_time is not null)
     or (tg_op = 'UPDATE' and old.date_time is null and new.date_time is not null) then
    kind := 'scheduled';
  elsif tg_op = 'UPDATE'
        and new.description is distinct from old.description
        and coalesce(btrim(new.description), '') <> '' then
    kind := 'notes';
  else
    return new;   -- renames, covers, reschedules: not worth a buzz
  end if;

  select case when s.partner_1_id = actor then s.partner_2_id else s.partner_1_id end
    into recipient
    from public.spaces s
   where s.id = new.space_id;

  if recipient is null then
    return new;   -- partner hasn't joined the space yet
  end if;

  select display_name into actor_name from public.profiles where id = actor;
  actor_name := coalesce(actor_name, 'Your partner');

  if kind = 'idea' then
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
