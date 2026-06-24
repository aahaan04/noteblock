import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Music, Play, Pause, SkipForward, ListMusic, Radio,
  Ban, Users, BarChart2, QrCode, RefreshCw, MoreHorizontal,
  Gift, Check, X, ChevronUp, ChevronDown, Save, AlertTriangle, Settings2,
  Download, ShieldOff,
} from 'lucide-react';

const decode = s => s?.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&#x27;/g, "'") ?? s;

function useIsMobile() {
  const [mobile, setMobile] = useState(() => window.innerWidth < 768);
  useEffect(() => {
    const fn = () => setMobile(window.innerWidth < 768);
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
      const channel = vibeVideos.find(v => v.videoId === nowPlaying.videoId)?.channel ?? null;
      api.venues.update(id, { vibe_now_playing_title: nowPlaying.title ?? null, vibe_now_playing_channel: channel }, token).catch(() => {});
    } else if (nowPlaying?.type !== 'vibe') {
      api.venues.update(id, { vibe_now_playing_title: null, vibe_now_playing_channel: null }, token).catch(() => {});
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
      if (v.vibe_playlist_urls?.length) {
        for (const url of v.vibe_playlist_urls) {
          const playlistId = new URL(url).searchParams.get('list');
          if (playlistId) videos = [...videos, ...(await api.youtube.playlist(playlistId))];
        }
      }
      if (!videos.length && v.vibe_description) videos = await api.youtube.vibe(v.vibe_description);
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
      if (updates.vibe_mode_enabled !== undefined || updates.vibe_description !== undefined || updates.vibe_playlist_urls !== undefined) loadVibeVideos(updated);
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
      {/* Song info bar below visualizer */}
      {!venue.jukebox_paused && (nowPlayingTitle || vibeActive) && (
        <div style={{ padding: '4px 0', minWidth: 0 }}>
          {nowPlaying?.type === 'vibe' ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 3 }}>
                <Radio size={12} color="var(--text-secondary)" />
                <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: 2, textTransform: 'uppercase', color: 'var(--text-secondary)' }}>{t.vibeModeLabel}</span>
              </div>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {nowPlayingTitle ?? <span style={{ color: 'var(--text-muted)' }}>{t.loading}</span>}
              </div>
              {vibeChannel && <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>{vibeChannel}</div>}
            </>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                {decode(nowPlayingTitle)}
              </div>
              {nowPlayingRequester && (
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', flexShrink: 0 }}>by {nowPlayingRequester}</div>
              )}
            </div>
          )}
        </div>
      )}
      <div style={{ display: 'flex', gap: 12 }}>
        <button
          onClick={() => handleVenueUpdate({ jukebox_paused: !venue.jukebox_paused })}
          style={{
            flex: 1, height: 52, borderRadius: 8, border: '1px solid var(--border)',
            background: 'var(--btn-normal)', color: 'var(--text-primary)', fontWeight: 700, fontSize: 14,
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
              flex: 1, height: 52, borderRadius: 8, border: 'none',
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
              flex: 1, height: 52, borderRadius: 8, border: 'none',
              background: '#FF6B35', color: 'var(--bg-app)', fontWeight: 700, fontSize: 14,
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
        venue.queue_open_when_paused ? (
          <div style={{ background: 'rgba(52,211,153,0.08)', border: '1px solid rgba(52,211,153,0.4)', borderRadius: 8, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, margin: '0' }}>
            <ListMusic size={18} color="#34d399" style={{ flexShrink: 0 }} />
            <span style={{ fontSize: 13, color: '#34d399', fontWeight: 600 }}>{t.guestsCanQueuePaused}</span>
          </div>
        ) : (
          <div style={{ background: 'rgba(255,107,53,0.08)', border: '1px solid rgba(255,107,53,0.4)', borderRadius: 8, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, margin: '0' }}>
            <AlertTriangle size={18} color="#FF6B35" style={{ flexShrink: 0 }} />
            <span style={{ fontSize: 13, color: '#FF6B35', fontWeight: 600 }}>{t.guestsCannotRequest}</span>
          </div>
        )
      )}
    </div>
  );

  // Tab content
  const tabContent = (
    <>
      {tab === 'queue'  && <QueueDisplay items={queue} isHost onRemove={handleRemove} />}
      {tab === 'vibe'   && <VibeSettings venue={venue} onUpdate={handleVenueUpdate} vibePlayedCount={vibePlayedIds.length} onResetVibeHistory={() => { setVibePlayedIds([]); handleVenueUpdate({ vibe_played_video_ids: [] }); }} />}
      {tab === 'ban'    && <BanManager venueId={id} token={token} banned={banned} bannedIds={bannedIds} onReload={loadBanned} />}
      {tab === 'users'  && <UsersPanel venueId={id} token={token} />}
      {tab === 'stats'  && <StatsPanel stats={stats} />}
      {tab === 'qr'     && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 24 }}>
          <VenueQRCode roomCode={venue.room_code} size={248} />
        </div>
      )}
    </>
  );

  // ── Top bar ───────────────────────────────────────────────────────────────────
  const topBar = (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: isMobile ? '10px 12px' : '12px 20px',
      background: 'var(--bg-card)', borderBottom: '1px solid var(--border)', flexShrink: 0,
    }}>
      <button onClick={() => navigate('/host/dashboard')} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: 4 }}>
        <ArrowLeft size={20} />
      </button>
      {!isMobile && <Logo size={26} />}
      <h1 style={{ margin: 0, fontSize: isMobile ? 15 : 18, fontWeight: 800, flex: 1, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {venue.name}
      </h1>
      <span style={{
        fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 999, flexShrink: 0,
        background: isActive ? 'rgba(52,211,153,0.12)' : 'rgba(248,113,113,0.12)',
        color: isActive ? '#34d399' : '#f87171',
      }}>
        {isActive ? t.active : t.closed}
      </span>
      {vibeActive && !isMobile && <span style={{ fontSize: 12, color: '#FF6B35', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}><Music size={13} /> Vibe</span>}
      <button className="btn-secondary" style={{ fontSize: isMobile ? 11 : 12, padding: isMobile ? '6px 10px' : undefined, flexShrink: 0 }}
        onClick={() => handleVenueUpdate({ status: isActive ? 'closed' : 'active' })}>
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
      <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg-app)' }}>
        {topBar}

        {/* Scrollable content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 14px 0' }}>
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
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg-app)' }}>
      {topBar}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Left — player */}
        <div style={{ flex: '0 0 480px', padding: 20, display: 'flex', flexDirection: 'column', gap: 16, overflowY: 'auto', borderRight: '1px solid var(--border)' }}>
          {playerPanel}
        </div>
        {/* Right — tabs */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ display: 'flex', gap: 4, padding: '12px 16px', borderBottom: '1px solid var(--border)', overflowX: 'auto', flexShrink: 0 }}>
            {desktopTabs.map(({ key, icon, label }) => (
              <button key={key}
                onClick={() => { setTab(key); if (key === 'stats') loadStats(); }}
                style={{
                  padding: '6px 14px', borderRadius: 7, border: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
                  background: tab === key ? '#FF6B35' : 'var(--bg-card)',
                  color: tab === key ? 'var(--text-primary)' : 'var(--text-secondary)',
                  fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
                  display: 'flex', alignItems: 'center', gap: 5,
                }}>
                {icon} {label}
              </button>
            ))}
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
            {tabContent}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Toggle component ──────────────────────────────────────────────────────────

function Toggle({ checked, onChange, label, description }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
      gap: 16, padding: '14px 16px',
      background: 'var(--bg-app)', border: '1px solid var(--border)', borderRadius: 10,
    }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)', marginBottom: 3 }}>{label}</div>
        {description && <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.4 }}>{description}</div>}
      </div>
      {/* iOS-style pill toggle */}
      <button
        onClick={onChange}
        style={{
          flexShrink: 0, width: 48, height: 28, borderRadius: 999, border: 'none', cursor: 'pointer',
          background: checked ? '#FF6B35' : 'var(--border)',
          position: 'relative', transition: 'background 0.2s',
          padding: 0,
        }}
      >
        <span style={{
          position: 'absolute', top: 4, left: checked ? 24 : 4,
          width: 20, height: 20, borderRadius: '50%', background: 'var(--text-primary)',
          transition: 'left 0.2s', display: 'block',
        }} />
      </button>
    </div>
  );
}

