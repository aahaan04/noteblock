import { z } from 'zod';

// Validate req.body against a zod schema; replaces body with parsed/coerced data.
export function body(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const first = result.error.errors[0];
      const field = first.path.join('.') || 'body';
      return res.status(400).json({ error: `${field}: ${first.message}` });
    }
    req.body = result.data;
    next();
  };
}

// Strip control characters and normalise whitespace from user-supplied strings.
const clean = (s) => s.replace(/[\x00-\x1F\x7F]/g, '').trim();
const safeName = (max = 100) =>
  z.string().trim().min(1).max(max).transform(clean);
const optUrl = z.string().url().max(500).nullable().optional();
const videoId = z.string().regex(/^[a-zA-Z0-9_-]{11}$/, 'Invalid YouTube video ID');

export const schemas = {
  // POST /api/venues
  createVenue: z.object({
    name: safeName(100),
    welcome_credits: z.number().int().min(0).max(200).optional(),
    crossfade_duration_seconds: z.number().int().min(2).max(10).optional(),
  }),

  // PUT /api/venues/:id
  updateVenue: z.object({
    name: safeName(100).optional(),
    status: z.enum(['active', 'closed']).optional(),
    welcome_credits: z.number().int().min(0).max(200).optional(),
    crossfade_duration_seconds: z.number().int().min(2).max(10).optional(),
    vibe_description: z.string().trim().max(500).nullable().optional(),
    vibe_playlist_urls: z.array(z.string().url().max(500)).max(20).optional(),
    vibe_mode_enabled: z.boolean().optional(),
    vibe_current_video_index: z.number().int().min(0).optional(),
    vibe_current_position_seconds: z.number().min(0).optional(),
    jukebox_paused: z.boolean().optional(),
    queue_open_when_paused: z.boolean().optional(),
    vibe_played_video_ids: z.array(z.string().max(30)).max(2000).optional(),
    vibe_now_playing_title: z.string().trim().max(300).nullable().optional(),
    vibe_now_playing_channel: z.string().trim().max(200).nullable().optional(),
    vibe_now_playing_thumbnail: optUrl,
  }).strict(),

  // POST /api/venues/:id/banned (songs)
  banSong: z.object({
    youtube_video_id: videoId,
    song_title: z.string().trim().max(300).optional(),
    thumbnail_url: optUrl,
    channel: z.string().trim().max(200).nullable().optional(),
  }),

  // POST /api/venues/:id/gift
  gift: z.object({
    guest_identifier: safeName(100),
    amount: z.number().int().min(1).max(10000),
  }),

  // POST /api/venues/:id/banned-users
  banUser: z.object({
    requester_name: safeName(80),
  }),

  // POST /api/venues/:venueId/queue
  addQueue: z.object({
    youtube_video_id: videoId,
    song_title: z.string().trim().min(1).max(300).transform(clean),
    thumbnail_url: optUrl,
    play_type: z.enum(['normal', 'quick']),
    requester_name: safeName(80).optional(),
  }),

  // PATCH /api/venues/:venueId/queue/:itemId
  updateQueueStatus: z.object({
    status: z.enum(['playing', 'played', 'removed']),
  }),

  // PUT /api/users/profile
  // NOTE: 'role' is intentionally absent — users must not change their own role.
  updateProfile: z.object({
    display_name: safeName(50).optional(),
    language: z.enum(['en', 'hi', 'zh']).optional(),
  }),
};
