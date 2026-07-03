-- Adds a thumbnail column for the currently-playing Vibe Mode track, so guests
-- see a real YouTube thumbnail instead of a placeholder icon when Vibe Mode is
-- playing (previously only title/channel were stored — no image at all).
-- Also adds a channel/artist column to banned_songs, so the host UI can show
-- who a banned song is by (the data is already available from the YouTube
-- search result at ban-time — it just wasn't being persisted).
-- Run this in the Supabase SQL Editor.

alter table public.venues add column if not exists vibe_now_playing_thumbnail text;
alter table public.banned_songs add column if not exists channel text;
