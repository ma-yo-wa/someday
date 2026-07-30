-- =====================================================================
--  OUR SPACE — Web Push infrastructure
--  Run AFTER schema.sql.
--
--  Shape of the thing:
--    device subscribes  ->  push_subscriptions row
--    partner edits      ->  trigger on activities
--    trigger            ->  pg_net async POST to an Edge Function
--    Edge Function      ->  signs with VAPID, POSTs to the push service
--
--  The trigger deliberately does NOT talk to the push service directly.
--  Postgres has no business doing ECDH key agreement, and a slow push
--  endpoint must never be able to hold a write transaction open.
-- =====================================================================

create extension if not exists pg_net with schema extensions;


-- ---------------------------------------------------------------------
-- 1. SUBSCRIPTIONS
--    One row per device per user. A person with a phone and a laptop
--    has two, and both should ring.
-- ---------------------------------------------------------------------
create table if not exists public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  space_id    uuid not null references public.spaces(id)   on delete cascade,
  endpoint    text not null unique,          -- the push service URL
  p256dh      text not null,                 -- client public key
  auth        text not null,                 -- client auth secret
  user_agent  text,
  created_at  timestamptz not null default now(),
  last_seen   timestamptz not null default now()
);

create index if not exists push_subs_user_idx  on public.push_subscriptions(user_id);
create index if not exists push_subs_space_idx on public.push_subscriptions(space_id);

alter table public.push_subscriptions enable row level security;

-- You may only ever see or touch your own devices.
drop policy if exists "own subscriptions" on public.push_subscriptions;
create policy "own subscriptions" on public.push_subscriptions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());


-- ---------------------------------------------------------------------
-- 2. PRIVATE CONFIG
--    The trigger needs the Edge Function URL and a service-role bearer
--    token. Both live in a schema with no API exposure and no policies,
--    so PostgREST cannot reach them at all.
--
--    In production prefer Supabase Vault:
--      select vault.create_secret('eyJ...', 'push_service_key');
--    and read it back with vault.decrypted_secrets.
-- ---------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from anon, authenticated;

create table if not exists private.app_config (
  key   text primary key,
  value text not null
);

-- Fill these in once (SQL editor runs as postgres, so this is allowed):
--   insert into private.app_config (key, value) values
--     ('push_fn_url',  'https://<project-ref>.supabase.co/functions/v1/push-fan-out'),
--     ('push_fn_key',  '<service-role-key>')
--   on conflict (key) do update set value = excluded.value;

create or replace function private.cfg(k text)
returns text
language sql
stable
security definer set search_path = private
as $$ select value from private.app_config where key = k $$;


-- ---------------------------------------------------------------------
-- 3. FAN-OUT TRIGGER
--    Fires on exactly two transitions, and never for the person who
--    caused it. Notifying someone about their own tap is the fastest way
--    to get notifications turned off for good.
--
--      a) date_time: NULL -> NOT NULL   =>  'scheduled'
--      b) description changed           =>  'notes'
-- ---------------------------------------------------------------------
create or replace function public.notify_partner()
returns trigger
language plpgsql
security definer set search_path = public, private, extensions
as $$
declare
  kind        text;
  actor       uuid := coalesce(auth.uid(), new.created_by);
  recipient   uuid;
  actor_name  text;
  fn_url      text := private.cfg('push_fn_url');
  fn_key      text := private.cfg('push_fn_key');
  title       text;
  body        text;
begin
  -- Which of the two events is this, if either?
  if (tg_op = 'INSERT' and new.date_time is not null)
     or (tg_op = 'UPDATE' and old.date_time is null and new.date_time is not null) then
    kind := 'scheduled';
  elsif tg_op = 'UPDATE'
        and new.description is distinct from old.description
        and coalesce(btrim(new.description), '') <> '' then
    kind := 'notes';
  else
    return new;   -- renames, covers, reschedules: not worth a buzz
  end if;

  -- Not configured yet? Silently no-op rather than failing the write.
  if fn_url is null or fn_key is null then
    return new;
  end if;

  -- The other partner is whoever isn't the actor.
  select case when s.partner_1_id = actor then s.partner_2_id else s.partner_1_id end
    into recipient
    from public.spaces s
   where s.id = new.space_id;

  if recipient is null then
    return new;   -- partner hasn't joined the space yet
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

  -- Async: net.http_post queues and returns immediately, so the user's
  -- write is never waiting on a push service round trip.
  perform extensions.net.http_post(
    url     := fn_url,
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'Authorization', 'Bearer ' || fn_key
               ),
    body    := jsonb_build_object(
                 'recipient_id', recipient,
                 'space_id',     new.space_id,
                 'activity_id',  new.id,
                 'kind',         kind,
                 'title',        title,
                 'body',         body
               ),
    timeout_milliseconds := 5000
  );

  return new;
end;
$$;

drop trigger if exists activities_notify_partner on public.activities;
create trigger activities_notify_partner
  after insert or update on public.activities
  for each row execute function public.notify_partner();


-- ---------------------------------------------------------------------
-- 4. HOUSEKEEPING
--    The Edge Function calls this when a push service replies 404/410,
--    which is how it tells you a device is gone for good.
-- ---------------------------------------------------------------------
create or replace function public.prune_subscription(dead_endpoint text)
returns void
language sql
security definer set search_path = public
as $$
  delete from public.push_subscriptions where endpoint = dead_endpoint;
$$;

revoke execute on function public.prune_subscription(text) from anon, authenticated;
