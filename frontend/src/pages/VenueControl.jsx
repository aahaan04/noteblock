import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Music, Play, Pause, SkipForward, ListMusic, Radio,
  Ban, Users, BarChart2, QrCode, RefreshCw, MoreHorizontal,
  Gift, Check, X, ChevronUp, ChevronDown, Save, AlertTriangle, Settings2,
  Download, ShieldOff, Upload, FileJson, Lock,
} from 'lucide-react';

const decode = s => s?.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&#x27;/g, "'") ?? s;

const HOST_FONT = "'Manrope', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

// Builds a vibeVideos-shaped pool ({videoId, title, channel, thumbnail}) from
// a venue_vibe_data-shaped object (either the venue's own auto-generated data,
// or an uploaded file — both have the same top_songs_* shape). Weights the
// last-30-days list more heavily than all-time, per spec. This only changes
// which pool CrossfadePlayer draws from — the crossfade/no-repeat/exhaustion
// logic in CrossfadePlayer itself is untouched, it just treats this like any
// other vibeVideos array.
const VIBE_RECENT_WEIGHT = 3;
const VIBE_ALLTIME_WEIGHT = 1;
const VIBE_POOL_MAX = 40;

function buildVibeVideosFromTopSongs(vibeData) {
  if (!vibeData) return [];
  const recent = vibeData.top_songs_last_30_days ?? [];
  const alltime = vibeData.top_songs_alltime ?? [];
  const scored = new Map(); // video_id -> { videoId, title, channel, thumbnail, score }

  for (const s of recent) {
    if (!s?.video_id) continue;
    scored.set(s.video_id, {
      videoId: s.video_id, title: s.title ?? 'Vibe Track', channel: s.artist ?? null, thumbnail: s.thumbnail ?? null,
      score: (s.request_count ?? 1) * VIBE_RECENT_WEIGHT,
    });
  }
  for (const s of alltime) {
    if (!s?.video_id) continue;
    const addScore = (s.request_count ?? 1) * VIBE_ALLTIME_WEIGHT;
    const existing = scored.get(s.video_id);
    if (existing) existing.score += addScore;
    else scored.set(s.video_id, {
      videoId: s.video_id, title: s.title ?? 'Vibe Track', channel: s.artist ?? null, thumbnail: s.thumbnail ?? null,
      score: addScore,
    });
  }

  return [...scored.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, VIBE_POOL_MAX)
    .map(({ videoId, title, channel, thumbnail }) => ({ videoId, title, channel, thumbnail }));
}

// Bumped from 768 to 1024 so the two-column desktop layout only applies on
// genuinely wide viewports — tablets now get the (already mobile-tuned)
// stacked layout instead of a cramped two-column squeeze, matching how the
// guest UI treats <=1024 as "mobile" for background-audio purposes too.
function useIsMobile() {
  const [mobile, setMobile] = useState(() => window.innerWidth < 1024);
  useEffect(() => {
    const fn = () => setMobile(window.innerWidth < 1024);
    window.addEventListener('resize', fn);
    return () => window.removeEventListener('resize', fn);
  }, []);
  return mobile;
}
import Logo from '../components/Logo.jsx';
import VersionFooter from '../components/VersionFooter.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useLang } from '../context/LangContext.jsx';
import { api } from '../lib/api.js';
import { supabase } from '../lib/supabase.js';
import CrossfadePlayer from '../components/CrossfadePlayer.jsx';
import Visualizer from '../components/Visualizer.jsx';
import QueueDisplay from '../components/QueueDisplay.jsx';
import VenueQRCode from '../components/VenueQRCode.jsx';
import SongSearch from '../components/SongSearch.jsx';
import SongThumb from '../components/SongThumb.jsx';

