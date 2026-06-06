import { Router } from 'express';
import { nanoid } from 'nanoid';
import { supabaseAdmin } from '../lib/supabase.js';
import { requireAuth, requireHost } from '../middleware/auth.js';

const router = Router();

// GET /api/venues — host's own venues
router.get('/', requireAuth, async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('venues')
    .select('*')
    .eq('host_id', req.user.id)
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// GET /api/venues/room/:roomCode — public venue info for guests
router.get('/room/:roomCode', async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('venues')
    .select('id, name, room_code, status, welcome_credits, vibe_mode_enabled')
    .eq('room_code', req.params.roomCode)
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
router.post('/', requireHost, async (req, res) => {
  const { name, welcome_credits = 10, crossfade_duration_seconds = 5 } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name required' });

  const room_code = nanoid(8).toUpperCase();

  const { data, error } = await supabaseAdmin
    .from('venues')
    .insert({
      host_id: req.user.id,
      name: name.trim(),
      room_code,
      welcome_credits,
      crossfade_duration_seconds,
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// PUT /api/venues/:id — update venue settings (host only)
router.put('/:id', requireAuth, async (req, res) => {
  const allowed = [
    'name', 'status', 'welcome_credits', 'crossfade_duration_seconds',
    'vibe_description', 'vibe_playlist_urls', 'vibe_mode_enabled',
    'vibe_current_video_index', 'vibe_current_position_seconds',
    'jukebox_paused',
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

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Venue not found' });
  res.json(data);
});

// GET /api/venues/:id/banned — list banned songs
router.get('/:id/banned', async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('banned_songs')
    .select('*')
    .eq('venue_id', req.params.id)
    .order('banned_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// POST /api/venues/:id/banned — ban a song (host only)
router.post('/:id/banned', requireAuth, async (req, res) => {
  const { youtube_video_id, song_title, thumbnail_url } = req.body;
  if (!youtube_video_id) return res.status(400).json({ error: 'video_id required' });

  // Verify ownership
  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('id')
    .eq('id', req.params.id)
    .eq('host_id', req.user.id)
    .single();
  if (!venue) return res.status(403).json({ error: 'Forbidden' });

  const { data, error } = await supabaseAdmin
    .from('banned_songs')
    .insert({ venue_id: req.params.id, youtube_video_id, song_title, thumbnail_url })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
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

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// POST /api/venues/:id/gift — gift credits to a signed-in user (host only)
router.post('/:id/gift', requireAuth, async (req, res) => {
  const { guest_identifier, amount } = req.body;
  if (!guest_identifier || !amount) {
    return res.status(400).json({ error: 'guest_identifier and amount required' });
  }

  // Verify host owns this venue
  const { data: venue } = await supabaseAdmin
    .from('venues').select('id')
    .eq('id', req.params.id).eq('host_id', req.user.id).single();
  if (!venue) return res.status(403).json({ error: 'Forbidden' });

  // Find the recipient by display_name
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('id, credits_balance')
    .eq('display_name', guest_identifier)
    .maybeSingle();

  if (!profile) {
    return res.status(404).json({ error: 'user_not_found', message: `No signed-in user with name "${guest_identifier}" found. Guest users cannot receive gifted credits.` });
  }

  const newBalance = (profile.credits_balance ?? 0) + Number(amount);
  const { error: updateErr } = await supabaseAdmin
    .from('profiles')
    .update({ credits_balance: newBalance })
    .eq('id', profile.id);

  if (updateErr) return res.status(500).json({ error: updateErr.message });
  res.json({ success: true, new_balance: newBalance });
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

  // Group by requester_name
  const userMap = {};
  for (const item of items ?? []) {
    const name = item.requester_name || 'Guest';
    if (!userMap[name]) userMap[name] = { name, requests: 0, credits: 0, lastSeen: item.requested_at };
    userMap[name].requests++;
    userMap[name].credits += item.credits_charged ?? 0;
    if (item.requested_at > userMap[name].lastSeen) userMap[name].lastSeen = item.requested_at;
  }

  // Cross-reference with profiles to identify signed-in users
  const requesterNames = Object.keys(userMap);
  let registeredNames = new Set();
  if (requesterNames.length) {
    const { data: profiles } = await supabaseAdmin
      .from('profiles')
      .select('display_name')
      .in('display_name', requesterNames);
    registeredNames = new Set((profiles ?? []).map(p => p.display_name));
  }

  const users = Object.values(userMap)
    .map(u => ({ ...u, banned: bannedNames.has(u.name), isRegistered: registeredNames.has(u.name) }))
    .sort((a, b) => b.requests - a.requests);

  res.json({ users, bannedUsers: bannedUsers ?? [] });
});

// DELETE /api/venues/:id/users/:name — remove user (clears their pending requests, no ban)
router.delete('/:id/users/:name', requireAuth, async (req, res) => {
  const { data: venue } = await supabaseAdmin
    .from('venues').select('id')
    .eq('id', req.params.id).eq('host_id', req.user.id).single();
  if (!venue) return res.status(403).json({ error: 'Forbidden' });

  const name = decodeURIComponent(req.params.name);
  // Delete all their items except currently-playing (don't interrupt playback)
  const { error } = await supabaseAdmin
    .from('queue_items')
    .delete()
    .eq('venue_id', req.params.id)
    .eq('requester_name', name)
    .neq('status', 'playing');

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// POST /api/venues/:id/banned-users — ban a user by name
router.post('/:id/banned-users', requireAuth, async (req, res) => {
  const { requester_name } = req.body;
  if (!requester_name) return res.status(400).json({ error: 'requester_name required' });

  const { data: venue } = await supabaseAdmin.from('venues').select('id').eq('id', req.params.id).eq('host_id', req.user.id).single();
  if (!venue) return res.status(403).json({ error: 'Forbidden' });

  const { data, error } = await supabaseAdmin
    .from('banned_users')
    .upsert({ venue_id: req.params.id, requester_name }, { onConflict: 'venue_id,requester_name' })
    .select().single();

  if (error) return res.status(500).json({ error: error.message });
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

  if (error) return res.status(500).json({ error: error.message });
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

  // Top songs
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

export default router;
