-- Security + identity hardening.
-- Run this in the Supabase SQL Editor.
-- Safe to re-run: every statement is idempotent (drop-if-exists / create-or-replace /
-- if-not-exists), matching the convention of every prior migration in this folder.

-- ─────────────────────────────────────────────
-- 1. Lock down the credit/queue RPC functions to the backend only.
--
-- request_song, grant_welcome_credits, gift_credits, and refund_credits are all
-- `security definer` (they bypass RLS by design) and are called ONLY by the
-- backend's service-role client (supabaseAdmin) everywhere in this codebase —
-- confirmed by grepping every `.rpc(...)` call site. Supabase grants EXECUTE on
-- new public-schema functions to `anon`/`authenticated` by default, which means
-- anyone holding the (publicly-shipped) anon key can currently call these
-- directly via PostgREST's /rest/v1/rpc/<fn> endpoint, entirely bypassing the
-- Express layer's own authorization checks — e.g. refund_credits(my_own_id,
-- 999999) mints unlimited free credits with no caller check at all.
--
-- Migration 0002 already closed this exact class of gap for direct table
-- writes (queue_insert_any, transactions_insert_any, users_update_own). This
-- closes the same gap for the RPC layer, which was missed at the time.
--
-- Note: we do NOT add internal auth.uid() = p_user_id checks inside these
-- functions. The backend deliberately calls them via the service-role key to
-- act on an ARBITRARY user's behalf (Express has already verified the caller's
-- authorization before invoking them) — the service-role JWT has no bound
-- auth.uid(), so such a check would break every legitimate call. Revoking
-- EXECUTE from anon/authenticated (and never granting it to them) is the
-- correct boundary: only the trusted backend may call these at all.
--
-- IMPORTANT: `create or replace function` only replaces a function whose
-- argument-type list matches EXACTLY — a different parameter list creates a
-- separate overload instead of actually replacing anything. Migration 0004
-- already changed request_song's signature this way (added p_channel),
-- which means the ORIGINAL 8-argument request_song from schema.sql / 0001
-- almost certainly still exists in the live database right now, still with
-- its default EXECUTE grant to anon/authenticated intact and completely
-- unaffected by the revoke below (which only names the 9-argument version).
-- Explicitly dropping the stale overload first closes that gap. The
-- database's actual current function list can drift from what any single
-- migration file implies — if the drop below reports "does not exist",
-- that's fine (it was already gone); if a revoke below errors with
-- "function does not exist", check pg_proc for what overloads are actually
-- present and adjust the signature accordingly before re-running.
drop function if exists public.request_song(uuid, uuid, text, text, text, text, text, integer);

revoke execute on function public.request_song(uuid, uuid, text, text, text, text, text, integer, text) from anon, authenticated;
revoke execute on function public.grant_welcome_credits(uuid, uuid) from anon, authenticated;
revoke execute on function public.refund_credits(uuid, integer, text) from anon, authenticated;

-- ─────────────────────────────────────────────
-- 2. gift_credits — same lockdown, plus a new optional p_guest_user_id
--    parameter so the backend can target a specific account directly instead
--    of the fragile email/display_name lookup (see banned_users.user_id
--    below for the matching identity problem this also affects).
--
--    Same overload trap as above: adding p_guest_user_id makes this a
--    different signature from the existing 4-argument gift_credits, so the
--    old one must be dropped explicitly or it would silently keep existing
--    (and keep being directly callable) alongside the new one.
-- ─────────────────────────────────────────────
drop function if exists public.gift_credits(uuid, text, integer, uuid);

