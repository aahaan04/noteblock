import { supabaseAdmin } from '../lib/supabase.js';

const RUN_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

// Simple keyword heuristic for genre/language tagging — deliberately basic
// per spec (no real YouTube category data is fetched/stored anywhere in this
// app). Only reads song titles, never guest-identifying fields.
const GENRE_KEYWORDS = {
  bollywood: ['bollywood', 'hindi', 'desi'],
  punjabi: ['punjabi', 'bhangra'],
  pop: ['pop'],
  hiphop: ['hip hop', 'hip-hop', 'rap'],
  edm: ['edm', 'house', 'techno', 'remix', 'dance'],
  rock: ['rock', 'metal'],
  lofi: ['lofi', 'lo-fi', 'chill'],
  latin: ['reggaeton', 'latin', 'spanish'],
  classical: ['classical', 'instrumental'],
};

function inferGenre(title) {
  const lower = (title ?? '').toLowerCase();
  for (const [genre, keywords] of Object.entries(GENRE_KEYWORDS)) {
    if (keywords.some(k => lower.includes(k))) return genre;
  }
  return 'other';
}

async function computeGenreBreakdown(venueId) {
  const { data, error } = await supabaseAdmin
    .from('queue_items')
    .select('song_title')
    .eq('venue_id', venueId);
  if (error || !data?.length) return {};

  const counts = {};
  for (const row of data) {
    const genre = inferGenre(row.song_title);
    counts[genre] = (counts[genre] ?? 0) + 1;
  }
  const total = data.length;
  const breakdown = {};
  for (const [genre, count] of Object.entries(counts)) {
    breakdown[genre] = Math.round((count / total) * 1000) / 10; // one decimal place, percentage
  }
  return breakdown;
}

// Recomputes venue_vibe_data for every venue that has request activity newer
// than its last generated row. Runs on a background interval — never called
// from the request_song path, never blocks a guest's song request.
export async function runVibeAggregation() {
  let venueRows;
  try {
    const { data, error } = await supabaseAdmin.rpc('venues_needing_vibe_update');
    if (error) { console.error('[vibe-aggregation] lookup failed:', error.message); return; }
    venueRows = data ?? [];
  } catch (e) {
    console.error('[vibe-aggregation] job failed to start:', e.message);
    return;
  }

  if (!venueRows.length) return;

  let processed = 0;
  for (const row of venueRows) {
    const venueId = row.venue_id;
    try {
      const { error: computeErr } = await supabaseAdmin.rpc('compute_venue_vibe_data', { p_venue_id: venueId });
      if (computeErr) {
        console.error(`[vibe-aggregation] compute failed for venue ${venueId}:`, computeErr.message);
        continue;
      }
      const genre_breakdown = await computeGenreBreakdown(venueId);
      await supabaseAdmin.from('venue_vibe_data').update({ genre_breakdown }).eq('venue_id', venueId);
      processed++;
    } catch (e) {
      console.error(`[vibe-aggregation] error processing venue ${venueId}:`, e.message);
    }
  }
  console.log(`[vibe-aggregation] processed ${processed}/${venueRows.length} venue(s) with new activity`);
}

// Starts the recurring background job. Safe to call once at server boot.
export function startVibeAggregationSchedule() {
  // Run once shortly after boot (avoid competing with startup work), then
  // on a fixed 15-minute interval indefinitely.
  setTimeout(runVibeAggregation, 30 * 1000);
  setInterval(runVibeAggregation, RUN_INTERVAL_MS);
}
