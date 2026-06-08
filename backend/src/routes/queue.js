import { Router } from 'express';
import { supabaseAdmin } from '../lib/supabase.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router({ mergeParams: true }); // gets :venueId from parent

// Dynamic Quick Play price based on current queue length
function quickPlayPrice(pendingCount) {
  if (pendingCount <= 2) return 3;
  if (pendingCount <= 5) return 5;
  if (pendingCount <= 9) return 7;
  return 10;
}

// GET /api/venues/:venueId/queue
router.get('/', async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('queue_items')
    .select('*')
    .eq('venue_id', req.params.venueId)
    .in('status', ['pending', 'playing'])
    .order('play_type', { ascending: false }) // quick before normal
    .order('requested_at', { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// GET /api/venues/:venueId/queue/price — current Quick Play price
router.get('/price', async (req, res) => {
  const { count } = await supabaseAdmin
    .from('queue_items')
    .select('id', { count: 'exact', head: true })
    .eq('venue_id', req.params.venueId)
    .eq('status', 'pending');

  res.json({ price: quickPlayPrice(count ?? 0), queue_length: count ?? 0 });
});

// POST /api/venues/:venueId/queue — add song to queue (requires auth)
router.post('/', requireAuth, async (req, res) => {
  const {
    youtube_video_id,
    song_title,
    thumbnail_url,
    play_type = 'normal',
    requester_name = 'Guest',
  } = req.body;

  if (!youtube_video_id || !song_title) {
    return res.status(400).json({ error: 'video_id and title required' });
  }
  if (!['normal', 'quick'].includes(play_type)) {
    return res.status(400).json({ error: 'Invalid play_type' });
  }

  // Check venue is active and not paused
  const { data: venueCheck } = await supabaseAdmin
    .from('venues').select('status, jukebox_paused').eq('id', req.params.venueId).single();
  if (!venueCheck || venueCheck.status !== 'active') {
    return res.status(400).json({ error: 'venue_closed' });
  }
  if (venueCheck.jukebox_paused) {
    return res.status(400).json({ error: 'jukebox_paused' });
  }

  // Check if requester is banned
  const { data: bannedUser } = await supabaseAdmin
    .from('banned_users')
    .select('id')
    .eq('venue_id', req.params.venueId)
    .eq('requester_name', requester_name)
    .maybeSingle();
  if (bannedUser) return res.status(403).json({ error: 'user_banned' });

  // Calculate credits to charge
  let credits_to_charge = play_type === 'normal' ? 2 : 0;
  if (play_type === 'quick') {
    const { count } = await supabaseAdmin
      .from('queue_items')
      .select('id', { count: 'exact', head: true })
      .eq('venue_id', req.params.venueId)
      .eq('status', 'pending');
    credits_to_charge = quickPlayPrice(count ?? 0);
  }

  // Atomic credit deduction via stored procedure
  const { data, error } = await supabaseAdmin.rpc('request_song', {
    p_venue_id: req.params.venueId,
    p_user_id: req.user.id,
    p_youtube_video_id: youtube_video_id,
    p_song_title: song_title,
    p_thumbnail_url: thumbnail_url ?? null,
    p_requester_name: requester_name,
    p_play_type: play_type,
    p_credits_to_charge: credits_to_charge,
  });

  if (error) return res.status(500).json({ error: error.message });
  if (!data.success) return res.status(400).json({ error: data.error, credits_needed: credits_to_charge });
  return res.status(201).json({ success: true, queue_item_id: data.queue_item_id, credits_charged: credits_to_charge });
});

// PATCH /api/venues/:venueId/queue/:itemId — update status (host only)
router.patch('/:itemId', requireAuth, async (req, res) => {
  const { status } = req.body;
  if (!['playing', 'played', 'removed'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  // Verify ownership via venue
  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('id')
    .eq('id', req.params.venueId)
    .eq('host_id', req.user.id)
    .single();
  if (!venue) return res.status(403).json({ error: 'Forbidden' });

  const { data, error } = await supabaseAdmin
    .from('queue_items')
    .update({ status })
    .eq('id', req.params.itemId)
    .eq('venue_id', req.params.venueId)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// DELETE /api/venues/:venueId/queue/:itemId — remove (host only)
router.delete('/:itemId', requireAuth, async (req, res) => {
  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('id')
    .eq('id', req.params.venueId)
    .eq('host_id', req.user.id)
    .single();
  if (!venue) return res.status(403).json({ error: 'Forbidden' });

  const { error } = await supabaseAdmin
    .from('queue_items')
    .update({ status: 'removed' })
    .eq('id', req.params.itemId)
    .eq('venue_id', req.params.venueId);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

export default router;
