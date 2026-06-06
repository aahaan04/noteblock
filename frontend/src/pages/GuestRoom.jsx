import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useLang } from '../context/LangContext.jsx';
import { api } from '../lib/api.js';
import { supabase } from '../lib/supabase.js';
import SongSearch from '../components/SongSearch.jsx';
import QueueDisplay from '../components/QueueDisplay.jsx';
import NowPlaying from '../components/NowPlaying.jsx';
import CreditBalance from '../components/CreditBalance.jsx';

export default function GuestRoom() {
  const { roomCode } = useParams();
  const { profile, token, refreshProfile } = useAuth();
  const { t } = useLang();
  const navigate = useNavigate();

  const [venue, setVenue] = useState(null);
  const [queue, setQueue] = useState([]);
  const [banned, setBanned] = useState([]);
  const [credits, setCredits] = useState(0);
  const [isAnon, setIsAnon] = useState(!token);
  const [selected, setSelected] = useState(null); // song pending confirmation
  const [quickPrice, setQuickPrice] = useState(3);
  const [sessionHistory, setSessionHistory] = useState([]);
  const [tab, setTab] = useState('search'); // 'search' | 'queue' | 'history'
  const [toast, setToast] = useState('');

  // ── Init ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    loadVenue();
  }, [roomCode]);

  useEffect(() => {
    if (profile) setCredits(profile.credits_balance ?? 0);
    else setCredits(parseInt(localStorage.getItem('nb_anon_credits') ?? '0'));
  }, [profile]);

  async function loadVenue() {
    try {
      const v = await api.venues.getByCode(roomCode);
      setVenue(v);
      loadQueue(v.id);
      loadBanned(v.id);
    } catch {
      navigate('/');
    }
  }

  async function loadQueue(venueId) {
    const id = venueId ?? venue?.id;
    if (!id) return;
    const q = await api.queue.list(id).catch(() => []);
    setQueue(q);
  }

  async function loadBanned(venueId) {
    const id = venueId ?? venue?.id;
    if (!id) return;
    const b = await api.venues.banned.list(id).catch(() => []);
    setBanned(b);
  }

  // ── Real-time ─────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!venue) return;

    const sub = supabase
      .channel(`guest-queue-${venue.id}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'queue_items',
        filter: `venue_id=eq.${venue.id}`,
      }, () => loadQueue(venue.id))
      .subscribe();

    return () => supabase.removeChannel(sub);
  }, [venue]);

  // ── Song selection flow ───────────────────────────────────────────────────

  const handleSelect = useCallback(async (song) => {
    // Check ban
    const isBanned = banned.some(b => b.youtube_video_id === song.videoId);
    if (isBanned) { showToast(t.songBanned); return; }

    // Fetch live quick play price
    if (venue) {
      const { price } = await api.queue.price(venue.id).catch(() => ({ price: 3 }));
      setQuickPrice(price);
    }
    setSelected(song);
  }, [banned, venue, t]);

  async function handleConfirm(playType) {
    if (!selected || !venue) return;
    if (venue.jukebox_paused) {
      showToast('⏸ Jukebox is paused — try again soon');
      setSelected(null);
      return;
    }
    const cost = playType === 'normal' ? 2 : quickPrice;

    if (credits < cost) {
      showToast(t.insufficientCredits);
      return;
    }

    const requesterName = profile?.display_name ?? 'Guest';

    try {
      const result = await api.queue.add(venue.id, {
        youtube_video_id: selected.videoId,
        song_title: selected.title,
        thumbnail_url: selected.thumbnail,
        play_type: playType,
        requester_name: requesterName,
      }, token ?? null);

      // Deduct credits locally
      const newBalance = credits - result.credits_charged;
      setCredits(newBalance);
      if (!token) localStorage.setItem('nb_anon_credits', String(Math.max(0, newBalance)));
      if (token) refreshProfile();

      setSessionHistory(prev => [{ ...selected, playType, credits: result.credits_charged }, ...prev]);
      showToast(t.songAddedToQueue);
      setSelected(null);
      loadQueue(venue.id); // refresh immediately, don't wait for real-time
    } catch (err) {
      const msg = err.data?.error;
      if (msg === 'insufficient_credits') showToast(t.insufficientCredits);
      else if (msg === 'song_banned') showToast(t.songBanned);
      else showToast(t.error);
    }
  }

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  }

  const nowPlayingItem = queue.find(i => i.status === 'playing');
  const nowPlaying = nowPlayingItem
    ? { type: 'requested', item: nowPlayingItem }
    : null;
  const vibeActive = !nowPlayingItem && venue?.vibe_mode_enabled && queue.filter(i => i.status === 'pending').length === 0;

  const bannedIds = new Set(banned.map(b => b.youtube_video_id));

  if (!venue) {
    return <div className="center-screen"><p style={{ color: 'var(--text-muted)' }}>{t.loading}</p></div>;
  }

  return (
    <div style={{ maxWidth: 520, margin: '0 auto', padding: '0 0 80px', minHeight: '100vh' }}>
      {/* Header */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 50,
        background: 'var(--bg)',
        borderBottom: '1px solid var(--border)',
        padding: '12px 16px',
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 16, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            🎵 {venue.name}
          </div>
          {vibeActive && (
            <div style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 600 }}>{t.vibeMode}</div>
          )}
        </div>
        <CreditBalance balance={credits} anonymous={isAnon} />
      </div>

      {/* Paused banner */}
      {venue.jukebox_paused && (
        <div style={{ background: 'rgba(245,158,11,0.12)', borderBottom: '1px solid #f59e0b', padding: '10px 16px', fontSize: 13, color: '#f59e0b', textAlign: 'center' }}>
          ⏸ The jukebox is paused — song requests are temporarily disabled
        </div>
      )}

      {/* Now playing */}
      <div style={{ padding: '12px 16px' }}>
        <NowPlaying nowPlaying={nowPlaying} vibeActive={vibeActive} />
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, padding: '0 16px 12px', borderBottom: '1px solid var(--border)' }}>
        {[
          { key: 'search', label: '🔍 ' + t.searchSongs.replace('…', '') },
          { key: 'queue', label: `📋 ${t.queue} (${queue.filter(i => i.status === 'pending').length})` },
          { key: 'history', label: '🕓 History' },
        ].map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            style={{
              padding: '6px 12px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 12,
              background: tab === key ? 'var(--accent)' : 'var(--surface)',
              color: tab === key ? '#fff' : 'var(--text-muted)',
              fontWeight: 600,
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div style={{ padding: '16px' }}>
        {tab === 'search' && (
          <SongSearch bannedIds={bannedIds} onSelect={handleSelect} />
        )}

        {tab === 'queue' && (
          <QueueDisplay items={queue} isHost={false} />
        )}

        {tab === 'history' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {!sessionHistory.length && (
              <p style={{ color: 'var(--text-muted)', textAlign: 'center' }}>{t.requestHistory}</p>
            )}
            {sessionHistory.map((s, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                background: 'var(--surface)', border: '1px solid var(--border)',
                borderRadius: 8, padding: '10px 14px',
              }}>
                {s.thumbnail && <img src={s.thumbnail} alt="" style={{ width: 48, height: 36, objectFit: 'cover', borderRadius: 4 }} />}
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{s.title}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{s.playType} · {s.credits} {t.credits}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Song confirmation modal */}
      {selected && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)',
          display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
          zIndex: 200, padding: '0 0 16px',
        }}>
          <div style={{
            background: 'var(--bg)',
            border: '1px solid var(--border)',
            borderRadius: '20px 20px 14px 14px',
            padding: 24,
            width: '100%', maxWidth: 520,
          }}>
            <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
              {selected.thumbnail && (
                <img src={selected.thumbnail} alt="" style={{ width: 72, height: 54, objectFit: 'cover', borderRadius: 8 }} />
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {selected.title}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{selected.channel}</div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
              <button
                className="btn-primary"
                style={{ flex: 1, padding: 14 }}
                onClick={() => handleConfirm('normal')}
                disabled={credits < 2}
              >
                {t.normalPlay}<br />
                <span style={{ fontSize: 12, fontWeight: 400 }}>2 {t.credits}</span>
              </button>
              <button
                className="btn-primary"
                style={{ flex: 1, padding: 14, background: credits < quickPrice ? 'var(--surface)' : 'var(--accent2)' }}
                onClick={() => handleConfirm('quick')}
                disabled={credits < quickPrice}
              >
                ⚡ {t.quickPlay}<br />
                <span style={{ fontSize: 12, fontWeight: 400 }}>{quickPrice} {t.credits}</span>
              </button>
            </div>

            <button className="btn-secondary" style={{ width: '100%' }} onClick={() => setSelected(null)}>
              {t.cancel}
            </button>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          background: 'var(--surface)',
          border: '1px solid var(--accent)',
          borderRadius: 999,
          padding: '10px 20px',
          fontSize: 14, fontWeight: 600,
          zIndex: 300,
          boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
        }}>
          {toast}
        </div>
      )}
    </div>
  );
}
