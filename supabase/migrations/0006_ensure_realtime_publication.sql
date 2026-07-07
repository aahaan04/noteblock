-- Guarantees queue_items and venues are actually part of the
-- supabase_realtime publication that postgres_changes subscriptions rely on.
--
-- This has always been configured via the dashboard's Database > Replication
-- toggle rather than in a migration, so it was never guaranteed by version
-- control. If either table was ever left out (or dropped from the
-- publication by an unrelated dashboard change), every postgres_changes
-- listener for that table — including the guest Now Playing subscription —
-- would silently receive nothing, with no error surfaced anywhere.
--
-- Idempotent: safe to run even if both tables are already members.
--
-- Run this in the Supabase SQL Editor.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'queue_items'
  ) then
    alter publication supabase_realtime add table public.queue_items;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'venues'
  ) then
    alter publication supabase_realtime add table public.venues;
  end if;
end $$;