// ── Vibe settings ─────────────────────────────────────────────────────────────

function VibeSettings({ venue, onUpdate, vibePlayedCount = 0, onResetVibeHistory }) {
  const { t } = useLang();
  const [desc, setDesc] = useState(venue.vibe_description ?? '');
  const [urls, setUrls] = useState((venue.vibe_playlist_urls ?? []).join('\n'));
  const [enabled, setEnabled] = useState(venue.vibe_mode_enabled);
  const [crossfade, setCrossfade] = useState(venue.crossfade_duration_seconds);
  const [welcome, setWelcome] = useState(venue.welcome_credits);
  const [queueWhenPaused, setQueueWhenPaused] = useState(venue.queue_open_when_paused ?? false);
  const [saving, setSaving] = useState(false);

  // Pending confirmation for queue-when-paused toggle
  const [pendingToggle, setPendingToggle] = useState(null); // null | { newVal: bool }

  async function save() {
    setSaving(true);
    await onUpdate({
      vibe_description: desc,
      vibe_playlist_urls: urls.split('\n').map(s => s.trim()).filter(Boolean),
      vibe_mode_enabled: enabled,
      crossfade_duration_seconds: parseInt(crossfade),
      welcome_credits: parseInt(welcome),
      queue_open_when_paused: queueWhenPaused,
    });
    setSaving(false);
  }

  function requestQueueToggle() {
    setPendingToggle({ newVal: !queueWhenPaused });
  }

  async function confirmQueueToggle() {
    const newVal = pendingToggle.newVal;
    setPendingToggle(null);
    setQueueWhenPaused(newVal);
    // Save immediately so it takes effect for guests right away
    await onUpdate({ queue_open_when_paused: newVal });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 520 }}>

      {/* ── Pre-event queuing ── */}
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
          {t.guestRequests}
        </div>
        <Toggle
          checked={queueWhenPaused}
          onChange={requestQueueToggle}
          label={t.allowQueueWhenPaused}
          description={t.allowQueueWhenPausedDesc}
        />
      </div>

      {/* Confirmation toast */}
      {pendingToggle && (
        <div style={{
          background: 'var(--bg-card)', border: '1px solid #FF6B35',
          borderRadius: 12, padding: '14px 16px',
          display: 'flex', flexDirection: 'column', gap: 10,
        }}>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.5 }}>
            {pendingToggle.newVal
              ? 'Guests will be able to request songs while the jukebox is paused. Their songs will queue up and play when you start the jukebox.'
              : 'Guests will NOT be able to request songs while the jukebox is paused. Requests will be blocked until you start the jukebox.'}
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn-primary" style={{ flex: 1, fontSize: 13, height: 42, boxShadow: 'none' }} onClick={confirmQueueToggle}>
              <Check size={14} /> Confirm
            </button>
            <button className="btn-secondary" style={{ flex: 1, fontSize: 13, height: 42 }} onClick={() => setPendingToggle(null)}>
              <X size={14} /> Cancel
            </button>
          </div>
        </div>
      )}

      <div style={{ height: 1, background: 'var(--border)' }} />

      {/* ── Vibe mode ── */}
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
          {t.vibeModeLabel}
        </div>
        <Toggle
          checked={enabled}
          onChange={() => setEnabled(v => !v)}
          label={t.enableVibe}
          description="Auto-play background music from a playlist or description when the queue is empty."
        />
      </div>

      <div>
        <label style={{ fontSize: 13, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>{t.vibeDescription}</label>
        <input className="input" value={desc} onChange={e => setDesc(e.target.value)} placeholder="e.g. upbeat party hits, 2000s pop, lofi chill" />
      </div>

      <div>
        <label style={{ fontSize: 13, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>{t.vibePlaylistUrls}</label>
        <textarea className="input" value={urls} onChange={e => setUrls(e.target.value)} rows={3}
          placeholder="https://youtube.com/playlist?list=..." style={{ resize: 'vertical' }} />
      </div>

      {vibePlayedCount > 0 && (
        <button
          onClick={onResetVibeHistory}
          style={{
            background: 'none', border: '1px solid var(--border)', borderRadius: 8,
            color: 'var(--text-secondary)', cursor: 'pointer', fontFamily: 'inherit',
            fontSize: 13, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 6,
            alignSelf: 'flex-start',
            transition: 'border-color 0.15s, color 0.15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = '#FF6B35'; e.currentTarget.style.color = 'var(--text-primary)'; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
        >
          <RefreshCw size={14} /> {t.resetVibeHistory} ({vibePlayedCount})
        </button>
      )}

      <div style={{ height: 1, background: 'var(--border)' }} />

      {/* ── Playback & credits ── */}
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>
          {t.playbackCredits}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={{ fontSize: 13, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>
              {t.crossfadeDuration}: <strong style={{ color: 'var(--text-primary)' }}>{crossfade}s</strong>
            </label>
            <input type="range" min={2} max={10} value={crossfade} onChange={e => setCrossfade(e.target.value)} style={{ width: '100%', accentColor: '#FF6B35' }} />
          </div>
          <div>
            <label style={{ fontSize: 13, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>{t.welcomeCredits}</label>
            <input className="input" type="number" min={0} max={100} value={welcome} onChange={e => setWelcome(e.target.value)} style={{ width: 120 }} />
          </div>
        </div>
      </div>

      <button className="btn-primary" onClick={save} disabled={saving} style={{ alignSelf: 'flex-start', padding: '10px 24px' }}>
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
    await api.venues.banned.add(venueId, { youtube_video_id: song.videoId, song_title: song.title, thumbnail_url: song.thumbnail }, token).catch(() => {});
    onReload(); setSelected(null);
  }
  async function handleUnban(bid) {
    await api.venues.banned.remove(venueId, bid, token).catch(() => {});
    onReload();
  }

  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>{t.banSong}</div>
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

      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '24px 0 10px' }}>{t.bannedSongs}</div>
      {!banned.length && (
        <div style={{ textAlign: 'center', padding: '20px 0' }}>
          <ShieldOff size={40} color="var(--border)" style={{ marginBottom: 8 }} />
          <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>{t.noSongsBanned}</div>
        </div>
      )}
      {banned.map(b => (
        <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 7, padding: '8px 12px', marginBottom: 8 }}>
          {b.thumbnail_url && <img src={b.thumbnail_url} alt="" style={{ width: 40, height: 30, objectFit: 'cover', borderRadius: 4 }} />}
          <span style={{ flex: 1, fontSize: 14, color: 'var(--text-primary)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{decode(b.song_title)}</span>
          <button onClick={() => handleUnban(b.id)} style={{ background: 'none', border: '1px solid rgba(248,113,113,0.3)', borderRadius: 6, color: '#f87171', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit', padding: '3px 10px' }}>
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
      <div style={{ display: 'flex', gap: 16, marginBottom: 24 }}>
        <StatCard label={t.requestsToday} value={stats.totalRequests} />
        <StatCard label={t.creditsDistributed} value={stats.totalCredits} />
      </div>
      <h3 style={{ color: 'var(--text-primary)', marginTop: 0, marginBottom: 12 }}>{t.topSongs}</h3>
      {stats.topSongs.map((s, i) => (
        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 0', borderBottom: '1px solid var(--border)', fontSize: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <span style={{ color: 'var(--text-muted)', fontFamily: 'monospace', minWidth: 18, fontSize: 13 }}>{i + 1}</span>
            <span style={{ color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{decode(s.title)}</span>
          </div>
          <span style={{ background: 'var(--border)', color: 'var(--text-secondary)', fontSize: 12, fontWeight: 700, padding: '2px 8px', borderRadius: 999, flexShrink: 0, marginLeft: 8 }}>{s.count}x</span>
        </div>
      ))}
    </div>
  );
}

function StatCard({ label, value }) {
  return (
    <div style={{ flex: 1, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: '16px 20px', textAlign: 'center' }}>
      <div style={{ fontSize: 36, fontWeight: 800, color: '#FF6B35' }}>{value}</div>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4, textTransform: 'uppercase', letterSpacing: 2 }}>{label}</div>
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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h3 style={{ margin: 0, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Users size={18} color="#FF6B35" /> {t.roomUsers}
          {onlineUsers.length > 0 && (
            <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 999, background: 'rgba(52,211,153,0.12)', color: '#34d399' }}>
              {onlineUsers.length} online
            </span>
          )}
        </h3>
        <div style={{ display: 'flex', gap: 6 }}>
          {['all', 'banned'].map(f => (
            <button key={f} onClick={() => setFilter(f)} style={{
              padding: '4px 12px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, fontFamily: 'inherit',
              background: filter === f ? '#FF6B35' : 'var(--bg-card)',
              color: filter === f ? 'var(--text-primary)' : 'var(--text-secondary)',
            }}>
              {f === 'all' ? `All (${allUsers.length})` : `Banned (${allUsers.filter(u => u.banned).length})`}
            </button>
          ))}
          <button onClick={load} style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'none', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
            <RefreshCw size={13} />
          </button>
        </div>
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
              display: 'flex', alignItems: 'center', gap: 12,
              background: u.banned ? 'rgba(248,113,113,0.06)' : 'var(--bg-card)',
              border: `1px solid ${u.banned ? 'rgba(248,113,113,0.3)' : isOnline ? 'rgba(52,211,153,0.25)' : 'var(--border)'}`,
              borderRadius: 10, padding: '10px 14px', position: 'relative',
            }}>
              {/* Avatar with online dot */}
              <div style={{ position: 'relative', flexShrink: 0 }}>
                <div style={{
                  width: 36, height: 36, borderRadius: '50%',
                  background: u.banned ? 'rgba(248,113,113,0.15)' : u.isRegistered ? 'rgba(255,107,53,0.15)' : 'rgba(90,69,53,0.3)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 15, fontWeight: 700,
                  color: u.banned ? '#f87171' : u.isRegistered ? '#FF6B35' : '#8B6F52',
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
                <div style={{ fontWeight: 700, fontSize: 14, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 160, color: 'var(--text-primary)' }}>
                    {u.name || 'Anonymous'}
                  </span>
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 999,
                    background: 'rgba(255,107,53,0.15)', color: '#FF6B35',
                  }}>
                    {u.isRegistered ? 'Verified' : 'User'}
                  </span>
                  {u.banned && (
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 999, background: 'rgba(248,113,113,0.2)', color: '#f87171' }}>
                      BANNED
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  {u.onlineOnly ? 'Just joined · no requests yet' : `${u.requests} ${u.requests === 1 ? 'song' : 'songs'} · ${u.credits} credits spent`}
                </div>
              </div>

              {/* More menu */}
              <div style={{ position: 'relative', flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                <button
                  onClick={() => setOpenMenu(openMenu === u.name ? null : u.name)}
                  style={{
                    width: 32, height: 32, borderRadius: 7, border: '1px solid var(--border)',
                    background: openMenu === u.name ? '#FF6B35' : 'var(--bg-card)',
                    color: openMenu === u.name ? 'var(--text-primary)' : 'var(--text-secondary)',
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
