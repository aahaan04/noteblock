-- Venue Vibe File system: per-venue aggregate stats about what music keeps
-- that venue's crowd engaged, downloadable/uploadable/reusable across venues,
-- and selectable as a Vibe Mode source alongside the existing manual
-- description / playlist URL options.
--
-- Everything here is additive. No existing table, column, RLS policy, or
-- stored procedure behavior is changed for existing callers — request_song()
-- gains one new trailing parameter with a default value, so callers that
-- don't pass it behave exactly as before.
--
-- Run this in the Supabase SQL Editor.

-- ─────────────────────────────────────────────
-- 1. New columns
-- ─────────────────────────────────────────────

-- Which channel (artist) a queued song came from — same gap as the earlier
-- vibe-thumbnail / banned-songs-channel fixes: the data is already available
-- on the client at request time, it just wasn't being persisted.
alter table public.queue_items add column if not exists channel text;

-- Which Vibe Mode source is active for a venue. The existing vibe_description
-- and vibe_playlist_urls columns are untouched and keep working exactly as
-- before regardless of this value — it's purely a selector.
alter table public.venues add column if not exists vibe_source text
  check (vibe_source in ('description', 'playlist', 'upload', 'auto'))
  not null default 'description';

-- An uploaded vibe file, kept entirely separate from the venue's own
-- auto-generated venue_vibe_data row below — uploading never overwrites a
-- venue's own collected data.
alter table public.venues add column if not exists uploaded_vibe_data jsonb;
alter table public.venues add column if not exists uploaded_vibe_filename text;
alter table public.venues add column if not exists uploaded_vibe_uploaded_at timestamptz;

-- ─────────────────────────────────────────────
-- 2. venue_vibe_data table
-- ─────────────────────────────────────────────

create table if not exists public.venue_vibe_data (
  id uuid default uuid_generate_v4() primary key,
  venue_id uuid references public.venues(id) on delete cascade not null unique,
  generated_at timestamptz not null default now(),
  total_requests_alltime integer not null default 0,
  total_unique_songs_alltime integer not null default 0,
  vibe_ready boolean not null default false,
  top_songs_alltime jsonb not null default '[]'::jsonb,
  top_songs_last_30_days jsonb not null default '[]'::jsonb,
  genre_breakdown jsonb not null default '{}'::jsonb,
  peak_request_hours jsonb not null default '{}'::jsonb,
  peak_request_days jsonb not null default '{}'::jsonb,
  quick_play_vs_normal_ratio jsonb not null default '{}'::jsonb,
  average_session_request_count float not null default 0,
  vibe_confidence_score float not null default 0,
  schema_version text not null default '1.0'
);

alter table public.venue_vibe_data enable row level security;
-- No policies added on purpose: this table is only ever read/written by the
-- backend's service-role client (via GET /api/venues/:id/vibe-data and the
-- scheduled aggregation job), never directly by the frontend Supabase client.
-- With RLS on and zero policies, direct client access is denied by default —
-- matching the same "route sensitive data through the backend" posture used
-- for gift_credits/refund_credits elsewhere in this schema.

-- ─────────────────────────────────────────────
-- 3. request_song() — additive change only
-- ─────────────────────────────────────────────

