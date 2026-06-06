import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useLang } from '../context/LangContext.jsx';
import { api } from '../lib/api.js';
import { supabase } from '../lib/supabase.js';
import CrossfadePlayer from '../components/CrossfadePlayer.jsx';
import QueueDisplay from '../components/QueueDisplay.jsx';
import NowPlaying from '../components/NowPlaying.jsx';
import VenueQRCode from '../components/VenueQRCode.jsx';
import SongSearch from '../components/SongSearch.jsx';

const TABS = ['queue', 'player', 'vibe', 'ban', 'gift', 'stats', 'qr'];

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

  // ── Load venue + queue ───────────────────────────────────────────────────

  useEffect(() => {
    if (!id || !token) return;
    loadVenue();
    loadQueue();
    loadBanned();
  }, [id, token]);

  async function loadVenue() {
    try {
      const v = await api.venues.get(id, token);
      setVenue(v);
      setLoading(false);
      if (v.vibe_mode_enabled) loadVibeVideos(v);
    } catch {
      navigate('/host/dashboard');
    }
  }

  async function loadQueue() {
    try {
      const q = await api.queue.list(id);
      setQueue(q);
    } catch {}
  }

  async function loadBanned() {
    try {
      const b = await api.venues.banned.list(id);
      setBanned(b);
    } catch {}
  }

  async function loadStats() {
    try {
      const s = await api.venues.stats(id, token);
      setStats(s);
    } catch {}
  }

  async function loadVibeVideos(v = venue) {
    if (!v) return;
    try {
      let videos = [];
      if (v.vibe_playlist_urls?.length) {
        for (const url of v.vibe_playlist_urls) {
          const playlistId = new URL(url).searchParams.get('list');
          if (playlistId) {
            const items = await api.youtube.playlist(playlistId);
            videos = [...videos, ...items];
          }
        }
      }
      if (!videos.length && v.vibe_description) {
        videos = await api.youtube.vibe(v.vibe_description);
      }
      setVibeVideos(videos);
    } catch {}
  }

  // ── Real-time subscriptions ───────────────────────────────────────────────

  useEffect(() => {
    if (!id) return;

    const queueSub = supabase
      .channel(`venue-queue-${id}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'queue_items',
        filter: `venue_id=eq.${id}`,
      }, () => loadQueue())
      .subscribe();

    const venueSub = supabase
      .channel(`venue-${id}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'venues',
        filter: `id=eq.${id}`,
      }, ({ new: updated }) => setVenue(updated))
      .subscribe();

    return () => {
      supabase.removeChannel(queueSub);
      supabase.removeChannel(venueSub);
    };
  }, [id]);

  // ── Player callbacks ──────────────────────────────────────────────────────

  const handleMarkPlaying = useCallback(async (itemId) => {
    await api.queue.updateStatus(id, itemId, 'playing', token).catch(() => {});
  }, [id, token]);

  const handleMarkPlayed = useCallback(async (itemId) => {
    await api.queue.updateStatus(id, itemId, 'played', token).catch(() => {});
  }, [id, token]);

  // ── Host controls ─────────────────────────────────────────────────────────

  function handleSkip() {
    if (skipping) return;
    setSkipping(true);
    playerRef.current?.skip();
    setTimeout(() => setSkipping(false), 2500);
  }

  async function handleRemove(itemId) {
    await api.queue.remove(id, itemId, token).catch(() => {});
  }

  async function handleVenueUpdate(updates) {
    try {
      const updated = await api.venues.update(id, updates, token);
      setVenue(updated);
      if (updates.vibe_mode_enabled !== undefined || updates.vibe_description !== undefined || updates.vibe_playlist_urls !== undefined) {
        loadVibeVideos(updated);
      }
    } catch {}
  }

  if (loading) {
    return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>{t.loading}</div>;
  }

  if (!venue) return null;

  const bannedIds = new Set(banned.map(b => b.youtube_video_id));
  const pendingQueue = queue.filter(i => i.status === 'pending');

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Top bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '12px 20px',
        background: 'var(--surface)',
        borderBottom: '1px solid var(--border)',
        flexShrink: 0,
      }}>
        <button onClick={() => navigate('/host/dashboard')} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 18 }}>
          ←
        </button>
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 800, flex: 1 }}>{venue.name}</h1>
        <span style={{
          fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999,
          background: venue.status === 'active' ? 'rgba(52,211,153,0.15)' : 'rgba(248,113,113,0.15)',
          color: venue.status === 'active' ? '#34d399' : '#f87171',
        }}>
          {venue.status === 'active' ? t.active : t.closed}
        </span>
        {vibeActive && (
          <span style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 600 }}>🎵 Vibe</span>
        )}
        <button
          className="btn-secondary"
          style={{ fontSize: 12 }}
          onClick={() => handleVenueUpdate({ status: venue.status === 'active' ? 'closed' : 'active' })}
        >
          {venue.status === 'active' ? t.closeRoom : t.openRoomAction}
        </button>
      </div>

      {/* Main layout */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Left — player + now playing */}
        <div style={{ flex: '0 0 480px', padding: 20, display: 'flex', flexDirection: 'column', gap: 16, overflowY: 'auto', borderRight: '1px solid var(--border)' }}>
          <CrossfadePlayer
            ref={playerRef}
            queue={queue}
            vibeVideos={vibeVideos}
            vibeEnabled={venue.vibe_mode_enabled}
            crossfadeSecs={venue.crossfade_duration_seconds}
            onMarkPlaying={handleMarkPlaying}
            onMarkPlayed={handleMarkPlayed}
            onNowPlaying={setNowPlaying}
            onVibeActive={setVibeActive}
          />

          <NowPlaying nowPlaying={nowPlaying} vibeActive={vibeActive} />

          <div style={{ display: 'flex', gap: 10 }}>
            {!nowPlaying && pendingQueue.length > 0 && (
              <button
                className="btn-primary"
                style={{ flex: 1, fontSize: 14, background: '#22c55e' }}
                onClick={() => playerRef.current?.start()}
              >
                ▶ Start Player
              </button>
            )}
            {nowPlaying && (
              <button className="btn-primary" style={{ flex: 1, fontSize: 14, opacity: skipping ? 0.5 : 1 }} onClick={handleSkip} disabled={skipping}>
                ⏭ {skipping ? 'Skipping…' : t.skip}
              </button>
            )}
          </div>
        </div>

        {/* Right — tabbed panels */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Tabs */}
          <div style={{ display: 'flex', gap: 4, padding: '12px 16px', borderBottom: '1px solid var(--border)', overflowX: 'auto', flexShrink: 0 }}>
            {[
              { key: 'queue', label: `${t.queue} (${pendingQueue.length})` },
              { key: 'vibe', label: t.vibe },
              { key: 'ban', label: t.bannedSongs },
              { key: 'gift', label: t.giftCredits },
              { key: 'stats', label: t.stats },
              { key: 'qr', label: 'QR' },
            ].map(({ key, label }) => (
              <button
                key={key}
                onClick={() => { setTab(key); if (key === 'stats') loadStats(); }}
                style={{
                  padding: '6px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
                  background: tab === key ? 'var(--accent)' : 'var(--surface)',
                  color: tab === key ? '#fff' : 'var(--text-muted)',
                  fontSize: 13, fontWeight: 600,
                }}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
            {tab === 'queue' && (
              <QueueDisplay
                items={queue}
                isHost
                onRemove={handleRemove}
                onSkip={handleSkip}
                nowPlaying={nowPlaying}
              />
            )}

            {tab === 'vibe' && (
              <VibeSettings venue={venue} onUpdate={handleVenueUpdate} />
            )}

            {tab === 'ban' && (
              <BanManager venueId={id} token={token} banned={banned} bannedIds={bannedIds} onReload={loadBanned} />
            )}

            {tab === 'gift' && (
              <GiftCredits venueId={id} token={token} />
            )}

            {tab === 'stats' && (
              <StatsPanel stats={stats} />
            )}

            {tab === 'qr' && (
              <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 24 }}>
                <VenueQRCode roomCode={venue.room_code} size={220} />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Vibe settings panel ──────────────────────────────────────────────────────

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
        <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} style={{ width: 18, height: 18 }} />
        <span style={{ fontWeight: 600 }}>{t.enableVibe}</span>
      </label>

      <div>
        <label style={{ fontSize: 13, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>{t.vibeDescription}</label>
        <input className="input" value={desc} onChange={e => setDesc(e.target.value)} placeholder="e.g. chill Bollywood 90s" />
      </div>

      <div>
        <label style={{ fontSize: 13, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>{t.vibePlaylistUrls}</label>
        <textarea
          className="input"
          value={urls}
          onChange={e => setUrls(e.target.value)}
          rows={3}
          placeholder="https://youtube.com/playlist?list=..."
          style={{ resize: 'vertical' }}
        />
      </div>

      <div>
        <label style={{ fontSize: 13, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>
          {t.crossfadeDuration}: {crossfade} {t.seconds}
        </label>
        <input type="range" min={2} max={10} value={crossfade} onChange={e => setCrossfade(e.target.value)} style={{ width: '100%' }} />
      </div>

      <div>
        <label style={{ fontSize: 13, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>{t.welcomeCredits}</label>
        <input className="input" type="number" min={0} max={100} value={welcome} onChange={e => setWelcome(e.target.value)} style={{ width: 100 }} />
      </div>

      <button className="btn-primary" onClick={save} disabled={saving} style={{ alignSelf: 'flex-start' }}>
        {saving ? t.loading : t.save}
      </button>
    </div>
  );
}

// ── Ban manager ──────────────────────────────────────────────────────────────

function BanManager({ venueId, token, banned, bannedIds, onReload }) {
  const { t } = useLang();
  const [selected, setSelected] = useState(null);

  async function handleBan(song) {
    await api.venues.banned.add(venueId, {
      youtube_video_id: song.videoId,
      song_title: song.title,
      thumbnail_url: song.thumbnail,
    }, token).catch(() => {});
    onReload();
    setSelected(null);
  }

  async function handleUnban(id) {
    await api.venues.banned.remove(venueId, id, token).catch(() => {});
    onReload();
  }

  return (
    <div>
      <h3 style={{ marginTop: 0 }}>{t.banSong}</h3>
      <SongSearch bannedIds={bannedIds} onSelect={setSelected} />

      {selected && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 100, padding: 20,
        }}>
          <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 14, padding: 24, maxWidth: 360, width: '100%' }}>
            <p style={{ margin: '0 0 16px', fontWeight: 600 }}>Ban "{selected.title}" from this venue?</p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn-primary" style={{ flex: 1, background: '#f87171' }} onClick={() => handleBan(selected)}>
                {t.banSong}
              </button>
              <button className="btn-secondary" onClick={() => setSelected(null)}>{t.cancel}</button>
            </div>
          </div>
        </div>
      )}

      <h3 style={{ marginTop: 24 }}>{t.bannedSongs}</h3>
      {!banned.length && <p style={{ color: 'var(--text-muted)' }}>None</p>}
      {banned.map(b => (
        <div key={b.id} style={{
          display: 'flex', alignItems: 'center', gap: 10,
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 8, padding: '8px 12px', marginBottom: 8,
        }}>
          <span style={{ flex: 1, fontSize: 14 }}>{b.song_title}</span>
          <button
            onClick={() => handleUnban(b.id)}
            style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 13 }}
          >
            {t.unban}
          </button>
        </div>
      ))}
    </div>
  );
}

// ── Gift credits ─────────────────────────────────────────────────────────────

function GiftCredits({ venueId, token }) {
  const { t } = useLang();
  const [guest, setGuest] = useState('');
  const [amount, setAmount] = useState(10);
  const [msg, setMsg] = useState('');

  async function handleGift(e) {
    e.preventDefault();
    try {
      await api.venues.gift(venueId, { guest_identifier: guest, amount }, token);
      setMsg('✓ Credits gifted!');
      setGuest('');
      setTimeout(() => setMsg(''), 3000);
    } catch (err) {
      setMsg('✗ ' + (err.data?.error ?? err.message));
    }
  }

  return (
    <form onSubmit={handleGift} style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 360 }}>
      <h3 style={{ margin: '0 0 4px' }}>{t.giftCredits}</h3>
      <input className="input" placeholder={t.guestIdentifier} value={guest} onChange={e => setGuest(e.target.value)} required />
      <input className="input" type="number" min={1} max={100} value={amount} onChange={e => setAmount(e.target.value)} />
      <button className="btn-primary" type="submit" style={{ alignSelf: 'flex-start' }}>{t.gift}</button>
      {msg && <p style={{ margin: 0, fontSize: 13, color: msg.startsWith('✓') ? '#34d399' : '#f87171' }}>{msg}</p>}
    </form>
  );
}

// ── Stats panel ───────────────────────────────────────────────────────────────

function StatsPanel({ stats }) {
  const { t } = useLang();
  if (!stats) return <p style={{ color: 'var(--text-muted)' }}>{t.loading}</p>;

  return (
    <div>
      <div style={{ display: 'flex', gap: 20, marginBottom: 24 }}>
        <StatCard label={t.requestsToday} value={stats.totalRequests} />
        <StatCard label={t.creditsDistributed} value={stats.totalCredits} />
      </div>
      <h3>{t.topSongs}</h3>
      {stats.topSongs.map((s, i) => (
        <div key={i} style={{
          display: 'flex', justifyContent: 'space-between',
          padding: '8px 0', borderBottom: '1px solid var(--border)',
          fontSize: 14,
        }}>
          <span>{s.title}</span>
          <span style={{ color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>{s.count}×</span>
        </div>
      ))}
    </div>
  );
}

function StatCard({ label, value }) {
  return (
    <div style={{
      flex: 1, background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 12, padding: '16px 20px', textAlign: 'center',
    }}>
      <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--accent)' }}>{value}</div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{label}</div>
    </div>
  );
}
