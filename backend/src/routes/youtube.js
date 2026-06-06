import { Router } from 'express';
import fetch from 'node-fetch';

const router = Router();
const YT_BASE = 'https://www.googleapis.com/youtube/v3';
const API_KEY = () => process.env.YOUTUBE_API_KEY;

// GET /api/youtube/search?q=...
router.get('/search', async (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: 'q required' });

  const query = encodeURIComponent(q);

  try {
    const searchRes = await fetch(
      `${YT_BASE}/search?part=snippet&q=${query}&type=video&videoCategoryId=10&maxResults=10&key=${API_KEY()}`
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
      durationMap[item.id] = parseDuration(item.contentDetails.duration);
    }

    const results = searchData.items.map(item => ({
      videoId: item.id.videoId,
      title: item.snippet.title,
      channel: item.snippet.channelTitle,
      thumbnail: item.snippet.thumbnails?.medium?.url ?? item.snippet.thumbnails?.default?.url,
      duration: durationMap[item.id.videoId] ?? null,
    }));

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

  // Search for top songs matching the vibe (not a playlist, actual song results)
  const query = encodeURIComponent(`${vibe} best songs mix`);
  try {
    const searchRes = await fetch(
      `${YT_BASE}/search?part=snippet&q=${query}&type=video&videoCategoryId=10&maxResults=5&key=${API_KEY()}`
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
      durationMap[item.id] = parseDuration(item.contentDetails.duration);
    }

    res.json(searchData.items.map(item => ({
      videoId: item.id.videoId,
      title: item.snippet.title,
      channel: item.snippet.channelTitle,
      thumbnail: item.snippet.thumbnails?.medium?.url ?? item.snippet.thumbnails?.default?.url,
      duration: durationMap[item.id.videoId] ?? null,
    })));
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

function parseDuration(iso) {
  if (!iso) return null;
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return null;
  const h = parseInt(m[1] ?? 0);
  const min = parseInt(m[2] ?? 0);
  const s = parseInt(m[3] ?? 0);
  const total = h * 3600 + min * 60 + s;
  const mm = String(Math.floor(total / 60)).padStart(1, '0');
  const ss = String(total % 60).padStart(2, '0');
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