create or replace function public.gift_credits(
  p_host_id uuid,
  p_guest_identifier text,
  p_amount integer,
  p_venue_id uuid,
  p_guest_user_id uuid default null
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

  -- Prefer the caller-supplied account id (stable, not editable by the
  -- guest) over the old name/email lookup (a guest can rename themselves to
  -- intercept a gift intended for someone else). Falls back to the old
  -- lookup only when no id is supplied, for backward compatibility.
  if p_guest_user_id is not null then
    select id into v_guest_id from public.users where id = p_guest_user_id;
  else
    select id into v_guest_id
    from public.users
    where email = p_guest_identifier or display_name = p_guest_identifier
    limit 1;
  end if;

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

revoke execute on function public.gift_credits(uuid, text, integer, uuid, uuid) from anon, authenticated;

-- ─────────────────────────────────────────────
-- 3. request_song — fold the "already queued" duplicate check into the same
--    transaction as the credit-deduction row lock, instead of Express doing
--    a separate, non-atomic pre-check before calling this RPC. Two concurrent
--    requests for the same user+song (e.g. a double-tap across two tabs) both
--    used to pass the pre-check before either had inserted, double-charging
--    and double-queuing the same song. Because this now runs after the
--    `for update` lock on the user's own row, concurrent calls for the SAME
--    user serialize on that lock — the second call only proceeds once the
--    first has committed its insert, so its duplicate check correctly sees it.
-- ─────────────────────────────────────────────
create or replace function public.request_song(
  p_venue_id uuid,
  p_user_id uuid,
  p_youtube_video_id text,
  p_song_title text,
  p_thumbnail_url text,
  p_requester_name text,
  p_play_type text,
  p_credits_to_charge integer,
  p_channel text default null
) returns json
language plpgsql security definer as $$
declare
  v_user_credits integer;
  v_queue_item_id uuid;
  v_banned boolean;
  v_venue_status text;
  v_duplicate boolean;
begin
  -- Check venue is active
  select status into v_venue_status from public.venues where id = p_venue_id;
  if v_venue_status != 'active' then
    return json_build_object('success', false, 'error', 'venue_closed');
  end if;

  -- Check song not banned
  select exists(
    select 1 from public.banned_songs
    where venue_id = p_venue_id and youtube_video_id = p_youtube_video_id
  ) into v_banned;
  if v_banned then
    return json_build_object('success', false, 'error', 'song_banned');
  end if;

  -- Check and deduct credits for logged-in users. The row lock below is also
  -- what makes the duplicate check race-free for concurrent same-user calls.
  if p_user_id is not null and p_credits_to_charge > 0 then
    select credits_balance into v_user_credits
    from public.users where id = p_user_id for update;

    if v_user_credits < p_credits_to_charge then
      return json_build_object('success', false, 'error', 'insufficient_credits');
    end if;
  end if;

  if p_user_id is not null then
    select exists(
      select 1 from public.queue_items
      where venue_id = p_venue_id and user_id = p_user_id
        and youtube_video_id = p_youtube_video_id
        and status in ('pending', 'playing')
    ) into v_duplicate;
    if v_duplicate then
      return json_build_object('success', false, 'error', 'already_queued');
    end if;
  end if;

  if p_user_id is not null and p_credits_to_charge > 0 then
    update public.users
    set credits_balance = credits_balance - p_credits_to_charge
    where id = p_user_id;

    insert into public.credit_transactions
      (user_id, amount, type, description)
    values
      (p_user_id, -p_credits_to_charge, 'spend', 'Song: ' || p_song_title);
  end if;

  -- Insert queue item
  insert into public.queue_items
    (venue_id, user_id, youtube_video_id, song_title, thumbnail_url,
     requester_name, play_type, credits_charged, channel)
  values
    (p_venue_id, p_user_id, p_youtube_video_id, p_song_title, p_thumbnail_url,
     p_requester_name, p_play_type, p_credits_to_charge, p_channel)
  returning id into v_queue_item_id;

  return json_build_object('success', true, 'queue_item_id', v_queue_item_id);
end;
$$;

revoke execute on function public.request_song(uuid, uuid, text, text, text, text, text, integer, text) from anon, authenticated;

-- ─────────────────────────────────────────────
-- 4. Tighten venues/queue_items public read policies. These were `using
--    (true)` — readable by literally anyone, including a client with no
--    session at all — which isn't needed: every real reader is either the
--    Express backend (service role, bypasses RLS entirely, unaffected by
--    this) or a realtime `postgres_changes` subscriber, and every guest and
--    host in this app now holds a genuine authenticated session (phone OTP
--    is required to reach either GuestRoom or HostDashboard/VenueControl).
--    Requiring auth.uid() is not null still allows every legitimate
--    subscriber through unchanged, while raising the bar on bulk scraping of
--    other venues'/guests' row data to "needs a real verified-phone account"
--    instead of "needs nothing at all".
-- ─────────────────────────────────────────────
drop policy if exists "venues_public_read" on public.venues;
create policy "venues_public_read" on public.venues for select using (auth.uid() is not null);

drop policy if exists "queue_public_read" on public.queue_items;
create policy "queue_public_read" on public.queue_items for select using (auth.uid() is not null);

-- ─────────────────────────────────────────────
-- 5. banned_users gains a stable user_id, so a ban survives the banned guest
--    simply editing their own display_name (the only identity the ban
--    previously matched on). requester_name is kept for existing rows / the
--    host-facing UI; user_id is populated going forward whenever the backend
--    can resolve one for the name being banned.
-- ─────────────────────────────────────────────
alter table public.banned_users add column if not exists user_id uuid references public.users(id) on delete cascade;

create unique index if not exists banned_users_venue_user_uidx
  on public.banned_users(venue_id, user_id) where user_id is not null;

-- ─────────────────────────────────────────────
-- 6. queue_items gains started_playing_at, set whenever a queue item
--    transitions to 'playing' (see the backend PATCH route). Without this,
--    there is no way to tell "genuinely still playing" apart from "the host
--    closed the tab mid-song and this row is permanently orphaned at
--    status='playing'" — requested_at is when the song was REQUESTED, not
--    when it actually started, so it can't be used for this.
-- ─────────────────────────────────────────────
alter table public.queue_items add column if not exists started_playing_at timestamptz;
