import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Music, Play, Pause, SkipForward, ListMusic, Radio,
  Ban, Users, BarChart2, QrCode, RefreshCw, MoreHorizontal,
  Gift, Check, X, ChevronUp, ChevronDown, Save, AlertTriangle,
} from 'lucide-react';
import Logo from '../components/Logo.jsx';
import VersionFooter from '../components/VersionFooter.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useLang } from '../context/LangContext.jsx';
import { api } from '../lib/api.js';
import { supabase } from '../lib/supabase.js';
import CrossfadePlayer from '../components/CrossfadePlayer.jsx';
import QueueDisplay from '../components/QueueDisplay.jsx';
import NowPlaying from '../components/NowPlaying.jsx';
import VenueQRCode from '../components/VenueQRCode.jsx';
import SongSearch from '../components/SongSearch.jsx';

export default function VenueControl() {
  const { id } = useParams();
  const { token } = useAuth();
  const { t } = useLang();
  const navigate = useNavigate();
  const playerRef = useRef(null);

  const [venue, setVenue] = useState(null);
  const [queue, setQueue] = useState([]);
  const [banned, setBanned] = useState([]);
  const [vibeVideos, setVibeVideos] = useState([]);
  const [nowPlaying, setNowPlaying] = useState(null);
  const [vibeActive, setVibeActive] = useState(false);
  const [tab, setTab] = useState('player');
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [skipping, setSkipping] = useState(false);

  useEffect(() => {
    if (!id || !token) return;
    loadVenue(); loadQueue(); loadBanned();
  }, [id, token]);

  async function loadVenue() {
    try {
      const v = await api.venues.get(id, token);
      setVenue(v); setLoading(false);
      if (v.vibe_mode_enabled) loadVibeVideos(v);
    } catch { navigate('/host/dashboard'); }
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
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'venues', filter: `id=eq.${id}` }, ({ new: u }) => setVenue(u))
      .subscribe();
    return () => { supabase.removeChannel(qSub); supabase.removeChannel(vSub); };
  }, [id]);

  const handleMarkPlaying = useCallback(async (itemId) => {
    await api.queue.updateStatus(id, itemId, 'playing', token).catch(() => {});
  }, [id, token]);
  const handleMarkPlayed = useCallback(async (itemId) => {
    await api.queue.updateStatus(id, itemId, 'played', token).catch(() => {});
  }, [id, token]);

  function handleSkip() {
    if (skipping) return;
    setSkipping(true);
    playerRef.current?.skip();
    setTimeout(() => setSkipping(false), 2500);
  }
  async function handleRemove(itemId) { await api.queue.remove(id, itemId, token).catch(() => {}); }
  async function handleVenueUpdate(updates) {
    try {
      const updated = await api.venues.update(id, updates, token);
      setVenue(updated);
      if (updates.vibe_mode_enabled !== undefined || updates.vibe_description !== undefined || updates.vibe_playlist_urls !== undefined) loadVibeVideos(updated);
    } catch {}
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: '#8B6F52', background: '#0E0A07', minHeight: '100vh' }}>{t.loading}</div>;
  if (!venue) return null;

  const bannedIds = new Set(banned.map(b => b.youtube_video_id));
  const pendingQueue = queue.filter(i => i.status === 'pending');
  const isActive = venue.status === 'active';

  const tabs = [
    { key: 'queue',  icon: <ListMusic size={14} />, label: `${t.queue} (${pendingQueue.length})` },
    { key: 'vibe',   icon: <Radio size={14} />,    label: t.vibe },
    { key: 'ban',    icon: <Ban size={14} />,       label: t.bannedSongs },
    { key: 'users',  icon: <Users size={14} />,     label: 'Users' },
    { key: 'stats',  icon: <BarChart2 size={14} />, label: t.stats },
    { key: 'qr',     icon: <QrCode size={14} />,    label: 'QR' },
  ];

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#0E0A07' }}>
      {/* Top bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '12px 20px', background: '#1A1008',
        borderBottom: '1px solid #2A1F17', flexShrink: 0,
      }}>
        <button onClick={() => navigate('/host/dashboard')} style={{ background: 'none', border: 'none', color: '#8B6F52', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
          <ArrowLeft size={20} />
        </button>
        <Logo size={26} />
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 800, flex: 1, color: '#F0E6D3' }}>{venue.name}</h1>
        <span style={{
          fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999,
          background: isActive ? 'rgba(52,211,153,0.12)' : 'rgba(248,113,113,0.12)',
          color: isActive ? '#34d399' : '#f87171',
        }}>
          {isActive ? t.active : t.closed}
        </span>
        {vibeActive && <span style={{ fontSize: 12, color: '#FF6B35', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}><Music size={13} /> Vibe</span>}
        <button className="btn-secondary" style={{ fontSize: 12 }}
          onClick={() => handleVenueUpdate({ status: isActive ? 'closed' : 'active' })}>
          {isActive ? t.closeRoom : t.openRoomAction}
        </button>
      </div>

      {/* Main layout */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Left — player */}
        <div style={{ flex: '0 0 480px', padding: 20, display: 'flex', flexDirection: 'column', gap: 16, overflowY: 'auto', borderRight: '1px solid #2A1F17' }}>
          <CrossfadePlayer
            ref={playerRef} queue={queue} vibeVideos={vibeVideos}
            vibeEnabled={venue.vibe_mode_enabled} crossfadeSecs={venue.crossfade_duration_seconds}
            jukeboxPaused={venue.jukebox_paused ?? false}
            onMarkPlaying={handleMarkPlaying} onMarkPlayed={handleMarkPlayed}
            onNowPlaying={setNowPlaying} onVibeActive={setVibeActive}
          />

          <NowPlaying nowPlaying={nowPlaying} vibeActive={vibeActive} />

          <div style={{ display: 'flex', gap: 10 }}>
            <button
              className="btn-secondary"
              style={{ flex: 1, fontSize: 13, borderColor: venue.jukebox_paused ? '#FF6B35' : '#2A1F17', color: venue.jukebox_paused ? '#FF6B35' : '#F0E6D3' }}
              onClick={() => handleVenueUpdate({ jukebox_paused: !venue.jukebox_paused })}
            >
              {venue.jukebox_paused ? <><Play size={15} /> Resume Jukebox</> : <><Pause size={15} /> Pause Jukebox</>}
            </button>

            {!nowPlaying && !venue.jukebox_paused && (
              <button className="btn-primary" style={{ flex: 1, fontSize: 13, background: '#22c55e' }}
                onClick={() => playerRef.current?.start()}>
                <Play size={15} /> Start Player
              </button>
            )}
            {nowPlaying && !venue.jukebox_paused && (
              <button className="btn-primary" style={{ flex: 1, fontSize: 13, opacity: skipping ? 0.5 : 1 }}
                onClick={handleSkip} disabled={skipping}>
                <SkipForward size={15} /> {skipping ? 'Skipping…' : t.skip}
              </button>
            )}
          </div>

          {venue.jukebox_paused && (
            <div style={{ background: 'rgba(255,107,53,0.08)', border: '1px solid rgba(255,107,53,0.3)', borderRadius: 10, padding: '10px 16px', fontSize: 13, color: '#FF6B35', textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              <Pause size={14} /> Jukebox is paused — guests cannot request songs
            </div>
          )}
        </div>

        {/* Right — tabs */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ display: 'flex', gap: 4, padding: '12px 16px', borderBottom: '1px solid #2A1F17', overflowX: 'auto', flexShrink: 0 }}>
            {tabs.map(({ key, icon, label }) => (
              <button key={key}
                onClick={() => { setTab(key); if (key === 'stats') loadStats(); }}
                style={{
                  padding: '6px 14px', borderRadius: 7, border: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
                  background: tab === key ? '#FF6B35' : '#1A1008',
                  color: tab === key ? '#F0E6D3' : '#8B6F52',
                  fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
                  display: 'flex', alignItems: 'center', gap: 5,
                }}>
                {icon} {label}
              </button>
            ))}
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
            {tab === 'queue' && <QueueDisplay items={queue} isHost onRemove={handleRemove} onSkip={handleSkip} nowPlaying={nowPlaying} />}
            {tab === 'vibe' && <VibeSettings venue={venue} onUpdate={handleVenueUpdate} />}
            {tab === 'ban' && <BanManager venueId={id} token={token} banned={banned} bannedIds={bannedIds} onReload={loadBanned} vibeDescription={venue.vibe_description ?? ''} />}
            {tab === 'users' && <UsersPanel venueId={id} token={token} />}
            {tab === 'stats' && <StatsPanel stats={stats} />}
            {tab === 'qr' && <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 24 }}><VenueQRCode roomCode={venue.room_code} size={220} /></div>}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Vibe settings ─────────────────────────────────────────────────────────────