-- Adds an optional trailing p_channel parameter (default null). Existing
-- callers that omit it behave exactly as before; nothing about the credit
-- deduction, banned-song check, or venue-status check changes.
create or replace function request_song(
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

  -- Check and deduct credits for logged-in users
  if p_user_id is not null and p_credits_to_charge > 0 then
    select credits_balance into v_user_credits
    from public.users where id = p_user_id for update;

    if v_user_credits < p_credits_to_charge then
      return json_build_object('success', false, 'error', 'insufficient_credits');
    end if;

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

-- ─────────────────────────────────────────────
-- 4. Aggregation RPCs — used only by the backend's scheduled job, never
--    called synchronously from the request_song path.
-- ─────────────────────────────────────────────

-- Returns venue_ids that have genuine request activity newer than their last
-- generated venue_vibe_data row (or no row at all yet). Used by the 15-minute
-- backend job so it only recomputes venues that actually changed.
create or replace function venues_needing_vibe_update()
returns table(venue_id uuid)
language sql stable as $$
  select q.venue_id
  from (
    select venue_id, max(requested_at) as last_request
    from public.queue_items
    group by venue_id
  ) q
  left join public.venue_vibe_data v on v.venue_id = q.venue_id
  where v.venue_id is null or q.last_request > v.generated_at;
$$;

-- Recomputes and upserts the venue_vibe_data row for one venue from its full
-- request history (all statuses — pending/playing/played/removed all count
-- as genuine crowd interest). Reads only song-level/aggregate data; no guest
-- names, emails, or user IDs are read into any of the computed fields.
-- genre_breakdown is intentionally left as '{}' here — the backend job fills
-- it in with a lightweight keyword heuristic in JS right after calling this.
create or replace function compute_venue_vibe_data(p_venue_id uuid)
returns void
language plpgsql security definer as $$
declare
  v_total_requests integer;
  v_total_unique integer;
  v_top_alltime jsonb;
  v_top_30d jsonb;
  v_peak_hours jsonb;
  v_peak_days jsonb;
  v_quick_count integer;
  v_normal_count integer;
  v_avg_session float;
  v_confidence float;
begin
  select count(*), count(distinct youtube_video_id)
    into v_total_requests, v_total_unique
  from public.queue_items where venue_id = p_venue_id;

  select coalesce(jsonb_agg(t), '[]'::jsonb) into v_top_alltime
  from (
    select
      youtube_video_id as video_id,
      max(song_title) as title,
      max(channel) as artist,
      max(thumbnail_url) as thumbnail,
      count(*) as request_count,
      round(avg(credits_charged)::numeric, 2) as avg_credits_spent_on_it,
      min(requested_at) as first_requested_at,
      max(requested_at) as last_requested_at
    from public.queue_items
    where venue_id = p_venue_id
    group by youtube_video_id
    order by count(*) desc
    limit 50
  ) t;

  select coalesce(jsonb_agg(t), '[]'::jsonb) into v_top_30d
  from (
    select
      youtube_video_id as video_id,
      max(song_title) as title,
      max(channel) as artist,
      max(thumbnail_url) as thumbnail,
      count(*) as request_count,
      round(avg(credits_charged)::numeric, 2) as avg_credits_spent_on_it,
      min(requested_at) as first_requested_at,
      max(requested_at) as last_requested_at
    from public.queue_items
    where venue_id = p_venue_id and requested_at >= now() - interval '30 days'
    group by youtube_video_id
    order by count(*) desc
    limit 50
  ) t;

  select coalesce(jsonb_object_agg(hr::text, cnt), '{}'::jsonb) into v_peak_hours
  from (
    select extract(hour from requested_at)::int as hr, count(*) as cnt
    from public.queue_items where venue_id = p_venue_id
    group by 1
  ) t;

  select coalesce(jsonb_object_agg(dow, cnt), '{}'::jsonb) into v_peak_days
  from (
    select to_char(requested_at, 'FMDay') as dow, count(*) as cnt
    from public.queue_items where venue_id = p_venue_id
    group by 1
  ) t;

  select
    count(*) filter (where play_type = 'quick'),
    count(*) filter (where play_type = 'normal')
  into v_quick_count, v_normal_count
  from public.queue_items where venue_id = p_venue_id;

  -- "Session" is approximated as one guest identity (registered user_id, or
  -- requester_name for anonymous guests) — the schema has no explicit
  -- session-boundary concept, so this is a simple stand-in, not a precise
  -- per-visit count.
  select coalesce(avg(cnt), 0) into v_avg_session
  from (
    select coalesce(user_id::text, requester_name, 'unknown') as guest_key, count(*) as cnt
    from public.queue_items where venue_id = p_venue_id
    group by 1
  ) t;

  -- Ramps 0 -> 1 as requests go from 0 -> 200. vibe_ready flips at 50.
  v_confidence := least(1.0, v_total_requests::float / 200.0);

  insert into public.venue_vibe_data (
    venue_id, generated_at, total_requests_alltime, total_unique_songs_alltime,
    vibe_ready, top_songs_alltime, top_songs_last_30_days,
    peak_request_hours, peak_request_days, quick_play_vs_normal_ratio,
    average_session_request_count, vibe_confidence_score, schema_version
  ) values (
    p_venue_id, now(), v_total_requests, v_total_unique,
    v_total_requests >= 50, v_top_alltime, v_top_30d,
    v_peak_hours, v_peak_days,
    jsonb_build_object(
      'quick_play_count', v_quick_count, 'normal_play_count', v_normal_count,
      'quick_play_percentage', case when (v_quick_count + v_normal_count) > 0
        then round((v_quick_count::numeric / (v_quick_count + v_normal_count)) * 100, 1) else 0 end
    ),
    v_avg_session, v_confidence, '1.0'
  )
  on conflict (venue_id) do update set
    generated_at = excluded.generated_at,
    total_requests_alltime = excluded.total_requests_alltime,
    total_unique_songs_alltime = excluded.total_unique_songs_alltime,
    vibe_ready = excluded.vibe_ready,
    top_songs_alltime = excluded.top_songs_alltime,
    top_songs_last_30_days = excluded.top_songs_last_30_days,
    peak_request_hours = excluded.peak_request_hours,
    peak_request_days = excluded.peak_request_days,
    quick_play_vs_normal_ratio = excluded.quick_play_vs_normal_ratio,
    average_session_request_count = excluded.average_session_request_count,
    vibe_confidence_score = excluded.vibe_confidence_score,
    schema_version = excluded.schema_version;
end;
$$;
