import { Router } from 'express';
import { nanoid } from 'nanoid';
import { supabaseAdmin } from '../lib/supabase.js';
import { requireAuth, requireHost } from '../middleware/auth.js';
import { body, schemas } from '../middleware/validate.js';

const router = Router();

const dbErr = (label, err, res) => {
  console.error(`[venues/${label}]`, err.message);
  return res.status(500).json({ error: 'Internal server error' });
};

// GET /api/venues — host's own venues
router.get('/', requireAuth, async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('venues')
    .select('*')
    .eq('host_id', req.user.id)
    .order('created_at', { ascending: false });

  if (error) return dbErr('list', error, res);
  res.json(data);
});

// GET /api/venues/room/:roomCode — public venue info for guests
router.get('/room/:roomCode', async (req, res) => {
  const code = req.params.roomCode;
  if (!code || code.length > 20) return res.status(400).json({ error: 'Invalid room code' });

  const { data, error } = await supabaseAdmin
    .from('venues')
    .select('id, name, room_code, status, welcome_credits, vibe_mode_enabled, jukebox_paused, queue_open_when_paused, vibe_description, vibe_now_playing_title, vibe_now_playing_channel, vibe_now_playing_thumbnail')
    .eq('room_code', code)
    .single();

  if (error || !data) return res.status(404).json({ error: 'Venue not found' });
  res.json(data);
});

// GET /api/venues/:id — full venue info (host only)
router.get('/:id', requireAuth, async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('venues')
    .select('*')
    .eq('id', req.params.id)
    .eq('host_id', req.user.id)
    .single();

  if (error || !data) return res.status(404).json({ error: 'Venue not found' });
  res.json(data);
});

// POST /api/venues — create venue (host only)
router.post('/', requireHost, body(schemas.createVenue), async (req, res) => {
  const { name, welcome_credits = 10, crossfade_duration_seconds = 5 } = req.body;
  const room_code = nanoid(8).toUpperCase();

  const { data, error } = await supabaseAdmin
    .from('venues')
    .insert({
      host_id: req.user.id,
      name,
      room_code,
      welcome_credits,
      crossfade_duration_seconds,
    })
    .select()
    .single();

  if (error) return dbErr('create', error, res);
  res.status(201).json(data);
});

// PUT /api/venues/:id — update venue settings (host only)
router.put('/:id', requireAuth, body(schemas.updateVenue), async (req, res) => {
  const allowed = [
    'name', 'status', 'welcome_credits', 'crossfade_duration_seconds',
    'vibe_description', 'vibe_playlist_urls', 'vibe_mode_enabled',
    'vibe_current_video_index', 'vibe_current_position_seconds',
    'jukebox_paused', 'queue_open_when_paused', 'vibe_played_video_ids',
    'vibe_now_playing_title', 'vibe_now_playing_channel', 'vibe_now_playing_thumbnail',
    'vibe_source',
  ];
  const updates = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }

  const { data, error } = await supabaseAdmin
    .from('venues')
    .update(updates)
    .eq('id', req.params.id)
    .eq('host_id', req.user.id)
    .select()
    .single();

  if (error) return dbErr('update', error, res);
  if (!data) return res.status(404).json({ error: 'Venue not found' });
  res.json(data);
});

// GET /api/venues/:id/banned — list banned songs (public; used by guest to filter results)
router.get('/:id/banned', async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('banned_songs')
    .select('*')
    .eq('venue_id', req.params.id)
    .order('banned_at', { ascending: false });

  if (error) return dbErr('banned/list', error, res);
  res.json(data);
});

// POST /api/venues/:id/banned — ban a song (host only)
router.post('/:id/banned', requireAuth, body(schemas.banSong), async (req, res) => {
  const { youtube_video_id, song_title, thumbnail_url, channel } = req.body;

  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('id')
    .eq('id', req.params.id)
    .eq('host_id', req.user.id)
    .single();
  if (!venue) return res.status(403).json({ error: 'Forbidden' });

  const { data, error } = await supabaseAdmin
    .from('banned_songs')
    .insert({ venue_id: req.params.id, youtube_video_id, song_title, thumbnail_url, channel })
    .select()
    .single();

  if (error) return dbErr('banned/add', error, res);
  res.status(201).json(data);
});

