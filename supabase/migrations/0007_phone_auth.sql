-- Adds phone-number based auth alongside the existing email column (kept,
-- never dropped, for reference on old accounts). Purely additive: no
-- existing column, RLS policy, or trigger is removed. handle_new_user is
-- untouched — it already tolerates a null email (phone-only signups), since
-- display_name/role both fall back safely when email is null.
--
-- Run this in the Supabase SQL Editor.

alter table public.users add column if not exists phone_number text unique;
alter table public.users add column if not exists phone_verified boolean not null default false;
