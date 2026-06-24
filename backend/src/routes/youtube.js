import { Router } from 'express';
import fetch from 'node-fetch';

const router = Router();
const YT_BASE = 'https://www.googleapis.com/youtube/v3';
const API_KEY = () => process.env.YOUTUBE_API_KEY;

const MAX_DURATION_SECONDS = 600; // 10 minutes

// GET /api/youtube/search?q=...
router.get('/search', async (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: 'q required' });

  const query = encodeURIComponent(q);

  try {
    // Fetch more than needed so we still have good results after filtering long videos
    const searchRes = await fetch(
      `${YT_BASE}/search?part=snippet&q=${query}&type=video&videoCategoryId=10&maxResults=20&key=${API_KEY()}`
    );
    const searchData = await searchRes.json();

    if (!searchData.items?.length) return res.json([]);

    // Get video durations in a second call
    const ids = searchData.items.map(i => i.id.videoId).join(',');
    const detailRes = await fetch(
      `${YT_BASE}/videos?part=contentDetails,snippet&id=${ids}&key=${API_KEY()}`
    );
    const detailData = await detailRes.json();

    const durationMap = {};
    for (const item of detailData.items ?? []) {
      const secs = parseDurationSeconds(item.contentDetails.duration);
      durationMap[item.id] = { secs, display: formatDuration(secs) };
    }

    const results = searchData.items
      .map(item => {
        const dur = durationMap[item.id.videoId];
        return {
          videoId: item.id.videoId,
          title: item.snippet.title,
          channel: item.snippet.channelTitle,
          thumbnail: item.snippet.thumbnails?.medium?.url ?? item.snippet.thumbnails?.default?.url,
          duration: dur?.display ?? null,
          durationSeconds: dur?.secs ?? null,
        };
      })
      // Filter out videos longer than 10 minutes (and live streams which have null/0 duration)
      .filter(r => r.durationSeconds !== null && r.durationSeconds > 0 && r.durationSeconds <= MAX_DURATION_SECONDS)
      .slice(0, 10);

    res.json(results);
  } catch (err) {
    console.error('YouTube search error:', err);
    res.status(500).json({ error: 'YouTube API error' });
  }
});

// GET /api/youtube/vibe?description=...&limit=50
// Searches for a playlist matching description and returns video IDs
router.get('/vibe', async (req, res) => {
  const { description, limit = 50 } = req.query;
  if (!description) return res.status(400).json({ error: 'description required' });

  try {
    // Search for a playlist
    const query = encodeURIComponent(description);
    const searchRes = await fetch(
      `${YT_BASE}/search?part=id&q=${query}&type=playlist&maxResults=3&regionCode=IN&key=${API_KEY()}`
    );
    const searchData = await searchRes.json();
    const playlistId = searchData.items?.[0]?.id?.playlistId;

    if (!playlistId) return res.json([]);

    const videos = await fetchPlaylistVideos(playlistId, parseInt(limit));
    res.json(videos);
  } catch (err) {
    console.error('Vibe search error:', err);
    res.status(500).json({ error: 'YouTube API error' });
  }
});

// GET /api/youtube/playlist?playlistId=...&limit=50
// Fetches video IDs from a given playlist ID or URL
router.get('/playlist', async (req, res) => {
  let { playlistId, url, limit = 50 } = req.query;

  if (!playlistId && url) {
    playlistId = extractPlaylistId(url);
  }
  if (!playlistId) return res.status(400).json({ error: 'playlistId or url required' });

  try {
    const videos = await fetchPlaylistVideos(playlistId, parseInt(limit));
    res.json(videos);
  } catch (err) {
    console.error('Playlist fetch error:', err);
    res.status(500).json({ error: 'YouTube API error' });
  }
});

// GET /api/youtube/suggestions?vibe=...
// Returns 5 song suggestions based on a vibe/mood description
router.get('/suggestions', async (req, res) => {
  const { vibe } = req.query;
  if (!vibe) return res.json([]);

  // Search for individual songs matching the vibe.
  // No videoCategoryId filter — it's too strict and excludes most non-Western
  // music. No "best songs mix" suffix — that returns long compilations which
  // are then all filtered out by the 10-minute duration cap.
  // Fetch 15 so the duration filter still leaves enough to show.
  const query = encodeURIComponent(`${vibe} song`);
  try {
    const searchRes = await fetch(
      `${YT_BASE}/search?part=snippet&q=${query}&type=video&maxResults=15&key=${API_KEY()}`
    );
    const searchData = await searchRes.json();
    if (!searchData.items?.length) return res.json([]);

    const ids = searchData.items.map(i => i.id.videoId).join(',');
    const detailRes = await fetch(
      `${YT_BASE}/videos?part=contentDetails,snippet&id=${ids}&key=${API_KEY()}`
    );
    const detailData = await detailRes.json();
    const durationMap = {};
    for (const item of detailData.items ?? []) {
      const secs = parseDurationSeconds(item.contentDetails.duration);
      durationMap[item.id] = { secs, display: formatDuration(secs) };
    }

    res.json(searchData.items
      .map(item => {
        const dur = durationMap[item.id.videoId];
        return {
          videoId: item.id.videoId,
          title: item.snippet.title,
          channel: item.snippet.channelTitle,
          thumbnail: item.snippet.thumbnails?.medium?.url ?? item.snippet.thumbnails?.default?.url,
          duration: dur?.display ?? null,
          durationSeconds: dur?.secs ?? null,
        };
      })
      .filter(r => r.durationSeconds !== null && r.durationSeconds > 0 && r.durationSeconds <= MAX_DURATION_SECONDS)
      .slice(0, 5)
    );
  } catch (err) {
    console.error('Suggestions error:', err);
    res.json([]);
  }
});

// ─── Helpers ───────────────────────────────────────────────────────────────

async function fetchPlaylistVideos(playlistId, maxResults = 50) {
  const videos = [];
  let pageToken = '';

  do {
    const pageParam = pageToken ? `&pageToken=${pageToken}` : '';
    const res = await fetch(
      `${YT_BASE}/playlistItems?part=contentDetails,snippet&playlistId=${playlistId}&maxResults=50${pageParam}&key=${API_KEY()}`
    );
    const data = await res.json();

    for (const item of data.items ?? []) {
      const videoId = item.contentDetails?.videoId;
      if (videoId) {
        videos.push({
          videoId,
          title: item.snippet?.title ?? 'Unknown',
          thumbnail: item.snippet?.thumbnails?.medium?.url,
        });
      }
    }

    pageToken = data.nextPageToken ?? '';
  } while (pageToken && videos.length < maxResults);

  return videos.slice(0, maxResults);
}

function parseDurationSeconds(iso) {
  if (!iso) return null;
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return null;
  return parseInt(m[1] ?? 0) * 3600 + parseInt(m[2] ?? 0) * 60 + parseInt(m[3] ?? 0);
}

function formatDuration(totalSeconds) {
  if (totalSeconds == null) return null;
  const mm = String(Math.floor(totalSeconds / 60)).padStart(1, '0');
  const ss = String(totalSeconds % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

function extractPlaylistId(url) {
  try {
    const u = new URL(url);
    return u.searchParams.get('list');
  } catch {
    return null;
  }
}

export default router;
