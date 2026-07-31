-- =====================================================================
--  005 — location + description on imported calendar overlays
-- =====================================================================

alter table public.external_events
  add column if not exists location text;

alter table public.external_events
  add column if not exists description text;