// DELETE /api/venues/:id/banned/:songId — unban (host only)
router.delete('/:id/banned/:songId', requireAuth, async (req, res) => {
  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('id')
    .eq('id', req.params.id)
    .eq('host_id', req.user.id)
    .single();
  if (!venue) return res.status(403).json({ error: 'Forbidden' });

  const { error } = await supabaseAdmin
    .from('banned_songs')
    .delete()
    .eq('id', req.params.songId)
    .eq('venue_id', req.params.id);

  if (error) return dbErr('banned/remove', error, res);
  res.json({ success: true });
});

// POST /api/venues/:id/gift — gift credits to a signed-in user (host only)
router.post('/:id/gift', requireAuth, body(schemas.gift), async (req, res) => {
  const { guest_identifier, amount } = req.body;

  const { data, error } = await supabaseAdmin.rpc('gift_credits', {
    p_host_id: req.user.id,
    p_guest_identifier: guest_identifier,
    p_amount: amount,
    p_venue_id: req.params.id,
  });

  if (error) {
    console.error('[venues/gift]', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
  if (!data?.success) {
    if (data?.error === 'guest_not_found') {
      return res.status(404).json({ error: 'user_not_found', message: `No signed-in user with name "${guest_identifier}" found. Guest users cannot receive gifted credits.` });
    }
    if (data?.error === 'unauthorized') return res.status(403).json({ error: 'Forbidden' });
    return res.status(400).json({ error: data?.error ?? 'gift_failed' });
  }
  res.json({ success: true });
});

// GET /api/venues/:id/users — list requesters with stats + ban status
router.get('/:id/users', requireAuth, async (req, res) => {
  const { data: venue } = await supabaseAdmin.from('venues').select('id').eq('id', req.params.id).eq('host_id', req.user.id).single();
  if (!venue) return res.status(403).json({ error: 'Forbidden' });

  const { data: items } = await supabaseAdmin
    .from('queue_items')
    .select('requester_name, credits_charged, status, requested_at')
    .eq('venue_id', req.params.id)
    .in('status', ['pending', 'playing', 'played']);

  const { data: bannedUsers } = await supabaseAdmin
    .from('banned_users')
    .select('*')
    .eq('venue_id', req.params.id);

  const bannedNames = new Set((bannedUsers ?? []).map(b => b.requester_name));

  const userMap = {};
  for (const item of items ?? []) {
    const name = item.requester_name || 'Guest';
    if (!userMap[name]) userMap[name] = { name, requests: 0, credits: 0, lastSeen: item.requested_at };
    userMap[name].requests++;
    userMap[name].credits += item.credits_charged ?? 0;
    if (item.requested_at > userMap[name].lastSeen) userMap[name].lastSeen = item.requested_at;
  }

  const requesterNames = Object.keys(userMap);
  let registeredNames = new Set();
  if (requesterNames.length) {
    const { data: profiles } = await supabaseAdmin
      .from('users')
      .select('display_name')
      .in('display_name', requesterNames);
    registeredNames = new Set((profiles ?? []).map(p => p.display_name));
  }

  const users = Object.values(userMap)
    .map(u => ({ ...u, banned: bannedNames.has(u.name), isRegistered: registeredNames.has(u.name) }))
    .sort((a, b) => b.requests - a.requests);

  res.json({ users, bannedUsers: bannedUsers ?? [] });
});

// DELETE /api/venues/:id/users/:name — remove user (clears pending requests + refunds)
router.delete('/:id/users/:name', requireAuth, async (req, res) => {
  const { data: venue } = await supabaseAdmin
    .from('venues').select('id')
    .eq('id', req.params.id).eq('host_id', req.user.id).single();
  if (!venue) return res.status(403).json({ error: 'Forbidden' });

  const name = decodeURIComponent(req.params.name);

  const { data: pendingItems } = await supabaseAdmin
    .from('queue_items')
    .select('user_id, credits_charged')
    .eq('venue_id', req.params.id)
    .eq('requester_name', name)
    .eq('status', 'pending');

  const { error } = await supabaseAdmin
    .from('queue_items')
    .delete()
    .eq('venue_id', req.params.id)
    .eq('requester_name', name)
    .neq('status', 'playing');

  if (error) return dbErr('users/remove', error, res);

  let refunded = 0;
  for (const it of pendingItems ?? []) {
    if (it.user_id && it.credits_charged > 0) {
      const { data, error: rErr } = await supabaseAdmin.rpc('refund_credits', {
        p_user_id: it.user_id,
        p_amount: it.credits_charged,
        p_reason: 'Removed from venue by host',
      });
      if (!rErr && data?.success) refunded += it.credits_charged;
    }
  }

  res.json({ success: true, refunded });
});

// POST /api/venues/:id/banned-users — ban a user by name
router.post('/:id/banned-users', requireAuth, body(schemas.banUser), async (req, res) => {
  const { requester_name } = req.body;

  const { data: venue } = await supabaseAdmin.from('venues').select('id').eq('id', req.params.id).eq('host_id', req.user.id).single();
  if (!venue) return res.status(403).json({ error: 'Forbidden' });

  const { data, error } = await supabaseAdmin
    .from('banned_users')
    .upsert({ venue_id: req.params.id, requester_name }, { onConflict: 'venue_id,requester_name' })
    .select().single();

  if (error) return dbErr('banned-users/add', error, res);
  res.status(201).json(data);
});

// DELETE /api/venues/:id/banned-users/:bannedUserId — unban
router.delete('/:id/banned-users/:bannedUserId', requireAuth, async (req, res) => {
  const { data: venue } = await supabaseAdmin.from('venues').select('id').eq('id', req.params.id).eq('host_id', req.user.id).single();
  if (!venue) return res.status(403).json({ error: 'Forbidden' });

  const { error } = await supabaseAdmin
    .from('banned_users')
    .delete()
    .eq('id', req.params.bannedUserId)
    .eq('venue_id', req.params.id);

  if (error) return dbErr('banned-users/remove', error, res);
  res.json({ success: true });
});

// GET /api/venues/:id/stats — basic stats
router.get('/:id/stats', requireAuth, async (req, res) => {
  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('id')
    .eq('id', req.params.id)
    .eq('host_id', req.user.id)
    .single();
  if (!venue) return res.status(403).json({ error: 'Forbidden' });

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const { data: items } = await supabaseAdmin
    .from('queue_items')
    .select('song_title, credits_charged, youtube_video_id')
    .eq('venue_id', req.params.id)
    .in('status', ['playing', 'played'])
    .gte('requested_at', today.toISOString());

  const totalRequests = items?.length ?? 0;
  const totalCredits = items?.reduce((s, i) => s + (i.credits_charged || 0), 0) ?? 0;

  const songCount = {};
  for (const item of items ?? []) {
    const key = item.youtube_video_id;
    songCount[key] = { title: item.song_title, count: (songCount[key]?.count ?? 0) + 1 };
  }
  const topSongs = Object.values(songCount)
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  res.json({ totalRequests, totalCredits, topSongs });
});

// ── Venue Vibe File system ──────────────────────────────────────────────────
// All routes below are host-only. venue_vibe_data is populated entirely by
// the background aggregation job (backend/src/jobs/vibeAggregation.js), never
// computed synchronously here — these routes only read/write it.

// GET /api/venues/:id/vibe-data — the venue's own auto-generated vibe stats
// (used for the Vibe tab's progress line, locked/unlocked Auto-Vibe state,
// and to build the downloadable vibe file).
router.get('/:id/vibe-data', requireAuth, async (req, res) => {
  const { data: venue } = await supabaseAdmin
    .from('venues').select('id, room_code').eq('id', req.params.id).eq('host_id', req.user.id).single();
  if (!venue) return res.status(403).json({ error: 'Forbidden' });

  const { data, error } = await supabaseAdmin
    .from('venue_vibe_data')
    .select('*')
    .eq('venue_id', req.params.id)
    .maybeSingle();

  if (error) return dbErr('vibe-data/get', error, res);
  // No row yet just means the venue hasn't had its first aggregation run —
  // report zeroed-out, not-ready stats rather than a 404.
  res.json(data ?? {
    venue_id: req.params.id, generated_at: null,
    total_requests_alltime: 0, total_unique_songs_alltime: 0, vibe_ready: false,
    top_songs_alltime: [], top_songs_last_30_days: [], genre_breakdown: {},
    peak_request_hours: {}, peak_request_days: {},
    quick_play_vs_normal_ratio: { quick_play_count: 0, normal_play_count: 0, quick_play_percentage: 0 },
    average_session_request_count: 0, vibe_confidence_score: 0, schema_version: '1.0',
  });
});

const VIBE_FILE_REQUIRED_FIELDS = ['schema_version', 'top_songs_alltime', 'top_songs_last_30_days'];
const VIBE_FILE_SUPPORTED_VERSIONS = ['1.0'];

// Deliberately hand-written rather than a generic zod schema so each failure
// mode gets the specific, human-readable message the host actually needs to
// act on (which field is missing, what version was expected, etc).
function validateVibeFile(payload) {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return 'Invalid JSON format — expected a vibe file object.';
  }
  for (const field of VIBE_FILE_REQUIRED_FIELDS) {
    if (!(field in payload)) return `This file is missing required field '${field}'.`;
  }
  if (!VIBE_FILE_SUPPORTED_VERSIONS.includes(payload.schema_version)) {
    return `Unsupported schema version — expected ${VIBE_FILE_SUPPORTED_VERSIONS.join(' or ')}, got '${payload.schema_version}'.`;
  }
  if (!Array.isArray(payload.top_songs_alltime) || !Array.isArray(payload.top_songs_last_30_days)) {
    return `'top_songs_alltime' and 'top_songs_last_30_days' must be arrays.`;
  }
  for (const arr of [payload.top_songs_alltime, payload.top_songs_last_30_days]) {
    for (const entry of arr) {
      if (!entry || typeof entry !== 'object' || typeof entry.video_id !== 'string') {
        return `Each song entry must include a 'video_id' string.`;
      }
    }
  }
  return null;
}

// POST /api/venues/:id/vibe-file/upload — upload + validate a vibe file from
// another venue (or a previously downloaded one). Stored entirely separately
// from the venue's own venue_vibe_data row — this never overwrites or affects
// the venue's own collected data.
router.post('/:id/vibe-file/upload', requireAuth, async (req, res) => {
  const { data: venue } = await supabaseAdmin
    .from('venues').select('id').eq('id', req.params.id).eq('host_id', req.user.id).single();
  if (!venue) return res.status(403).json({ error: 'Forbidden' });

  const { filename, data: fileData } = req.body ?? {};
  const validationError = validateVibeFile(fileData);
  if (validationError) return res.status(400).json({ error: validationError });

  const { data, error } = await supabaseAdmin
    .from('venues')
    .update({
      uploaded_vibe_data: fileData,
      uploaded_vibe_filename: typeof filename === 'string' ? filename.slice(0, 200) : 'vibe-file.json',
      uploaded_vibe_uploaded_at: new Date().toISOString(),
    })
    .eq('id', req.params.id)
    .select('id, uploaded_vibe_filename, uploaded_vibe_uploaded_at')
    .single();

  if (error) return dbErr('vibe-file/upload', error, res);
  res.json({ success: true, ...data });
});

// DELETE /api/venues/:id/vibe-file — remove the uploaded vibe file
router.delete('/:id/vibe-file', requireAuth, async (req, res) => {
  const { data: venue } = await supabaseAdmin
    .from('venues').select('id').eq('id', req.params.id).eq('host_id', req.user.id).single();
  if (!venue) return res.status(403).json({ error: 'Forbidden' });

  const { error } = await supabaseAdmin
    .from('venues')
    .update({ uploaded_vibe_data: null, uploaded_vibe_filename: null, uploaded_vibe_uploaded_at: null })
    .eq('id', req.params.id);

  if (error) return dbErr('vibe-file/remove', error, res);
  res.json({ success: true });
});

export default router;
