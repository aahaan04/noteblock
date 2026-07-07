-- Removes the "Allow queuing while jukebox is off" feature. It was added for
-- a one-time event and is no longer needed — pausing the jukebox now always
-- blocks guest requests, with no exceptions.
--
-- The column is a plain boolean with no foreign keys or dependent rows, so
-- dropping it is safe regardless of how many venues currently have it set to
-- true — those venues simply lose the (now unconditional) exception and
-- behave like every other paused venue going forward. No data migration or
-- backfill is needed.
--
-- Run this in the Supabase SQL Editor.

alter table public.venues drop column if exists queue_open_when_paused;
