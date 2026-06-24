import { Router } from 'express';
import { supabaseAdmin } from '../lib/supabase.js';
import { requireAuth } from '../middleware/auth.js';
import { body, schemas } from '../middleware/validate.js';
import { queueLimiter } from '../middleware/rateLimits.js';

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

  if (error) {
    console.error('[queue/list]', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
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
router.post('/', requireAuth, queueLimiter, body(schemas.addQueue), async (req, res) => {
  const {
    youtube_video_id,
    song_title,
    thumbnail_url,
    play_type = 'normal',
    requester_name = 'Guest',
  } = req.body;

  // Check venue is active and not paused
  const { data: venueCheck } = await supabaseAdmin
    .from('venues').select('status, jukebox_paused, queue_open_when_paused').eq('id', req.params.venueId).single();
  if (!venueCheck || venueCheck.status !== 'active') {
    return res.status(400).json({ error: 'venue_closed' });
  }
  if (venueCheck.jukebox_paused && !venueCheck.queue_open_when_paused) {
    return res.status(400).json({ error: 'jukebox_paused' });
  }

  // Prevent duplicate: same user queuing the same video while it's still pending/playing
  const { count: dupCount } = await supabaseAdmin
    .from('queue_items')
    .select('id', { count: 'exact', head: true })
    .eq('venue_id', req.params.venueId)
    .eq('user_id', req.user.id)
    .eq('youtube_video_id', youtube_video_id)
    .in('status', ['pending', 'playing']);
  if (dupCount > 0) {
    return res.status(400).json({ error: 'already_queued' });
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

  if (error) {
    console.error('[queue/add]', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
  if (!data.success) return res.status(400).json({ error: data.error, credits_needed: credits_to_charge });
  return res.status(201).json({ success: true, queue_item_id: data.queue_item_id, credits_charged: credits_to_charge });
});

// PATCH /api/venues/:venueId/queue/:itemId — update status (host only)
router.patch('/:itemId', requireAuth, body(schemas.updateQueueStatus), async (req, res) => {
  const { status } = req.body;

  // Verify ownership via venue
  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('id')
    .eq('id', req.params.venueId)
    .eq('host_id', req.user.id)
    .single();
  if (!venue) return res.status(403).json({ error: 'Forbidden' });

  // When marking a new song as 'playing', auto-retire any stuck songs
  if (status === 'playing') {
    await supabaseAdmin
      .from('queue_items')
      .update({ status: 'played' })
      .eq('venue_id', req.params.venueId)
      .eq('status', 'playing')
      .neq('id', req.params.itemId);
  }

  const { data, error } = await supabaseAdmin
    .from('queue_items')
    .update({ status })
    .eq('id', req.params.itemId)
    .eq('venue_id', req.params.venueId)
    .select()
    .single();

  if (error) {
    console.error('[queue/patch]', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
  res.json(data);
});

// DELETE /api/venues/:venueId/queue/:itemId — remove (host only), refunds if pending
router.delete('/:itemId', requireAuth, async (req, res) => {
  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('id')
    .eq('id', req.params.venueId)
    .eq('host_id', req.user.id)
    .single();
  if (!venue) return res.status(403).json({ error: 'Forbidden' });

  // Snapshot item before removal to enable refund
  const { data: item } = await supabaseAdmin
    .from('queue_items')
    .select('status, credits_charged, user_id')
    .eq('id', req.params.itemId)
    .eq('venue_id', req.params.venueId)
    .single();

  // Idempotent: only transitions rows not already removed — prevents double-refund
  const { data: removed, error } = await supabaseAdmin
    .from('queue_items')
    .update({ status: 'removed' })
    .eq('id', req.params.itemId)
    .eq('venue_id', req.params.venueId)
    .neq('status', 'removed')
    .select('id');

  if (error) {
    console.error('[queue/delete]', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }

  let refunded = 0;
  if (removed?.length && item?.status === 'pending' && item.user_id && item.credits_charged > 0) {
    const { data, error: refundErr } = await supabaseAdmin.rpc('refund_credits', {
      p_user_id: item.user_id,
      p_amount: item.credits_charged,
      p_reason: 'Song removed from queue',
    });
    if (!refundErr && data?.success) refunded = item.credits_charged;
  }

  res.json({ success: true, refunded });
});

export default router;
