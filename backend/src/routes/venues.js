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

// POST /api/venues/:id/gift — gift credits (host only)
router.post('/:id/gift', requireAuth, async (req, res) => {
  const { guest_identifier, amount } = req.body;
  if (!guest_identifier || !amount) {
    return res.status(400).json({ error: 'guest_identifier and amount required' });
  }

  const { data, error } = await supabaseAdmin.rpc('gift_credits', {
    p_host_id: req.user.id,
    p_guest_identifier: guest_identifier,
    p_amount: amount,
    p_venue_id: req.params.id,
  });

  if (error) return res.status(500).json({ error: error.message });
  if (!data.success) return res.status(400).json({ error: data.error });
  res.json(data);
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
