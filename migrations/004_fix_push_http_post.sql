-- =====================================================================
--  004 — fix push enqueue so adding plans isn’t blocked
--
--  `extensions.net.http_post` is parsed as a cross-database reference
--  and aborts the activity INSERT. pg_net’s function is `net.http_post`.
--  Also swallow push errors so a broken notify path never blocks writes.
-- =====================================================================

create extension if not exists pg_net with schema extensions;

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
security definer set search_path = private, net, extensions, public
as $$
declare
  fn_url text := private.cfg('push_fn_url');
  fn_key text := private.cfg('push_fn_key');
begin
  if recipient is null or fn_url is null or fn_key is null then
    return;
  end if;

  begin
    perform net.http_post(
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
  exception
    when others then
      -- Never fail the user-facing write because push is down.
      raise warning 'enqueue_push failed: %', sqlerrm;
  end;
end;
$$;