function VibeSettings({ venue, onUpdate }) {
  const { t } = useLang();
  const [desc, setDesc] = useState(venue.vibe_description ?? '');
  const [urls, setUrls] = useState((venue.vibe_playlist_urls ?? []).join('\n'));
  const [enabled, setEnabled] = useState(venue.vibe_mode_enabled);
  const [crossfade, setCrossfade] = useState(venue.crossfade_duration_seconds);
  const [welcome, setWelcome] = useState(venue.welcome_credits);
  const [saving, setSaving] = useState(false);

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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 480 }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
        <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} style={{ width: 18, height: 18, accentColor: '#FF6B35' }} />
        <span style={{ fontWeight: 600, color: '#F0E6D3' }}>{t.enableVibe}</span>
      </label>

      <div>
        <label style={{ fontSize: 13, color: '#8B6F52', display: 'block', marginBottom: 6 }}>{t.vibeDescription}</label>
        <input className="input" value={desc} onChange={e => setDesc(e.target.value)} placeholder="e.g. upbeat party hits, 2000s pop, lofi chill" />
      </div>

      <div>
        <label style={{ fontSize: 13, color: '#8B6F52', display: 'block', marginBottom: 6 }}>{t.vibePlaylistUrls}</label>
        <textarea className="input" value={urls} onChange={e => setUrls(e.target.value)} rows={3}
          placeholder="https://youtube.com/playlist?list=..." style={{ resize: 'vertical' }} />
      </div>

      <div>
        <label style={{ fontSize: 13, color: '#8B6F52', display: 'block', marginBottom: 6 }}>
          {t.crossfadeDuration}: {crossfade} {t.seconds}
        </label>
        <input type="range" min={2} max={10} value={crossfade} onChange={e => setCrossfade(e.target.value)} style={{ width: '100%', accentColor: '#FF6B35' }} />
      </div>

      <div>
        <label style={{ fontSize: 13, color: '#8B6F52', display: 'block', marginBottom: 6 }}>{t.welcomeCredits}</label>
        <input className="input" type="number" min={0} max={100} value={welcome} onChange={e => setWelcome(e.target.value)} style={{ width: 100 }} />
      </div>

      <button className="btn-primary" onClick={save} disabled={saving} style={{ alignSelf: 'flex-start' }}>
        <Save size={15} /> {saving ? t.loading : t.save}
      </button>
    </div>
  );
}

