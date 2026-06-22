-- Migration 0001 — credit atomicity, refunds, and Mandarin support
-- Run this once in the Supabase SQL Editor against the existing database.
-- Safe to re-run: every statement is idempotent (drop-if-exists / create-or-replace).

-- ─────────────────────────────────────────────
-- 1. Allow Mandarin ('zh') as a profile language
--    (the app already offers it; without this, saving a zh profile fails)
-- ─────────────────────────────────────────────
alter table public.users drop constraint if exists users_language_check;
alter table public.users
  add constraint users_language_check check (language in ('en', 'hi', 'zh'));

-- ─────────────────────────────────────────────
-- 2. Allow 'refund' credit transactions
-- ─────────────────────────────────────────────
alter table public.credit_transactions drop constraint if exists credit_transactions_type_check;
alter table public.credit_transactions
  add constraint credit_transactions_type_check
  check (type in ('purchase', 'gift', 'spend', 'welcome', 'refund'));

-- ─────────────────────────────────────────────
-- 3. Atomic credit refund (used when a host removes a pending request)
--    Adds credits in a single UPDATE so it can't lose a concurrent charge.
-- ─────────────────────────────────────────────
create or replace function refund_credits(
  p_user_id uuid,
  p_amount integer,
  p_reason text default 'Refund'
) returns json
language plpgsql security definer as $$
declare
  v_new_balance integer;
begin
  if p_user_id is null or p_amount is null or p_amount <= 0 then
    return json_build_object('success', false, 'error', 'invalid_args');
  end if;

  update public.users
  set credits_balance = credits_balance + p_amount
  where id = p_user_id
  returning credits_balance into v_new_balance;

  if v_new_balance is null then
    return json_build_object('success', false, 'error', 'user_not_found');
  end if;

  insert into public.credit_transactions (user_id, amount, type, description)
  values (p_user_id, p_amount, 'refund', p_reason);

  return json_build_object('success', true, 'new_balance', v_new_balance);
end;
$$;

-- ─────────────────────────────────────────────
-- 4. Ensure the atomic gift function exists (the gift route now relies on it
--    instead of a non-atomic read-modify-write).
-- ─────────────────────────────────────────────
create or replace function gift_credits(
  p_host_id uuid,
  p_guest_identifier text,
  p_amount integer,
  p_venue_id uuid
) returns json
language plpgsql security definer as $$
declare
  v_guest_id uuid;
begin
  if not exists (
    select 1 from public.venues where id = p_venue_id and host_id = p_host_id
  ) then
    return json_build_object('success', false, 'error', 'unauthorized');
  end if;

  -- Match a signed-in user by email or display_name (limit 1 handles duplicates)
  select id into v_guest_id
  from public.users
  where email = p_guest_identifier or display_name = p_guest_identifier
  limit 1;

  if v_guest_id is null then
    return json_build_object('success', false, 'error', 'guest_not_found');
  end if;

  update public.users
  set credits_balance = credits_balance + p_amount
  where id = v_guest_id;

  insert into public.credit_transactions (user_id, amount, type, description)
  values (v_guest_id, p_amount, 'gift', 'Gift from host');

  return json_build_object('success', true, 'guest_id', v_guest_id);
end;
$$;
