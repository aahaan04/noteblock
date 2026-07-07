-- Noteblock Database Schema
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor → New query)

create extension if not exists "uuid-ossp";

-- ─────────────────────────────────────────────
-- TABLES
-- ─────────────────────────────────────────────

create table public.users (
  id uuid references auth.users(id) on delete cascade primary key,
  email text,
  display_name text,
  role text check (role in ('host', 'guest')) not null default 'guest',
  credits_balance integer not null default 0,
  language text check (language in ('en', 'hi', 'zh')) not null default 'en',
  created_at timestamptz default now()
);

create table public.venues (
  id uuid default uuid_generate_v4() primary key,
  host_id uuid references public.users(id) on delete cascade not null,
  name text not null,
  room_code text unique not null,
  status text check (status in ('active', 'closed')) not null default 'active',
  welcome_credits integer not null default 10,
  crossfade_duration_seconds integer not null default 5
    check (crossfade_duration_seconds between 2 and 10),
  vibe_description text,
  vibe_playlist_urls text[] default '{}',
  vibe_mode_enabled boolean not null default false,
  vibe_current_video_index integer not null default 0,
  vibe_current_position_seconds float not null default 0,
  jukebox_paused boolean not null default false,
  vibe_played_video_ids text[] default '{}',
  vibe_now_playing_title text,
  vibe_now_playing_channel text,
  created_at timestamptz default now()
);

create table public.queue_items (
  id uuid default uuid_generate_v4() primary key,
  venue_id uuid references public.venues(id) on delete cascade not null,
  user_id uuid references public.users(id) on delete set null,
  youtube_video_id text not null,
  song_title text not null,
  thumbnail_url text,
  requester_name text,
  play_type text check (play_type in ('normal', 'quick', 'vibe')) not null default 'normal',
  credits_charged integer not null default 0,
  status text check (status in ('pending', 'playing', 'played', 'removed')) not null default 'pending',
  requested_at timestamptz default now()
);

create table public.banned_songs (
  id uuid default uuid_generate_v4() primary key,
  venue_id uuid references public.venues(id) on delete cascade not null,
  youtube_video_id text not null,
  song_title text,
  thumbnail_url text,
  banned_at timestamptz default now(),
  unique(venue_id, youtube_video_id)
);

create table public.banned_users (
  id uuid default uuid_generate_v4() primary key,
  venue_id uuid references public.venues(id) on delete cascade not null,
  requester_name text not null,
  banned_at timestamptz default now(),
  unique(venue_id, requester_name)
);

create table public.saved_rooms (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references public.users(id) on delete cascade not null,
  venue_id uuid references public.venues(id) on delete cascade not null,
  last_joined_at timestamptz default now(),
  unique(user_id, venue_id)
);

create table public.credit_transactions (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references public.users(id) on delete set null,
  amount integer not null,
  type text check (type in ('purchase', 'gift', 'spend', 'welcome', 'refund')) not null,
  razorpay_order_id text,
  description text,
  created_at timestamptz default now()
);

-- ─────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- ─────────────────────────────────────────────

alter table public.users enable row level security;
alter table public.venues enable row level security;
alter table public.queue_items enable row level security;
alter table public.banned_songs enable row level security;
alter table public.banned_users enable row level security;
alter table public.saved_rooms enable row level security;
alter table public.credit_transactions enable row level security;

-- users
create policy "users_select_own" on public.users for select using (auth.uid() = id);
create policy "users_update_own" on public.users for update using (auth.uid() = id);
create policy "users_insert_own" on public.users for insert with check (auth.uid() = id);

-- venues
create policy "venues_host_all" on public.venues for all using (auth.uid() = host_id);
create policy "venues_public_read" on public.venues for select using (true);

-- queue_items
create policy "queue_public_read" on public.queue_items for select using (true);
create policy "queue_insert_any" on public.queue_items for insert with check (true);
create policy "queue_host_update" on public.queue_items for update using (
  exists (select 1 from public.venues where id = venue_id and host_id = auth.uid())
);
create policy "queue_host_delete" on public.queue_items for delete using (
  exists (select 1 from public.venues where id = venue_id and host_id = auth.uid())
);

