-- =====================================================================
--  005 — location on imported calendar overlays
-- =====================================================================

alter table public.external_events
  add column if not exists location text;
