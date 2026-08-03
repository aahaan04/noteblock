import { Router } from 'express';
import { supabaseAdmin } from '../lib/supabase.js';
import { requireAuth } from '../middleware/auth.js';
import { body, schemas } from '../middleware/validate.js';
import { queueLimiter } from '../middleware/rateLimits.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

const router = Router({ mergeParams: true }); // gets :venueId from parent

// Dynamic Quick Play price based on current queue length
function quickPlayPrice(pendingCount) {
  if (pendingCount <= 2) return 3;
  if (pendingCount <= 5) return 5;
  if (pendingCount <= 9) return 7;
  return 10;
}

// A 'playing' row with no follow-up transition for this long almost certainly
// means the host's tab/session that would have marked it 'played' or started
// the next song is gone (closed mid-song, crashed, lost connection) — not
// that a single song is still genuinely playing. Real songs essentially never
// run this long; this exists purely to stop an orphaned row from staying
// invisible-but-stuck forever (it's excluded from GET results below like any
// other non-pending/playing row, and blocks nothing once retired to 'played').
const STUCK_PLAYING_MINUTES = 20;

async function reconcileStuckPlaying(venueId) {
  const cutoff = new Date(Date.now() - STUCK_PLAYING_MINUTES * 60 * 1000).toISOString();
  await supabaseAdmin
    .from('queue_items')
    .update({ status: 'played' })
    .eq('venue_id', venueId)
    .eq('status', 'playing')
    .lt('started_playing_at', cutoff);
}

// GET /api/venues/:venueId/queue
router.get('/', asyncHandler(async (req, res) => {
  await reconcileStuckPlaying(req.params.venueId);

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
}));

// GET /api/venues/:venueId/queue/price — current Quick Play price
router.get('/price', asyncHandler(async (req, res) => {
  const { count } = await supabaseAdmin
    .from('queue_items')
    .select('id', { count: 'exact', head: true })
    .eq('venue_id', req.params.venueId)
    .eq('status', 'pending');

  res.json({ price: quickPlayPrice(count ?? 0), queue_length: count ?? 0 });
}));

// POST /api/venues/:venueId/queue — add song to queue (requires auth)
router.post('/', requireAuth, queueLimiter, body(schemas.addQueue), asyncHandler(async (req, res) => {
  const {
    youtube_video_id,
    song_title,
    thumbnail_url,
    play_type = 'normal',
    requester_name = 'Guest',
    channel,
  } = req.body;

  // Check venue is active and not paused
  const { data: venueCheck } = await supabaseAdmin
    .from('venues').select('status, jukebox_paused').eq('id', req.params.venueId).single();
  if (!venueCheck || venueCheck.status !== 'active') {
    return res.status(400).json({ error: 'venue_closed' });
  }
  if (venueCheck.jukebox_paused) {
    return res.status(400).json({ error: 'jukebox_paused' });
  }

  // Check if requester is banned — by their stable account id (can't be
  // evaded by editing display_name) OR by the submitted name (legacy /
  // catches a banned name before any user_id was ever recorded for it). Two
  // separate .eq() queries rather than a single .or() filter string, since
  // requester_name is user-controlled and a raw .or() template would let a
  // comma/dot/paren in it corrupt the PostgREST filter syntax.
  const [{ data: bannedById }, { data: bannedByName }] = await Promise.all([
    supabaseAdmin.from('banned_users').select('id')
      .eq('venue_id', req.params.venueId).eq('user_id', req.user.id).maybeSingle(),
    supabaseAdmin.from('banned_users').select('id')
      .eq('venue_id', req.params.venueId).eq('requester_name', requester_name).maybeSingle(),
  ]);
  if (bannedById || bannedByName) return res.status(403).json({ error: 'user_banned' });

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

  // Atomic credit deduction + duplicate check via stored procedure (the
  // duplicate check runs inside the same transaction as the credit row
  // lock, so two concurrent requests for the same user+song can't both
  // pass it — see migration 0008).
  const { data, error } = await supabaseAdmin.rpc('request_song', {
    p_venue_id: req.params.venueId,
    p_user_id: req.user.id,
    p_youtube_video_id: youtube_video_id,
    p_song_title: song_title,
    p_thumbnail_url: thumbnail_url ?? null,
    p_requester_name: requester_name,
    p_play_type: play_type,
    p_credits_to_charge: credits_to_charge,
    p_channel: channel ?? null,
  });

  if (error) {
    console.error('[queue/add]', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
  if (!data.success) return res.status(400).json({ error: data.error, credits_needed: credits_to_charge });
  return res.status(201).json({ success: true, queue_item_id: data.queue_item_id, credits_charged: credits_to_charge });
}));

// PATCH /api/venues/:venueId/queue/:itemId — update status (host only)
router.patch('/:itemId', requireAuth, body(schemas.updateQueueStatus), asyncHandler(async (req, res) => {
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

  const updates = { status };
  // Records when this row actually started playing, so a future stuck-'playing'
  // reconciliation (see GET /) can tell "still genuinely playing" apart from
  // "the host's session that would have advanced this is gone".
  if (status === 'playing') updates.started_playing_at = new Date().toISOString();

  const { data, error } = await supabaseAdmin
    .from('queue_items')
    .update(updates)
    .eq('id', req.params.itemId)
    .eq('venue_id', req.params.venueId)
    .select()
    .single();

  if (error) {
    console.error('[queue/patch]', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
  res.json(data);
}));

// DELETE /api/venues/:venueId/queue/:itemId — remove (host only), refunds if pending
router.delete('/:itemId', requireAuth, asyncHandler(async (req, res) => {
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
}));

export default router;
