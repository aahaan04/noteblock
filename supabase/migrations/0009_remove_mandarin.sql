-- Removes Mandarin ('zh') as a supported profile language. The app no
-- longer offers it anywhere (locale file removed, language selectors no
-- longer list it, backend validation no longer accepts it) — this closes
-- the loop at the database level too.
-- Run this in the Supabase SQL Editor.
-- Safe to re-run: the update is a no-op once no rows match, and the
-- constraint swap is drop-if-exists / add.

-- Any existing account still saved as 'zh' would already silently render in
-- English (the frontend falls back to English for any language it doesn't
-- recognize) — this just makes that authoritative in the data too, rather
-- than leaving an unreachable value sitting on the row.
update public.users set language = 'en' where language = 'zh';

alter table public.users drop constraint if exists users_language_check;
alter table public.users
  add constraint users_language_check check (language in ('en', 'hi'));
