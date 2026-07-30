-- =====================================================================
--  002 — notify the waiting partner when the invite seat fills
--
--  Safe to run on a database that already has push.sql applied, and
--  safe to run twice.
-- =====================================================================

create or replace function private.enqueue_push(
  recipient uuid,
  space_id  uuid,
  kind      text,
  title     text,
  body      text,
  activity  uuid default null
)
returns void
language plpgsql
security definer set search_path = private, extensions
as $$
declare
  fn_url text := private.cfg('push_fn_url');
  fn_key text := private.cfg('push_fn_key');
begin
  if recipient is null or fn_url is null or fn_key is null then
    return;
  end if;

  perform extensions.net.http_post(
    url     := fn_url,
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'Authorization', 'Bearer ' || fn_key
               ),
    body    := jsonb_build_object(
                 'recipient_id', recipient,
                 'space_id',     space_id,
                 'activity_id',  activity,
                 'kind',         kind,
                 'title',        title,
                 'body',         body
               ),
    timeout_milliseconds := 5000
  );
end;
$$;

-- Keep the activity trigger on the shared enqueue path (idempotent).
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
  if (tg_op = 'INSERT' and new.date_time is not null)
     or (tg_op = 'UPDATE' and old.date_time is null and new.date_time is not null) then
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
  actor_name := coalesce(actor_name, 'Your partner');

  if kind = 'scheduled' then
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

create or replace function public.notify_partner_joined()
returns trigger
language plpgsql
security definer set search_path = public, private
as $$
declare
  joiner_name text;
begin
  if not (old.partner_2_id is null and new.partner_2_id is not null) then
    return new;
  end if;

  select display_name into joiner_name from public.profiles where id = new.partner_2_id;
  joiner_name := coalesce(joiner_name, 'Your partner');

  perform private.enqueue_push(
    new.partner_1_id,
    new.id,
    'joined',
    joiner_name || ' joined your space',
    'You’re both in. Plans and the bucket list are shared now.'
  );

  return new;
end;
$$;

drop trigger if exists spaces_notify_partner_joined on public.spaces;
create trigger spaces_notify_partner_joined
  after update of partner_2_id on public.spaces
  for each row execute function public.notify_partner_joined();