// ── Ban manager ───────────────────────────────────────────────────────────────

function BanManager({ venueId, token, banned, bannedIds, onReload, vibeDescription }) {
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
      <h3 style={{ marginTop: 0, color: '#F0E6D3' }}>{t.banSong}</h3>
      <SongSearch bannedIds={bannedIds} onSelect={setSelected} vibeDescription={vibeDescription} />

      {selected && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(14,10,7,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 20 }}>
          <div style={{ background: '#120C06', border: '1px solid #2A1F17', borderRadius: 10, padding: 24, maxWidth: 360, width: '100%' }}>
            <p style={{ margin: '0 0 16px', fontWeight: 600, color: '#F0E6D3' }}>Ban "{selected.title}" from this venue?</p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn-primary" style={{ flex: 1, background: '#f87171' }} onClick={() => handleBan(selected)}>
                <Ban size={15} /> {t.banSong}
              </button>
              <button className="btn-secondary" onClick={() => setSelected(null)}>{t.cancel}</button>
            </div>
          </div>
        </div>
      )}

      <h3 style={{ marginTop: 24, color: '#F0E6D3' }}>{t.bannedSongs}</h3>
      {!banned.length && <p style={{ color: '#8B6F52' }}>None</p>}
      {banned.map(b => (
        <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#1A1008', border: '1px solid #2A1F17', borderRadius: 7, padding: '8px 12px', marginBottom: 8 }}>
          <span style={{ flex: 1, fontSize: 14, color: '#F0E6D3' }}>{b.song_title}</span>
          <button onClick={() => handleUnban(b.id)} style={{ background: 'none', border: 'none', color: '#FF6B35', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit' }}>
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
  if (!stats) return <p style={{ color: '#8B6F52' }}>{t.loading}</p>;
  return (
    <div>
      <div style={{ display: 'flex', gap: 20, marginBottom: 24 }}>
        <StatCard label={t.requestsToday} value={stats.totalRequests} />
        <StatCard label={t.creditsDistributed} value={stats.totalCredits} />
      </div>
      <h3 style={{ color: '#F0E6D3' }}>{t.topSongs}</h3>
      {stats.topSongs.map((s, i) => (
        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #2A1F17', fontSize: 14 }}>
          <span style={{ color: '#F0E6D3' }}>{s.title}</span>
          <span style={{ color: '#8B6F52', fontVariantNumeric: 'tabular-nums' }}>{s.count}×</span>
        </div>
      ))}
    </div>
  );
}

function StatCard({ label, value }) {
  return (
    <div style={{ flex: 1, background: '#1A1008', border: '1px solid #2A1F17', borderRadius: 10, padding: '16px 20px', textAlign: 'center' }}>
      <div style={{ fontSize: 28, fontWeight: 800, color: '#FF6B35' }}>{value}</div>
      <div style={{ fontSize: 12, color: '#8B6F52', marginTop: 4 }}>{label}</div>
    </div>
  );
}

// ── Users panel ───────────────────────────────────────────────────────────────

function UsersPanel({ venueId, token }) {
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
  const [giftAmount, setGiftAmount] = useState(10);
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
    try {
      await api.venues.gift(venueId, { guest_identifier: name, amount: giftAmount }, token);
      setGiftMsg(`✓ ${giftAmount} credits sent to ${name}`);
      setTimeout(() => { setGiftMsg(''); setModal(null); }, 2500);
    } catch (err) {
      const msg = err.data?.message ?? err.data?.error ?? 'error';
      setGiftMsg(`Failed: ${msg}`);
    }
  }

  // When a removed user makes a new song request, clear them so they reappear
  useEffect(() => {
    if (!removedNames.size) return;
    const currentRequesters = new Set(users.map(u => u.name));
    const rejoinedNames = [...removedNames].filter(n => currentRequesters.has(n));
    if (!rejoinedNames.length) return;
    // Clear from state and localStorage
    setRemovedNames(prev => { const next = new Set(prev); rejoinedNames.forEach(n => next.delete(n)); return next; });
    try {
      const key = `nb_removed_${venueId}`;
      const saved = JSON.parse(localStorage.getItem(key) ?? '[]');
      localStorage.setItem(key, JSON.stringify(saved.filter(n => !rejoinedNames.includes(n))));
    } catch {}
  }, [users]); // eslint-disable-line

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

  if (loading) return <p style={{ color: '#8B6F52' }}>Loading users…</p>;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h3 style={{ margin: 0, color: '#F0E6D3', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Users size={18} color="#FF6B35" /> Room Users
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
              background: filter === f ? '#FF6B35' : '#1A1008',
              color: filter === f ? '#F0E6D3' : '#8B6F52',
            }}>
              {f === 'all' ? `All (${allUsers.length})` : `Banned (${allUsers.filter(u => u.banned).length})`}
            </button>
          ))}
          <button onClick={load} style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid #2A1F17', background: 'none', color: '#8B6F52', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
            <RefreshCw size={13} />
          </button>
        </div>
      </div>

      {!displayed.length && (
        <p style={{ color: '#8B6F52', textAlign: 'center', marginTop: 32 }}>
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
              background: u.banned ? 'rgba(248,113,113,0.06)' : '#1A1008',
              border: `1px solid ${u.banned ? 'rgba(248,113,113,0.3)' : isOnline ? 'rgba(52,211,153,0.25)' : '#2A1F17'}`,
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
                    background: '#34d399', border: '2px solid #1A1008',
                  }} />
                )}
              </div>

              {/* Info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 14, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 160, color: '#F0E6D3' }}>
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
                <div style={{ fontSize: 12, color: '#8B6F52' }}>
                  {u.onlineOnly ? 'Just joined · no requests yet' : `${u.requests} ${u.requests === 1 ? 'song' : 'songs'} · ${u.credits} credits spent`}
                </div>
              </div>

              {/* More menu */}
              <div style={{ position: 'relative', flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                <button
                  onClick={() => setOpenMenu(openMenu === u.name ? null : u.name)}
                  style={{
                    width: 32, height: 32, borderRadius: 7, border: '1px solid #2A1F17',
                    background: openMenu === u.name ? '#FF6B35' : '#1A1008',
                    color: openMenu === u.name ? '#F0E6D3' : '#8B6F52',
                    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  <MoreHorizontal size={16} />
                </button>

                {openMenu === u.name && (
                  <div style={{
                    position: 'absolute', right: 0, top: 36, zIndex: 100,
                    background: '#120C06', border: '1px solid #2A1F17',
                    borderRadius: 10, minWidth: 160,
                    boxShadow: '0 8px 24px rgba(0,0,0,0.5)', overflow: 'hidden',
                  }}>
                    <MenuBtn icon={<Gift size={14} />} label="Gift Credits" color="#C89B6E"
                      onClick={() => { setOpenMenu(null); setGiftAmount(10); setGiftMsg(''); setModal({ type: 'gift', user: u }); }} />
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
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(14,10,7,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: 20 }}>
          <div style={{ background: '#120C06', border: '1px solid #2A1F17', borderRadius: 10, padding: 24, maxWidth: 340, width: '100%' }}>
            <p style={{ margin: '0 0 6px', fontWeight: 700, fontSize: 16, color: '#F0E6D3' }}>Remove "{modal.user.name}"?</p>
            <p style={{ margin: '0 0 20px', fontSize: 13, color: '#8B6F52' }}>Their pending song requests will be removed. They can still rejoin and request songs again.</p>
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
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(14,10,7,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: 20 }}>
          <div style={{ background: '#120C06', border: '1px solid #2A1F17', borderRadius: 10, padding: 24, maxWidth: 340, width: '100%' }}>
            <p style={{ margin: '0 0 6px', fontWeight: 700, fontSize: 16, color: '#F0E6D3' }}>Ban "{modal.user.name}"?</p>
            <p style={{ margin: '0 0 20px', fontSize: 13, color: '#8B6F52' }}>They won't be able to request songs in this room anymore.</p>
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
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(14,10,7,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: 20 }}>
          <div style={{ background: '#120C06', border: '1px solid #2A1F17', borderRadius: 10, padding: 24, maxWidth: 340, width: '100%' }}>
            <p style={{ margin: '0 0 4px', fontWeight: 700, fontSize: 16, color: '#F0E6D3', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Gift size={18} color="#C89B6E" /> Gift Credits
            </p>
            <p style={{ margin: '0 0 8px', fontSize: 13, color: '#8B6F52' }}>To: <strong style={{ color: '#F0E6D3' }}>{modal.user.name}</strong></p>
            {!modal.user.isRegistered && (
              <p style={{ margin: '0 0 12px', fontSize: 11, color: '#C89B6E', display: 'flex', alignItems: 'center', gap: 5, background: 'rgba(200,155,110,0.08)', border: '1px solid rgba(200,155,110,0.2)', borderRadius: 7, padding: '8px 10px' }}>
                <AlertTriangle size={11} /> This user appears to be a guest. Gifted credits only land in accounts — ask them to sign in first if they want to receive them.
              </p>
            )}
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              {[5, 10, 20, 50].map(amt => (
                <button key={amt} onClick={() => setGiftAmount(amt)} style={{
                  flex: 1, padding: '8px 0', borderRadius: 7,
                  border: `1px solid ${giftAmount === amt ? '#FF6B35' : '#2A1F17'}`,
                  background: giftAmount === amt ? 'rgba(255,107,53,0.15)' : '#1A1008',
                  color: giftAmount === amt ? '#FF6B35' : '#F0E6D3',
                  cursor: 'pointer', fontWeight: 700, fontSize: 14, fontFamily: 'inherit',
                }}>
                  {amt}
                </button>
              ))}
            </div>
            <input className="input" type="number" min={1} max={500} value={giftAmount}
              onChange={e => setGiftAmount(parseInt(e.target.value) || 1)} style={{ marginBottom: 14 }} />
            {giftMsg && <p style={{ margin: '0 0 12px', fontSize: 13, color: giftMsg.includes('Failed') ? '#f87171' : '#34d399' }}>{giftMsg}</p>}
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn-primary" style={{ flex: 1 }} onClick={() => handleGift(modal.user.name)}>
                <Gift size={15} /> Gift {giftAmount} Credits
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
      color: color ?? '#F0E6D3', cursor: 'pointer', textAlign: 'left', fontSize: 13, fontFamily: 'inherit',
    }}
      onMouseEnter={e => e.currentTarget.style.background = '#1A1008'}
      onMouseLeave={e => e.currentTarget.style.background = 'none'}
    >
      {icon} {label}
    </button>
  );
}
