import { Router } from 'express';
import { supabaseAdmin } from '../lib/supabase.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

// GET /api/users/profile
router.get('/profile', requireAuth, async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('*')
    .eq('id', req.user.id)
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// PUT /api/users/profile
router.put('/profile', requireAuth, async (req, res) => {
  const { display_name, language, role } = req.body;
  const updates = {};
  if (display_name !== undefined) updates.display_name = display_name;
  if (language !== undefined) updates.language = language;
  if (role !== undefined) updates.role = role;

  const { data, error } = await supabaseAdmin
    .from('users')
    .update(updates)
    .eq('id', req.user.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// GET /api/users/saved-rooms — rooms this guest has visited
router.get('/saved-rooms', requireAuth, async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('saved_rooms')
    .select('*, venue:venues(id, name, room_code, status)')
    .eq('user_id', req.user.id)
    .order('last_joined_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// POST /api/users/welcome/:venueId — grant welcome credits on first join
router.post('/welcome/:venueId', requireAuth, async (req, res) => {
  const { data, error } = await supabaseAdmin.rpc('grant_welcome_credits', {
    p_user_id: req.user.id,
    p_venue_id: req.params.venueId,
  });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

export default router;