export default function VenueControl() {
  const { id } = useParams();
  const { token, signOut } = useAuth();
  const { t } = useLang();
  const navigate = useNavigate();
  const playerRef = useRef(null);
  const isMobile = useIsMobile();

  const [venue, setVenue] = useState(null);
  const [queue, setQueue] = useState([]);
  const [banned, setBanned] = useState([]);
  const [vibeVideos, setVibeVideos] = useState([]);
  const [nowPlaying, setNowPlaying] = useState(null);
  const [vibeActive, setVibeActive] = useState(false);
  const [vibePlayedIds, setVibePlayedIds] = useState([]); // IDs of vibe videos already played this session
  const [tab, setTab] = useState(() => window.innerWidth < 768 ? 'player' : 'queue');
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [skipping, setSkipping] = useState(false);

  // One-time mobile check (≤1024px or mobile OS — per background-audio spec)
  // eslint-disable-next-line no-undef
  const isMobileFeatures = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || window.innerWidth <= 1024;
  // Android Chrome restore banner — populated on mount if a recent session was found
  const [resumeBanner, setResumeBanner] = useState(null); // { videoId, title, elapsed }
  // Ref so beforeunload can read nowPlaying without a stale closure
  const nowPlayingRef = useRef(null);
  useEffect(() => { nowPlayingRef.current = nowPlaying; }, [nowPlaying]);

  useEffect(() => {
    if (!id || !token) return;
    loadVenue(); loadQueue(); loadBanned();
  }, [id, token]);

  // Write vibe track info to venue so guests can see what's playing
  useEffect(() => {
    if (!id || !token) return;
    if (nowPlaying?.type === 'vibe' && nowPlaying.videoId) {
      const match = vibeVideos.find(v => v.videoId === nowPlaying.videoId);
      api.venues.update(id, {
        vibe_now_playing_title: nowPlaying.title ?? null,
        vibe_now_playing_channel: match?.channel ?? null,
        vibe_now_playing_thumbnail: match?.thumbnail ?? null,
      }, token).catch(() => {});
    } else if (nowPlaying?.type !== 'vibe') {
      api.venues.update(id, { vibe_now_playing_title: null, vibe_now_playing_channel: null, vibe_now_playing_thumbnail: null }, token).catch(() => {});
    }
  }, [nowPlaying?.videoId]); // eslint-disable-line

  // Keep latest token reachable from realtime callbacks (which capture [id] only).
  const tokenRef = useRef(token);
  useEffect(() => { tokenRef.current = token; }, [token]);

  // Sign out host after 4 hours of inactivity
  const inactivityTimerRef = useRef(null);
  useEffect(() => {
    const TIMEOUT_MS = 4 * 60 * 60 * 1000;
    const reset = () => {
      clearTimeout(inactivityTimerRef.current);
      inactivityTimerRef.current = setTimeout(() => {
        signOut();
        navigate('/host/login');
      }, TIMEOUT_MS);
    };
    reset();
    window.addEventListener('mousemove', reset);
    window.addEventListener('keydown', reset);
    window.addEventListener('click', reset);
    return () => {
      clearTimeout(inactivityTimerRef.current);
      window.removeEventListener('mousemove', reset);
      window.removeEventListener('keydown', reset);
      window.removeEventListener('click', reset);
    };
  }, []); // eslint-disable-line

  // Android Chrome: on mount, check if the OS killed the tab mid-song and offer to resume
  useEffect(() => {
    if (!isMobileFeatures || !id) return;
    try {
      const raw = localStorage.getItem(`nb_session_${id}`);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (Date.now() - (saved.timestamp ?? 0) < 30 * 60 * 1000 && saved.videoId) {
        setResumeBanner(saved);
      }
      localStorage.removeItem(`nb_session_${id}`);
    } catch {}
  }, []); // eslint-disable-line

  // Android Chrome: persist playback state to localStorage before the tab unloads
  // (the visibilitychange in CrossfadePlayer covers backgrounding; this covers full unload)
  useEffect(() => {
    if (!isMobileFeatures) return;
    function onBeforeUnload() {
      const np = nowPlayingRef.current;
      if (!np || !id) return;
      const elapsed = playerRef.current?.getElapsed?.() ?? 0;
      const title = np.type === 'requested' ? np.item?.song_title : (np.title ?? 'Song');
      try {
        localStorage.setItem(`nb_session_${id}`, JSON.stringify({
          videoId: np.videoId, title: title ?? 'Song', elapsed, timestamp: Date.now(),
        }));
      } catch {}
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [id]); // eslint-disable-line

  // Media Session API — provides lock-screen metadata and headphone/Bluetooth controls
  // Re-registers handlers on every nowPlaying/pause-state change for fresh closures
  useEffect(() => {
    if (!navigator.mediaSession) return;
    if (!nowPlaying) {
      try { navigator.mediaSession.playbackState = 'none'; } catch {}
      return;
    }
    const title  = nowPlaying.type === 'requested' ? decode(nowPlaying.item?.song_title ?? '') : (nowPlaying.title ?? 'Vibe');
    const artist = nowPlaying.type === 'requested' ? (nowPlaying.item?.requester_name ?? 'Guest') : 'Vibe Mode';
    try {
      navigator.mediaSession.metadata      = new MediaMetadata({ title, artist, album: 'Noteblock' });
      navigator.mediaSession.playbackState = venue?.jukebox_paused ? 'paused' : 'playing';
      navigator.mediaSession.setActionHandler('play',      () => handleVenueUpdate({ jukebox_paused: false }));
      navigator.mediaSession.setActionHandler('pause',     () => handleVenueUpdate({ jukebox_paused: true }));
      navigator.mediaSession.setActionHandler('nexttrack', () => handleSkip());
    } catch {}
  }, [nowPlaying, venue?.jukebox_paused]); // eslint-disable-line

  async function loadVenue() {
    try {
      const v = await api.venues.get(id, token);
      setVenue(v); setLoading(false);
      // Restore played vibe IDs from Supabase (persists across browser sessions)
      if (v.vibe_played_video_ids?.length) setVibePlayedIds(v.vibe_played_video_ids);
      if (v.vibe_mode_enabled) loadVibeVideos(v);
    } catch { navigate('/host/dashboard'); }
  }
  // Lightweight venue re-fetch (no vibe-playlist reload) for realtime updates.
  async function refetchVenue() {
    try { const v = await api.venues.get(id, tokenRef.current); setVenue(v); } catch {}
  }
  // Re-fetch AND reload the vibe pool from the fresh data — used specifically
  // after an upload/remove-vibe-file action, so a new file takes effect
  // immediately if "Uploaded File" is the active source. Deliberately
  // separate from refetchVenue (used by the realtime subscription on every
  // venue change) so this heavier reload never runs on unrelated updates.
  async function refetchVenueAndVibe() {
    try {
      const v = await api.venues.get(id, tokenRef.current);
      setVenue(v);
      if (v.vibe_mode_enabled) loadVibeVideos(v);
    } catch {}
  }
  async function loadQueue() {
    try { const q = await api.queue.list(id); setQueue(q); } catch {}
  }
  async function loadBanned() {
    try { const b = await api.venues.banned.list(id); setBanned(b); } catch {}
  }
  async function loadStats() {
    try { const s = await api.venues.stats(id, token); setStats(s); } catch {}
  }
  async function loadVibeVideos(v = venue) {
    if (!v) return;
    try {
      let videos = [];
      const source = v.vibe_source ?? 'description';

      if (source === 'playlist') {
        if (v.vibe_playlist_urls?.length) {
          for (const url of v.vibe_playlist_urls) {
            const playlistId = new URL(url).searchParams.get('list');
            if (playlistId) videos = [...videos, ...(await api.youtube.playlist(playlistId))];
          }
        }
      } else if (source === 'description') {
        if (v.vibe_description) videos = await api.youtube.vibe(v.vibe_description);
      } else if (source === 'upload') {
        // Uploaded file's top_songs data — never the venue's own collected data.
        videos = buildVibeVideosFromTopSongs(v.uploaded_vibe_data);
      } else if (source === 'auto') {
        // The venue's own auto-generated stats (fetched fresh — this is a
        // background/manual-triggered read, never on the request_song path).
        const data = await api.venues.vibeData(id, tokenRef.current).catch(() => null);
        videos = buildVibeVideosFromTopSongs(data);
      }

      setVibeVideos(videos);
    } catch {}
  }

  useEffect(() => {
    if (!id) return;
    const qSub = supabase.channel(`venue-queue-${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'queue_items', filter: `venue_id=eq.${id}` }, () => loadQueue())
      .subscribe();
    const vSub = supabase.channel(`venue-${id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'venues', filter: `id=eq.${id}` }, () => refetchVenue())
      .subscribe();
    return () => { supabase.removeChannel(qSub); supabase.removeChannel(vSub); };
  }, [id]);

  const handleMarkPlaying = useCallback(async (itemId) => {
    await api.queue.updateStatus(id, itemId, 'playing', token).catch(() => {});
  }, [id, token]);
  const handleMarkPlayed = useCallback(async (itemId) => {
    await api.queue.updateStatus(id, itemId, 'played', token).catch(() => {});
  }, [id, token]);

  async function handleVibePlayed(videoId) {
    setVibePlayedIds(prev => {
      if (prev.includes(videoId)) return prev;
      const next = [...prev, videoId];
      // Persist to Supabase in background — don't await to avoid blocking playback
      api.venues.update(id, { vibe_played_video_ids: next }, token).catch(() => {});
      return next;
    });
  }

  function handleSkip() {
    if (skipping) return;
    setSkipping(true);
    playerRef.current?.skip();
    setTimeout(() => setSkipping(false), 2500);
  }
  // Stable reference so React.memo(QueueDisplay/QueueItem) can skip re-renders
  // when VenueControl re-renders for unrelated reasons (nowPlaying, venue, etc.).
  const handleRemove = useCallback(async (itemId) => {
    await api.queue.remove(id, itemId, token).catch(() => {});
  }, [id, token]); // eslint-disable-line
  async function handleVenueUpdate(updates) {
    try {
      const updated = await api.venues.update(id, updates, token);
      setVenue(updated);
      if (updates.vibe_mode_enabled !== undefined || updates.vibe_description !== undefined || updates.vibe_playlist_urls !== undefined || updates.vibe_source !== undefined) loadVibeVideos(updated);
    } catch {}
  }

  function handleResumeSaved() {
    if (!resumeBanner) return;
    const saved = resumeBanner;
    setResumeBanner(null);
    setTab('player');
    playerRef.current?.resumeFromSaved?.({ videoId: saved.videoId, title: saved.title, elapsed: saved.elapsed ?? 0 });
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-secondary)', background: 'var(--bg-app)', minHeight: '100vh' }}>{t.loading}</div>;
  if (!venue) return null;

  const bannedIds = new Set(banned.map(b => b.youtube_video_id));
  const pendingQueue = queue.filter(i => i.status === 'pending');
  const isActive = venue.status === 'active';

  const nowPlayingTitle = nowPlaying?.type === 'requested' ? nowPlaying?.item?.song_title : (nowPlaying?.type === 'vibe' ? nowPlaying?.title : null);
  const nowPlayingRequester = nowPlaying?.type === 'requested' ? nowPlaying?.item?.requester_name : null;
  const vibeChannel = nowPlaying?.type === 'vibe'
    ? (vibeVideos.find(v => v.videoId === nowPlaying.videoId)?.channel ?? 'YouTube')
    : null;

  // Player panel — shared between mobile and desktop
  const playerPanel = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Visualizer box — one bordered card containing the canvas + song info,
          matching the mockup's combined .visualizer-box treatment */}
      <div style={{
        background: 'radial-gradient(ellipse at center, rgba(255,107,53,0.10) 0%, var(--bg-page) 70%)',
        border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden',
      }}>
        {/* Player + Visualizer stacked */}
        <div style={{ position: 'relative', width: '100%', aspectRatio: '16/9' }}>
          {/* Hidden YouTube players — always in DOM */}
          <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', zIndex: 0, opacity: 0, pointerEvents: 'none' }}>
            <CrossfadePlayer
              ref={playerRef} queue={queue} vibeVideos={vibeVideos}
              vibeEnabled={venue.vibe_mode_enabled} crossfadeSecs={venue.crossfade_duration_seconds}
              jukeboxPaused={venue.jukebox_paused ?? false}
              vibePlayedIds={vibePlayedIds}
              onMarkPlaying={handleMarkPlaying} onMarkPlayed={handleMarkPlayed}
              onNowPlaying={setNowPlaying} onVibeActive={setVibeActive}
              onVibePlayed={handleVibePlayed} venueId={id}
            />
          </div>
          {/* Visualizer on top — purely cosmetic */}
          <div style={{ position: 'absolute', inset: 0, zIndex: 1 }}>
            <Visualizer
              isPlaying={!!(nowPlaying || vibeActive) && !venue.jukebox_paused}
              songTitle={nowPlayingTitle}
              requester={nowPlayingRequester}
            />
          </div>
        </div>
        {/* Song info bar below visualizer, inside the same bordered box */}
        {!venue.jukebox_paused && (nowPlayingTitle || vibeActive) && (
          <div style={{ padding: '12px 16px 16px', minWidth: 0, textAlign: 'center' }}>
            {nowPlaying?.type === 'vibe' ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, marginBottom: 3 }}>
                  <Radio size={12} color="var(--text-secondary)" />
                  <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: 2, textTransform: 'uppercase', color: 'var(--text-secondary)' }}>{t.vibeModeLabel}</span>
                </div>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {nowPlayingTitle ?? <span style={{ color: 'var(--text-muted)' }}>{t.loading}</span>}
                </div>
                {vibeChannel && <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 3 }}>{vibeChannel}</div>}
              </>
            ) : (
              <>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {decode(nowPlayingTitle)}
                </div>
                {nowPlayingRequester && (
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 3 }}>by {nowPlayingRequester}</div>
                )}
              </>
            )}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <button
          onClick={() => handleVenueUpdate({ jukebox_paused: !venue.jukebox_paused })}
          style={{
            flex: 1, height: 48, borderRadius: 9, border: '1px solid #3D2B1A',
            background: 'var(--border)', color: 'var(--text-primary)', fontWeight: 700, fontSize: 14,
            fontFamily: 'inherit', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
          }}
        >
          {venue.jukebox_paused ? <><Play size={16} /> {t.resume}</> : <><Pause size={16} /> {t.pause}</>}
        </button>
        {!nowPlaying && !venue.jukebox_paused && (
          <button
            onClick={() => playerRef.current?.start()}
            style={{
              flex: 1, height: 48, borderRadius: 9, border: 'none',
              background: '#22c55e', color: 'var(--bg-app)', fontWeight: 700, fontSize: 14,
              fontFamily: 'inherit', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
              boxShadow: '0 0 14px rgba(34,197,94,0.35)',
            }}
          >
            <Play size={16} /> {t.start}
          </button>
        )}
        {nowPlaying && !venue.jukebox_paused && (
          <button
            onClick={handleSkip} disabled={skipping}
            style={{
              flex: 1, height: 48, borderRadius: 9, border: 'none',
              background: '#FF6B35', color: '#0E0A07', fontWeight: 800, fontSize: 14,
              fontFamily: 'inherit', cursor: skipping ? 'default' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
              boxShadow: '0 0 14px rgba(255,107,53,0.4)',
              opacity: skipping ? 0.5 : 1,
            }}
          >
            <SkipForward size={16} /> {skipping ? '…' : t.skip}
          </button>
        )}
      </div>
      {venue.jukebox_paused && (
        <div style={{ background: '#2A1408', border: '1px solid #FF6B35', borderRadius: 10, padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 10, margin: '0' }}>
          <AlertTriangle size={18} color="#FF6B35" style={{ flexShrink: 0 }} />
          <span style={{ fontSize: 12, color: 'var(--credits)', fontWeight: 600, lineHeight: 1.4 }}>{t.guestsCannotRequest}</span>
        </div>
      )}
    </div>
  );

  // Tab content
  const tabContent = (
    <>
      {tab === 'queue' && (
        <>
          {!isMobile && <div style={{ fontSize: 19, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 20 }}>Up Next</div>}
          <QueueDisplay items={queue} isHost onRemove={handleRemove} />
        </>
      )}
      {tab === 'vibe'   && <VibeSettings venue={venue} venueId={id} token={token} onUpdate={handleVenueUpdate} onVenueRefresh={refetchVenueAndVibe} vibePlayedCount={vibePlayedIds.length} onResetVibeHistory={() => { setVibePlayedIds([]); handleVenueUpdate({ vibe_played_video_ids: [] }); }} />}
      {tab === 'ban'    && <BanManager venueId={id} token={token} banned={banned} bannedIds={bannedIds} onReload={loadBanned} />}
      {tab === 'users'  && <UsersPanel venueId={id} token={token} />}
      {tab === 'stats'  && <StatsPanel stats={stats} />}
      {tab === 'qr'     && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 24 }}>
          <VenueQRCode roomCode={venue.room_code} size={260} />
        </div>
      )}
    </>
  );

  // ── Top bar ───────────────────────────────────────────────────────────────────
  const topBar = (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: isMobile ? '10px 12px' : '16px 24px',
      background: 'var(--bg-card)', borderBottom: '1px solid var(--border)', flexShrink: 0,
    }}>
      <button onClick={() => navigate('/host/dashboard')} style={{
        width: 34, height: 34, borderRadius: 10, border: 'none', background: 'var(--border)',
        color: 'var(--text-primary)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>
        <ArrowLeft size={17} />
      </button>
      {!isMobile && <Logo size={26} />}
      <h1 style={{ margin: 0, fontSize: isMobile ? 15 : 17, fontWeight: 800, flex: 1, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', letterSpacing: '-0.3px' }}>
        {venue.name}
      </h1>
      <span style={{
        display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0,
        fontSize: 11, fontWeight: 700, padding: '5px 10px', borderRadius: 999,
        background: isActive ? 'rgba(34,197,94,0.12)' : 'var(--border)',
        border: isActive ? '1px solid rgba(34,197,94,0.3)' : 'none',
        color: isActive ? '#4ADE80' : 'var(--text-muted)',
      }}>
        {isActive && <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#4ADE80' }} />}
        {isActive ? t.active : t.closed}
      </span>
      {vibeActive && !isMobile && <span style={{ fontSize: 12, color: '#FF6B35', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}><Music size={13} /> Vibe</span>}
      <button
        onClick={() => handleVenueUpdate({ status: isActive ? 'closed' : 'active' })}
        style={{
          background: 'var(--border)', border: '1px solid #3D2B1A', borderRadius: 9,
          color: 'var(--text-primary)', cursor: 'pointer', fontFamily: 'inherit',
          fontSize: isMobile ? 11 : 13, fontWeight: 700, padding: isMobile ? '7px 10px' : '9px 16px', flexShrink: 0,
        }}
      >
        {isActive ? (isMobile ? 'Close' : t.closeRoom) : (isMobile ? 'Open' : t.openRoomAction)}
      </button>
    </div>
  );

  // ── MOBILE layout ─────────────────────────────────────────────────────────────
  if (isMobile) {
    const mobileTabs = [
      { key: 'player', icon: <Music size={20} />,     label: 'Player' },
      { key: 'queue',  icon: <ListMusic size={20} />, label: `Queue${pendingQueue.length ? ` (${pendingQueue.length})` : ''}` },
      { key: 'users',  icon: <Users size={20} />,     label: t.users },
      { key: 'manage', icon: <Settings2 size={20} />, label: 'Manage' },
      { key: 'qr',     icon: <QrCode size={20} />,    label: 'QR' },
    ];
    // 'manage' opens a sub-tab row with vibe/ban/stats
    const manageTabs = [
      { key: 'vibe',  label: t.vibe },
      { key: 'ban',   label: 'Ban Songs' },
      { key: 'stats', label: t.stats },
    ];
    const activeMainTab = ['vibe', 'ban', 'stats'].includes(tab) ? 'manage' : tab === 'player' ? 'player' : tab;

    return (
      <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg-app)', fontFamily: HOST_FONT }}>
        {topBar}

        {/* Scrollable content */}
        <div className="no-scrollbar" style={{ flex: 1, overflowY: 'auto', padding: '14px 14px 0' }}>
          {/* Android Chrome restore banner — only shown when a recent interrupted session is found */}
          {resumeBanner && activeMainTab === 'player' && (
            <div style={{
              background: 'rgba(255,107,53,0.10)', border: '1px solid rgba(255,107,53,0.45)',
              borderRadius: 10, padding: '12px 14px', marginBottom: 12,
              display: 'flex', alignItems: 'center', gap: 10,
            }}>
              <Music size={18} color="#FF6B35" style={{ flexShrink: 0 }} />
              <span style={{ flex: 1, fontSize: 13, color: 'var(--text-primary)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                Resume &ldquo;{resumeBanner.title}&rdquo;?
              </span>
              <button onClick={handleResumeSaved} style={{ padding: '6px 12px', borderRadius: 7, border: 'none', background: '#FF6B35', color: '#fff', fontSize: 12, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer', flexShrink: 0 }}>
                Resume
              </button>
              <button onClick={() => setResumeBanner(null)} style={{ padding: 4, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', flexShrink: 0, display: 'flex' }}>
                <X size={16} />
              </button>
            </div>
          )}
          {activeMainTab === 'player' && playerPanel}

          {activeMainTab === 'queue' && tabContent}

          {activeMainTab === 'users' && tabContent}

          {activeMainTab === 'manage' && (
            <>
              {/* Sub-tab row */}
              <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
                {manageTabs.map(mt => (
                  <button key={mt.key} onClick={() => { setTab(mt.key); if (mt.key === 'stats') loadStats(); }} style={{
                    flex: 1, padding: '8px 4px', borderRadius: 7, border: 'none', cursor: 'pointer',
                    background: tab === mt.key ? '#FF6B35' : 'var(--bg-card)',
                    color: tab === mt.key ? 'var(--text-primary)' : 'var(--text-secondary)',
                    fontSize: 12, fontWeight: 600, fontFamily: 'inherit',
                  }}>
                    {mt.label}
                  </button>
                ))}
              </div>
              {tabContent}
            </>
          )}

          {activeMainTab === 'qr' && tabContent}
        </div>

        {/* Bottom nav */}
        <div style={{
          display: 'flex', borderTop: '1px solid var(--border)',
          background: 'var(--bg-page)', flexShrink: 0,
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}>
          {mobileTabs.map(({ key, icon, label }) => {
            const active = activeMainTab === key;
            return (
              <button key={key}
                onClick={() => {
                  if (key === 'player') setTab('player');
                  else if (key === 'queue') setTab('queue');
                  else if (key === 'users') setTab('users');
                  else if (key === 'manage') { if (!['vibe','ban','stats'].includes(tab)) setTab('vibe'); }
                  else if (key === 'qr') setTab('qr');
                }}
                style={{
                  flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  gap: 3, padding: '10px 4px', background: 'none', border: 'none', cursor: 'pointer',
                  color: active ? '#FF6B35' : 'var(--text-muted)',
                }}
              >
                {icon}
                <span style={{ fontSize: 9, fontWeight: 600, fontFamily: 'inherit' }}>{label}</span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // ── DESKTOP layout ────────────────────────────────────────────────────────────
  const desktopTabs = [
    { key: 'queue',  icon: <ListMusic size={14} />, label: `${t.queue} (${pendingQueue.length})` },
    { key: 'vibe',   icon: <Radio size={14} />,    label: t.vibe },
    { key: 'ban',    icon: <Ban size={14} />,       label: t.bannedSongs },
    { key: 'users',  icon: <Users size={14} />,     label: t.users },
    { key: 'stats',  icon: <BarChart2 size={14} />, label: t.stats },
    { key: 'qr',     icon: <QrCode size={14} />,    label: 'QR' },
  ];

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg-app)', fontFamily: HOST_FONT }}>
      {topBar}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Left — player, persistent across all tabs */}
        <div className="no-scrollbar" style={{ width: 380, flexShrink: 0, padding: 20, display: 'flex', flexDirection: 'column', gap: 16, overflowY: 'auto', background: 'var(--bg-card)', borderRight: '1px solid var(--border)' }}>
          {playerPanel}
        </div>
        {/* Right — tabs */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
          <div className="no-scrollbar" style={{ display: 'flex', gap: 6, padding: '16px 24px', borderBottom: '1px solid var(--border)', overflowX: 'auto', flexShrink: 0 }}>
            {desktopTabs.map(({ key, icon, label }) => (
              <button key={key}
                onClick={() => { setTab(key); if (key === 'stats') loadStats(); }}
                style={{
                  padding: '9px 16px', borderRadius: 9, border: 'none', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
                  background: tab === key ? '#FF6B35' : 'transparent',
                  color: tab === key ? '#0E0A07' : 'var(--text-secondary)',
                  fontSize: 13, fontWeight: 700, fontFamily: 'inherit',
                  display: 'flex', alignItems: 'center', gap: 7,
                  transition: 'background 0.15s',
                }}
                onMouseEnter={e => { if (tab !== key) e.currentTarget.style.background = 'var(--bg-card)'; }}
                onMouseLeave={e => { if (tab !== key) e.currentTarget.style.background = 'transparent'; }}
              >
                {icon} {label}
              </button>
            ))}
          </div>
          <div className="no-scrollbar" style={{ flex: 1, overflowY: 'auto', padding: '26px 28px' }}>
            {tabContent}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Toggle component ──────────────────────────────────────────────────────────

// Bare toggle row — meant to sit directly inside a settings-block card
// (matching the mockup's .toggle-row, which has no border/background of its own).
function Toggle({ checked, onChange, label, description }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary)' }}>{label}</div>
        {description && <div style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 500, lineHeight: 1.5, marginTop: 4, maxWidth: 380 }}>{description}</div>}
      </div>
      <button
        onClick={onChange}
        style={{
          flexShrink: 0, width: 44, height: 26, borderRadius: 13,
          border: `1px solid ${checked ? '#FF6B35' : '#3D2B1A'}`, cursor: 'pointer',
          background: checked ? '#FF6B35' : 'var(--border)',
          position: 'relative', transition: 'background 0.2s',
          padding: 0,
        }}
      >
        <span style={{
          position: 'absolute', top: 3, left: checked ? 22 : 3,
          width: 18, height: 18, borderRadius: '50%', background: checked ? '#0E0A07' : 'var(--text-primary)',
          transition: 'left 0.2s', display: 'block',
        }} />
      </button>
    </div>
  );
}

// Card wrapper for grouped settings sections, matching mockup's .settings-block.
function SettingsBlock({ label, children }) {
  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14, padding: 18 }}>
      {label && (
        <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 14 }}>
          {label}
        </div>
      )}
      {children}
    </div>
  );
}

// ── Vibe settings ─────────────────────────────────────────────────────────────

const VIBE_SOURCE_OPTIONS = [
  { key: 'description', label: 'Manual Description' },
  { key: 'playlist', label: 'Playlist URLs' },
  { key: 'upload', label: 'Uploaded File' },
  { key: 'auto', label: 'Auto-Vibe' },
];

function VibeSettings({ venue, venueId, token, onUpdate, onVenueRefresh, vibePlayedCount = 0, onResetVibeHistory }) {
  const { t } = useLang();
  const [desc, setDesc] = useState(venue.vibe_description ?? '');
  const [urls, setUrls] = useState((venue.vibe_playlist_urls ?? []).join('\n'));
  const [enabled, setEnabled] = useState(venue.vibe_mode_enabled);
  const [crossfade, setCrossfade] = useState(venue.crossfade_duration_seconds);
  const [welcome, setWelcome] = useState(venue.welcome_credits);
  const [saving, setSaving] = useState(false);

  // Vibe source selector — which of the 4 sources is active for playback.
  const [source, setSource] = useState(venue.vibe_source ?? 'description');
  const [vibeData, setVibeData] = useState(null); // this venue's own venue_vibe_data row
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.venues.vibeData(venueId, token)
      .then(data => { if (!cancelled) setVibeData(data); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [venueId, token]);

  const requestsSoFar = vibeData?.total_requests_alltime ?? 0;
  const vibeReady = vibeData?.vibe_ready ?? false;

  async function handleSourceChange(key) {
    if (key === 'auto' && !vibeReady) return; // locked — button is disabled too, this is just a safety net
    setSource(key);
    await onUpdate({ vibe_source: key });
  }

  async function handleFileChange(e) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same filename later
    if (!file) return;
    setUploadError('');
    setUploading(true);
    try {
      const text = await file.text();
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        setUploadError('Invalid JSON format — could not parse this file.');
        return;
      }
      await api.venues.uploadVibeFile(venueId, { filename: file.name, data: parsed }, token);
      onVenueRefresh?.();
    } catch (err) {
      setUploadError(err.data?.error ?? 'Upload failed. Please try again.');
    } finally {
      setUploading(false);
    }
  }

  async function handleRemoveVibeFile() {
    setUploading(true);
    try {
      await api.venues.removeVibeFile(venueId, token);
      onVenueRefresh?.();
    } catch {} finally {
      setUploading(false);
    }
  }

  async function handleDownloadVibeFile() {
    setDownloading(true);
    try {
      const data = vibeData ?? await api.venues.vibeData(venueId, token);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `noteblock-vibe-${venue.room_code}-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {} finally {
      setDownloading(false);
    }
  }

  async function save() {
    setSaving(true);
    await onUpdate({
      vibe_description: desc,
      vibe_playlist_urls: urls.split('\n').map(s => s.trim()).filter(Boolean),
      vibe_mode_enabled: enabled,
      crossfade_duration_seconds: parseInt(crossfade),
      welcome_credits: parseInt(welcome),
    });
    setSaving(false);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 560 }}>

      {/* ── Vibe mode ── */}
      <SettingsBlock label={t.vibeModeLabel}>
        <Toggle
          checked={enabled}
          onChange={() => setEnabled(v => !v)}
          label={t.enableVibe}
          description="Auto-play background music from a playlist or description when the queue is empty."
        />

        {/* Source selector — only one of the 4 sources is active at a time.
            Data collection (venue_vibe_data) keeps running in the background
            regardless of which source is selected here. */}
        <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginTop: 18, marginBottom: 8 }}>
          Vibe Source
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {VIBE_SOURCE_OPTIONS.map(opt => {
            const locked = opt.key === 'auto' && !vibeReady;
            const active = source === opt.key;
            return (
              <button
                key={opt.key}
                type="button"
                disabled={locked}
                onClick={() => handleSourceChange(opt.key)}
                title={locked ? `Waiting for more requested songs. Unlocks at 50 requests. Currently at ${requestsSoFar}/50.` : undefined}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  minHeight: 42, padding: '8px', borderRadius: 9, fontSize: 12, fontWeight: 700, fontFamily: 'inherit',
                  textAlign: 'center', lineHeight: 1.25,
                  cursor: locked ? 'not-allowed' : 'pointer',
                  background: active ? '#FF6B35' : 'var(--bg-page)',
                  color: active ? '#0E0A07' : locked ? 'var(--text-muted)' : 'var(--text-primary)',
                  border: `1px solid ${active ? '#FF6B35' : 'var(--border)'}`,
                  opacity: locked ? 0.55 : 1,
                }}
              >
                {locked && <Lock size={11} />}
                {opt.label}
              </button>
            );
          })}
        </div>

        {/* ── Manual Description (existing, unchanged) ── */}
        {source === 'description' && (
          <>
            <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginTop: 16, marginBottom: 2 }}>{t.vibeDescription}</label>
            <input className="input" value={desc} onChange={e => setDesc(e.target.value)} placeholder="e.g. upbeat party hits, 2000s pop, lofi chill"
              style={{ marginTop: 10, background: 'var(--bg-page)', fontSize: 13, fontWeight: 600 }} />
          </>
        )}

        {/* ── Playlist URLs (existing, unchanged) ── */}
        {source === 'playlist' && (
          <>
            <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginTop: 16, marginBottom: 2 }}>{t.vibePlaylistUrls}</label>
            <textarea className="input" value={urls} onChange={e => setUrls(e.target.value)} rows={3}
              placeholder="https://youtube.com/playlist?list=..." style={{ marginTop: 10, background: 'var(--bg-page)', fontSize: 13, fontWeight: 600, resize: 'vertical' }} />
          </>
        )}

        {/* ── Uploaded File (new) ── */}
        {source === 'upload' && (
          <div style={{ marginTop: 16 }}>
            {venue.uploaded_vibe_filename ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--bg-page)', border: '1px solid var(--border)', borderRadius: 9, padding: '10px 12px' }}>
                <FileJson size={16} color="var(--credits)" style={{ flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {venue.uploaded_vibe_filename}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                    Uploaded {venue.uploaded_vibe_uploaded_at ? new Date(venue.uploaded_vibe_uploaded_at).toLocaleDateString() : '—'}
                  </div>
                </div>
                <button
                  onClick={handleRemoveVibeFile}
                  disabled={uploading}
                  style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 7, color: '#f87171', cursor: 'pointer', fontSize: 12, fontWeight: 700, padding: '6px 10px', fontFamily: 'inherit', flexShrink: 0 }}
                >
                  Remove
                </button>
              </div>
            ) : (
              <label style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                border: '1px dashed var(--border)', borderRadius: 9, padding: 16,
                cursor: uploading ? 'default' : 'pointer', color: 'var(--text-secondary)', fontSize: 13, fontWeight: 600,
              }}>
                <Upload size={16} />
                {uploading ? 'Uploading…' : 'Choose a .json vibe file'}
                <input type="file" accept=".json,application/json" onChange={handleFileChange} disabled={uploading} style={{ display: 'none' }} />
              </label>
            )}
            {uploadError && <p style={{ color: '#f87171', fontSize: 12, marginTop: 8 }}>{uploadError}</p>}
          </div>
        )}

        {/* ── Auto-Vibe (new) ── */}
        {source === 'auto' && (
          <div style={{ marginTop: 16 }}>
            {vibeReady ? (
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                Using this venue's own request history — {requestsSoFar} requests so far
                {vibeData?.top_songs_alltime?.[0]?.title && (
                  <>, top track: <strong style={{ color: 'var(--text-primary)' }}>{decode(vibeData.top_songs_alltime[0].title)}</strong></>
                )}.
              </div>
            ) : (
              <div style={{ background: 'rgba(255,107,53,0.08)', border: '1px solid rgba(255,107,53,0.3)', borderRadius: 9, padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
                <Lock size={16} color="var(--credits)" style={{ flexShrink: 0 }} />
                <span style={{ fontSize: 13, color: 'var(--credits)', lineHeight: 1.4 }}>
                  Waiting for more requested songs. Unlocks at 50 requests. Currently at {requestsSoFar}/50.
                </span>
              </div>
            )}
          </div>
        )}

        {vibePlayedCount > 0 && (
          <button
            onClick={onResetVibeHistory}
            style={{
              background: 'none', border: '1px solid var(--border)', borderRadius: 8,
              color: 'var(--text-secondary)', cursor: 'pointer', fontFamily: 'inherit',
              fontSize: 13, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 6,
              marginTop: 16,
              transition: 'border-color 0.15s, color 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = '#FF6B35'; e.currentTarget.style.color = 'var(--text-primary)'; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
          >
            <RefreshCw size={14} /> {t.resetVibeHistory} ({vibePlayedCount})
          </button>
        )}

        {/* ── Download Vibe File — always visible regardless of active source ── */}
        <div style={{ marginTop: 18, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600, marginBottom: 10 }}>
            {requestsSoFar} / 50 songs requested
          </div>
          <button
            type="button"
            onClick={handleDownloadVibeFile}
            disabled={!vibeReady || downloading}
            title={!vibeReady ? `Waiting for more requested songs. Your Vibe File unlocks once your venue has received 50 song requests. Currently at ${requestsSoFar}/50.` : undefined}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '10px 18px', borderRadius: 9, border: 'none',
              background: vibeReady ? '#FF6B35' : 'var(--border)',
              color: vibeReady ? '#0E0A07' : 'var(--text-muted)',
              cursor: vibeReady && !downloading ? 'pointer' : 'not-allowed',
              fontWeight: 800, fontSize: 13, fontFamily: 'inherit',
            }}
          >
            <Download size={15} /> {downloading ? 'Preparing…' : 'Download Vibe File'}
          </button>
        </div>
      </SettingsBlock>

      {/* ── Playback & credits ── */}
      <SettingsBlock label={t.playbackCredits}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
          <span>{t.crossfadeDuration}</span><span style={{ color: '#FF6B35' }}>{crossfade}s</span>
        </div>
        <input type="range" min={2} max={10} value={crossfade} onChange={e => setCrossfade(e.target.value)}
          style={{ width: '100%', accentColor: '#FF6B35', marginTop: 10 }} />
        <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginTop: 16, marginBottom: 2 }}>{t.welcomeCredits}</label>
        <input className="input" type="number" min={0} max={100} value={welcome} onChange={e => setWelcome(e.target.value)}
          style={{ width: 120, marginTop: 10, background: 'var(--bg-page)', fontSize: 13, fontWeight: 600 }} />
      </SettingsBlock>

      <button className="btn-primary" onClick={save} disabled={saving} style={{ alignSelf: 'flex-start', padding: '12px 28px' }}>
        <Save size={15} /> {saving ? t.loading : t.save}
      </button>
    </div>
  );
}

// ── Ban manager ───────────────────────────────────────────────────────────────

function BanManager({ venueId, token, banned, bannedIds, onReload }) {
  const { t } = useLang();
  const [selected, setSelected] = useState(null);

  async function handleBan(song) {
    await api.venues.banned.add(venueId, { youtube_video_id: song.videoId, song_title: song.title, thumbnail_url: song.thumbnail, channel: song.channel }, token).catch(() => {});
    onReload(); setSelected(null);
  }
  async function handleUnban(bid) {
    await api.venues.banned.remove(venueId, bid, token).catch(() => {});
    onReload();
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 19, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 20 }}>
        {t.banSong}
      </div>
      <SongSearch bannedIds={bannedIds} onSelect={setSelected} />

      {selected && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 20 }}>
          <div style={{ background: 'var(--bg-page)', border: '1px solid var(--border)', borderRadius: 10, padding: 24, maxWidth: 360, width: '100%' }}>
            <p style={{ margin: '0 0 16px', fontWeight: 600, color: 'var(--text-primary)' }}>Ban "{selected.title}" from this venue?</p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn-primary" style={{ flex: 1, background: '#f87171' }} onClick={() => handleBan(selected)}>
                <Ban size={15} /> {t.banSong}
              </button>
              <button className="btn-secondary" onClick={() => setSelected(null)}>{t.cancel}</button>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '28px 0 16px' }}>
        <span style={{ fontSize: 19, fontWeight: 800, color: 'var(--text-primary)' }}>{t.bannedSongs}</span>
        <span style={{ background: 'var(--border)', color: 'var(--text-secondary)', borderRadius: 20, padding: '3px 10px', fontSize: 11, fontWeight: 700 }}>{banned.length}</span>
      </div>
      {!banned.length && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '60px 20px', textAlign: 'center' }}>
          <ShieldOff size={40} color="var(--border)" style={{ marginBottom: 14 }} />
          <div style={{ color: 'var(--text-muted)', fontSize: 14, fontWeight: 600 }}>{t.noSongsBanned}</div>
        </div>
      )}
      {banned.map(b => (
        <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 14, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: '12px 14px', marginBottom: 8 }}>
          <SongThumb src={b.thumbnail_url} size={40} radius={7} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{decode(b.song_title)}</div>
            {b.channel && <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>{decode(b.channel)}</div>}
          </div>
          <button onClick={() => handleUnban(b.id)} style={{ marginLeft: 'auto', background: 'var(--border)', border: '1px solid #3D2B1A', borderRadius: 8, color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 11, fontWeight: 700, fontFamily: 'inherit', padding: '7px 13px', flexShrink: 0 }}>
            {t.unban}
          </button>
        </div>
      ))}
    </div>
  );
}

// ── Stats panel ───────────────────────────────────────────────────────────────

function StatsPanel({ stats }) {
  const { t } = useLang();
  if (!stats) return <p style={{ color: 'var(--text-secondary)' }}>{t.loading}</p>;
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
        <StatCard label={t.requestsToday} value={stats.totalRequests} />
        <StatCard label={t.creditsDistributed} value={stats.totalCredits} />
      </div>
      <div style={{ fontSize: 19, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 16 }}>{t.topSongs}</div>
      {stats.topSongs.map((s, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 0', borderBottom: '1px solid var(--bg-page)' }}>
          <span style={{ color: 'var(--text-muted)', fontWeight: 800, fontSize: 14, width: 20 }}>{i + 1}</span>
          <span style={{ flex: 1, color: 'var(--text-primary)', fontWeight: 700, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{decode(s.title)}</span>
          <span style={{ background: 'var(--border)', color: 'var(--text-secondary)', fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 20, flexShrink: 0 }}>{s.count}×</span>
        </div>
      ))}
    </div>
  );
}

function StatCard({ label, value }) {
  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14, padding: 24, textAlign: 'center' }}>
      <div style={{ fontSize: 32, fontWeight: 800, color: '#FF6B35', letterSpacing: '-1px' }}>{value}</div>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', marginTop: 6, textTransform: 'uppercase', letterSpacing: 1.5 }}>{label}</div>
    </div>
  );
}

// ── Users panel ───────────────────────────────────────────────────────────────

function UsersPanel({ venueId, token }) {
  const { t } = useLang();
  const [users, setUsers] = useState([]);
  const [bannedUsers, setBannedUsers] = useState([]);
  const [onlineUsers, setOnlineUsers] = useState([]); // from Supabase Presence
  const [removedNames, setRemovedNames] = useState(() => {
    // Load from localStorage so removals persist across host page refreshes
    try {
      const saved = JSON.parse(localStorage.getItem(`nb_removed_${venueId}`) ?? '[]');
      return new Set(saved);
    } catch { return new Set(); }
  });
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [modal, setModal] = useState(null); // { type: 'ban'|'gift'|'remove', user }
  const [giftAmount, setGiftAmount] = useState('10'); // keep as string so input is freely editable
  const [giftMsg, setGiftMsg] = useState('');
  const [openMenu, setOpenMenu] = useState(null);

  async function load() {
    setLoading(true);
    try {
      const data = await api.venues.users(venueId, token);
      setUsers(data.users ?? []); setBannedUsers(data.bannedUsers ?? []);
    } catch {}
    setLoading(false);
  }

  useEffect(() => { load(); }, []); // eslint-disable-line

  // Real-time: reload when a new queue_items row is inserted (no filter — filtered
  // subscriptions need special Supabase publication config; check venue_id in callback)
  useEffect(() => {
    if (!venueId) return;
    const sub = supabase
      .channel(`users-panel-queue-${venueId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'queue_items' },
        (payload) => { if (payload.new?.venue_id === venueId) load(); })
      .subscribe();
    return () => supabase.removeChannel(sub);
  }, [venueId]);

  // Presence: track who's currently in the room (shows up instantly when they open GuestRoom)
  useEffect(() => {
    if (!venueId) return;
    const ch = supabase.channel(`presence-${venueId}`);

    const sync = () => {
      const state = ch.presenceState();
      // Each key maps to an array of presences (multiple tabs); flatten + dedupe by name
      const all = Object.values(state).flat();
      const seen = new Set();
      const unique = all.filter(p => { if (seen.has(p.name)) return false; seen.add(p.name); return true; });
      setOnlineUsers(unique);
    };

    ch.on('presence', { event: 'sync' }, sync)
      .on('presence', { event: 'join' }, sync)
      .on('presence', { event: 'leave' }, sync)
      .subscribe();

    return () => supabase.removeChannel(ch);
  }, [venueId]);

  useEffect(() => {
    if (!openMenu) return;
    const close = () => setOpenMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [openMenu]);

  async function handleBan(name) {
    await api.venues.banUser(venueId, { requester_name: name }, token).catch(() => {});
    setModal(null); load();
  }
  async function handleUnban(name) {
    const record = bannedUsers.find(b => b.requester_name === name);
    if (!record) return;
    await api.venues.unbanUser(venueId, record.id, token).catch(() => {});
    setModal(null); load();
  }
  function persistRemove(name) {
    // Write to localStorage immediately — this is what makes it survive page refreshes
    try {
      const key = `nb_removed_${venueId}`;
      const saved = JSON.parse(localStorage.getItem(key) ?? '[]');
      const updated = [...new Set([...saved, name])];
      localStorage.setItem(key, JSON.stringify(updated));
    } catch {}
    setRemovedNames(prev => new Set([...prev, name]));
  }

  async function handleRemove(name) {
    // Always persist locally first — works even if the backend call fails
    persistRemove(name);
    setModal(null);
    // Best-effort backend update (marks queue_items as 'removed' status)
    api.venues.removeUser(venueId, name, token).catch(() => {});
  }
  async function handleGift(name) {
    const parsed = parseInt(giftAmount);
    if (!parsed || parsed < 1) { setGiftMsg('Enter a valid amount (minimum 1)'); return; }
    try {
      await api.venues.gift(venueId, { guest_identifier: name, amount: parsed }, token);
      setGiftMsg(`${parsed} credits sent to ${name}`);
      setTimeout(() => { setGiftMsg(''); setModal(null); }, 2500);
    } catch (err) {
      const msg = err.data?.message ?? err.data?.error ?? 'error';
      setGiftMsg(`Failed: ${msg}`);
    }
  }

  // Merge online presence users with historical requesters
  // Filter out removed users from both sources
  const onlineNames = new Set(onlineUsers.map(u => u.name));
  const historicalNames = new Set(users.map(u => u.name));

  const visibleUsers = users.filter(u => !removedNames.has(u.name));
  const onlineOnly = onlineUsers
    .filter(p => !historicalNames.has(p.name) && !removedNames.has(p.name))
    .map(p => ({ name: p.name, requests: 0, credits: 0, isRegistered: p.isRegistered, banned: false, onlineOnly: true }));

  const allUsers = [...visibleUsers, ...onlineOnly];
  const displayed = filter === 'banned' ? allUsers.filter(u => u.banned) : allUsers;

  if (loading) return <p style={{ color: 'var(--text-secondary)' }}>{t.loading}</p>;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div style={{ fontSize: 19, fontWeight: 800, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <Users size={17} />
          {t.roomUsers}
          {onlineUsers.length > 0 && (
            <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: 'rgba(52,211,153,0.12)', color: '#34d399' }}>
              {onlineUsers.length} online
            </span>
          )}
        </div>
        <button onClick={load} style={{ width: 36, height: 36, borderRadius: 10, border: 'none', background: 'var(--border)', color: 'var(--text-primary)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <RefreshCw size={14} />
        </button>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {['all', 'banned'].map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{
            padding: '7px 14px', borderRadius: 20, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700, fontFamily: 'inherit',
            background: filter === f ? '#FF6B35' : 'var(--border)',
            color: filter === f ? '#0E0A07' : 'var(--text-secondary)',
          }}>
            {f === 'all' ? `All (${allUsers.length})` : `Banned (${allUsers.filter(u => u.banned).length})`}
          </button>
        ))}
      </div>

      {!displayed.length && (
        <p style={{ color: 'var(--text-secondary)', textAlign: 'center', marginTop: 32 }}>
          {filter === 'banned' ? 'No banned users' : 'No one in the room yet'}
        </p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {displayed.map(u => {
          const isOnline = onlineNames.has(u.name);
          const initial = u.name && u.name !== 'Guest' ? u.name[0].toUpperCase() : '?';
          return (
            <div key={u.name} style={{
              display: 'flex', alignItems: 'center', gap: 14,
              background: u.banned ? 'rgba(248,113,113,0.06)' : 'var(--bg-card)',
              border: `1px solid ${u.banned ? 'rgba(248,113,113,0.3)' : isOnline ? 'rgba(52,211,153,0.25)' : 'var(--border)'}`,
              borderRadius: 12, padding: 14, position: 'relative',
            }}>
              {/* Avatar with online dot */}
              <div style={{ position: 'relative', flexShrink: 0 }}>
                <div style={{
                  width: 38, height: 38, borderRadius: '50%',
                  background: u.banned ? 'rgba(248,113,113,0.15)' : u.isRegistered ? 'var(--brown)' : 'rgba(90,69,53,0.3)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 14, fontWeight: 800,
                  color: u.banned ? '#f87171' : 'var(--text-primary)',
                }}>
                  {u.banned ? <Ban size={16} /> : initial}
                </div>
                {isOnline && (
                  <div style={{
                    position: 'absolute', bottom: 0, right: 0,
                    width: 10, height: 10, borderRadius: '50%',
                    background: '#34d399', border: '2px solid var(--bg-card)',
                  }} />
                )}
              </div>

              {/* Info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 14, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 160, color: 'var(--text-primary)' }}>
                    {u.name || 'Anonymous'}
                  </span>
                  {u.isRegistered && (
                    <span style={{
                      fontSize: 9, fontWeight: 800, padding: '2px 6px', borderRadius: 5,
                      background: 'var(--brown)', color: 'var(--credits)',
                    }}>
                      Verified
                    </span>
                  )}
                  {u.banned && (
                    <span style={{ fontSize: 9, fontWeight: 800, padding: '2px 6px', borderRadius: 5, background: 'rgba(248,113,113,0.2)', color: '#f87171' }}>
                      BANNED
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 500, marginTop: 2 }}>
                  {u.onlineOnly ? 'Just joined · no requests yet' : `${u.requests} ${u.requests === 1 ? 'song' : 'songs'} · ${u.credits} credits spent`}
                </div>
              </div>

              {/* More menu */}
              <div style={{ position: 'relative', flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                <button
                  onClick={() => setOpenMenu(openMenu === u.name ? null : u.name)}
                  style={{
                    width: 32, height: 32, borderRadius: 8, border: 'none',
                    background: openMenu === u.name ? '#FF6B35' : 'var(--border)',
                    color: openMenu === u.name ? '#0E0A07' : 'var(--text-secondary)',
                    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  <MoreHorizontal size={16} />
                </button>

                {openMenu === u.name && (
                  <div style={{
                    position: 'absolute', right: 0, top: 36, zIndex: 100,
                    background: 'var(--bg-page)', border: '1px solid var(--border)',
                    borderRadius: 10, minWidth: 160,
                    boxShadow: '0 8px 24px rgba(0,0,0,0.5)', overflow: 'hidden',
                  }}>
                    <MenuBtn icon={<Gift size={14} />} label="Gift Credits" color="#C89B6E"
                      onClick={() => { setOpenMenu(null); setGiftAmount('10'); setGiftMsg(''); setModal({ type: 'gift', user: u }); }} />
                    <MenuBtn icon={<X size={14} />} label="Remove from Room" color="#8B6F52"
                      onClick={() => { setOpenMenu(null); setModal({ type: 'remove', user: u }); }} />
                    {u.banned
                      ? <MenuBtn icon={<Check size={14} />} label="Unban User" color="#34d399" onClick={() => { setOpenMenu(null); handleUnban(u.name); }} />
                      : <MenuBtn icon={<Ban size={14} />} label="Ban User" color="#f87171" onClick={() => { setOpenMenu(null); setModal({ type: 'ban', user: u }); }} />
                    }
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Remove modal */}
      {modal?.type === 'remove' && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: 20 }}>
          <div style={{ background: 'var(--bg-page)', border: '1px solid var(--border)', borderRadius: 10, padding: 24, maxWidth: 340, width: '100%' }}>
            <p style={{ margin: '0 0 6px', fontWeight: 700, fontSize: 16, color: 'var(--text-primary)' }}>Remove "{modal.user.name}"?</p>
            <p style={{ margin: '0 0 20px', fontSize: 13, color: 'var(--text-secondary)' }}>Their pending song requests will be removed. They can still rejoin and request songs again.</p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn-secondary" style={{ flex: 1, borderColor: '#8B6F52' }} onClick={() => handleRemove(modal.user.name)}>
                <X size={15} /> Remove
              </button>
              <button className="btn-secondary" onClick={() => setModal(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Ban modal */}
      {modal?.type === 'ban' && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: 20 }}>
          <div style={{ background: 'var(--bg-page)', border: '1px solid var(--border)', borderRadius: 10, padding: 24, maxWidth: 340, width: '100%' }}>
            <p style={{ margin: '0 0 6px', fontWeight: 700, fontSize: 16, color: 'var(--text-primary)' }}>Ban "{modal.user.name}"?</p>
            <p style={{ margin: '0 0 20px', fontSize: 13, color: 'var(--text-secondary)' }}>They won't be able to request songs in this room anymore.</p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn-primary" style={{ flex: 1, background: '#f87171' }} onClick={() => handleBan(modal.user.name)}>
                <Ban size={15} /> Ban
              </button>
              <button className="btn-secondary" onClick={() => setModal(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Gift modal */}
      {modal?.type === 'gift' && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: 20 }}>
          <div style={{ background: 'var(--bg-page)', border: '1px solid var(--border)', borderRadius: 10, padding: 24, maxWidth: 340, width: '100%' }}>
            <p style={{ margin: '0 0 4px', fontWeight: 700, fontSize: 16, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Gift size={18} color="var(--credits)" /> Gift Credits
            </p>
            <p style={{ margin: '0 0 8px', fontSize: 13, color: 'var(--text-secondary)' }}>To: <strong style={{ color: 'var(--text-primary)' }}>{modal.user.name}</strong></p>
            {!modal.user.isRegistered && (
              <p style={{ margin: '0 0 12px', fontSize: 11, color: '#C89B6E', display: 'flex', alignItems: 'center', gap: 5, background: 'rgba(200,155,110,0.08)', border: '1px solid rgba(200,155,110,0.2)', borderRadius: 7, padding: '8px 10px' }}>
                <AlertTriangle size={11} /> This user appears to be a guest. Gifted credits only land in accounts — ask them to sign in first if they want to receive them.
              </p>
            )}
            {/* Quick presets */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              {[10, 25, 50, 100].map(amt => (
                <button key={amt} onClick={() => setGiftAmount(String(amt))} style={{
                  flex: 1, padding: '8px 0', borderRadius: 7,
                  border: `1px solid ${giftAmount === String(amt) ? '#FF6B35' : 'var(--border)'}`,
                  background: giftAmount === String(amt) ? 'rgba(255,107,53,0.15)' : 'var(--bg-card)',
                  color: giftAmount === String(amt) ? '#FF6B35' : 'var(--text-primary)',
                  cursor: 'pointer', fontWeight: 700, fontSize: 14, fontFamily: 'inherit',
                }}>
                  {amt}
                </button>
              ))}
            </div>
            {/* Free-form input — allows backspace / any whole number */}
            <input
              className="input"
              type="number"
              min={1}
              placeholder="Custom amount…"
              value={giftAmount}
              onChange={e => setGiftAmount(e.target.value)}
              style={{ marginBottom: 14 }}
            />
            {giftMsg && <p style={{ margin: '0 0 12px', fontSize: 13, color: giftMsg.startsWith('✓') ? '#34d399' : '#f87171' }}>{giftMsg}</p>}
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn-primary" style={{ flex: 1 }} onClick={() => handleGift(modal.user.name)}>
                <Gift size={15} /> Gift {parseInt(giftAmount) > 0 ? parseInt(giftAmount) : '…'} Credits
              </button>
              <button className="btn-secondary" onClick={() => setModal(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
      <VersionFooter />
    </div>
  );
}

function MenuBtn({ icon, label, color, onClick }) {
  return (
    <button onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 8,
      width: '100%', padding: '10px 14px', background: 'none', border: 'none',
      color: color ?? 'var(--text-primary)', cursor: 'pointer', textAlign: 'left', fontSize: 13, fontFamily: 'inherit',
    }}
      onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-card)'}
      onMouseLeave={e => e.currentTarget.style.background = 'none'}
    >
      {icon} {label}
    </button>
  );
}