-- banned_songs
create policy "banned_public_read" on public.banned_songs for select using (true);
create policy "banned_host_all" on public.banned_songs for all using (
  exists (select 1 from public.venues where id = venue_id and host_id = auth.uid())
);

-- banned_users
create policy "banned_users_public_read" on public.banned_users for select using (true);
create policy "banned_users_host_all" on public.banned_users for all using (
  exists (select 1 from public.venues where id = venue_id and host_id = auth.uid())
);

-- saved_rooms
create policy "saved_rooms_own" on public.saved_rooms for all using (auth.uid() = user_id);

-- credit_transactions
create policy "transactions_own_read" on public.credit_transactions for select using (auth.uid() = user_id);
create policy "transactions_insert_any" on public.credit_transactions for insert with check (true);

-- ─────────────────────────────────────────────
-- STORED PROCEDURES (security definer = bypass RLS)
-- ─────────────────────────────────────────────

-- Atomically deduct credits and add to queue
create or replace function request_song(
  p_venue_id uuid,
  p_user_id uuid,
  p_youtube_video_id text,
  p_song_title text,
  p_thumbnail_url text,
  p_requester_name text,
  p_play_type text,
  p_credits_to_charge integer
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
     requester_name, play_type, credits_charged)
  values
    (p_venue_id, p_user_id, p_youtube_video_id, p_song_title, p_thumbnail_url,
     p_requester_name, p_play_type, p_credits_to_charge)
  returning id into v_queue_item_id;

  return json_build_object('success', true, 'queue_item_id', v_queue_item_id);
end;
$$;

-- Grant welcome credits to a new guest joining a venue
create or replace function grant_welcome_credits(
  p_user_id uuid,
  p_venue_id uuid
) returns json
language plpgsql security definer as $$
declare
  v_welcome integer;
  v_already boolean;
begin
  select exists(
    select 1 from public.saved_rooms
    where user_id = p_user_id and venue_id = p_venue_id
  ) into v_already;

  if v_already then
    -- Just update last_joined_at
    update public.saved_rooms
    set last_joined_at = now()
    where user_id = p_user_id and venue_id = p_venue_id;
    return json_build_object('success', true, 'credits_granted', 0, 'already_joined', true);
  end if;

  select welcome_credits into v_welcome from public.venues where id = p_venue_id;

  if v_welcome > 0 then
    update public.users
    set credits_balance = credits_balance + v_welcome
    where id = p_user_id;

    insert into public.credit_transactions
      (user_id, amount, type, description)
    values
      (p_user_id, v_welcome, 'welcome', 'Welcome credits');
  end if;

  insert into public.saved_rooms (user_id, venue_id)
  values (p_user_id, p_venue_id)
  on conflict (user_id, venue_id) do update set last_joined_at = now();

  return json_build_object(
    'success', true,
    'credits_granted', v_welcome,
    'already_joined', false
  );
end;
$$;

-- Host gifts credits to a guest
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
  -- Verify caller owns this venue
  if not exists (
    select 1 from public.venues where id = p_venue_id and host_id = p_host_id
  ) then
    return json_build_object('success', false, 'error', 'unauthorized');
  end if;

  -- Find guest by email or display_name
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

  insert into public.credit_transactions
    (user_id, amount, type, description)
  values
    (v_guest_id, p_amount, 'gift', 'Gift from host');

  return json_build_object('success', true, 'guest_id', v_guest_id);
end;
$$;

-- Atomically refund credits (e.g. when a host removes a pending request)
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
-- TRIGGER: auto-create user profile on signup
-- ─────────────────────────────────────────────

create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer as $$
begin
  insert into public.users (id, email, display_name, role)
  values (
    new.id,
    new.email,
    coalesce(
      new.raw_user_meta_data->>'display_name',
      split_part(new.email, '@', 1)
    ),
    coalesce(new.raw_user_meta_data->>'role', 'guest')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create or replace trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
