import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Search, ListMusic, Clock, Music, Pause } from 'lucide-react';
import Logo from '../components/Logo.jsx';
import VersionFooter from '../components/VersionFooter.jsx';
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
  const [selected, setSelected] = useState(null);
  const [quickPrice, setQuickPrice] = useState(3);
  const [sessionHistory, setSessionHistory] = useState([]);
  const [tab, setTab] = useState('search');
  const [toast, setToast] = useState('');
  const prevCreditsRef = useRef(null);

  // Redirect to join if not authenticated
  useEffect(() => {
    if (!token) navigate(`/join/${roomCode}`, { replace: true });
  }, [token]);

  useEffect(() => { if (token) loadVenue(); }, [roomCode, token]);

  useEffect(() => {
    const bal = profile?.credits_balance ?? 0;
    setCredits(bal);
    prevCreditsRef.current = bal;
  }, [profile?.id]); // initialise once per session, not on every balance change

  // Real-time: watch our own users row for credit gifts from the host
  useEffect(() => {
    if (!profile?.id) return;
    const sub = supabase
      .channel(`credits-${profile.id}`)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'users',
        filter: `id=eq.${profile.id}`,
      }, (payload) => {
        const newBal = payload.new?.credits_balance ?? 0;
        const prev = prevCreditsRef.current ?? 0;
        const diff = newBal - prev;
        if (diff > 0) {
          // Credits increased — must be a gift (spending always goes through handleConfirm which updates locally)
          showToast(`🎁 You've been gifted ${diff} credit${diff !== 1 ? 's' : ''}! You now have ${newBal} credit${newBal !== 1 ? 's' : ''}.`, 5000);
        }
        prevCreditsRef.current = newBal;
        setCredits(newBal);
      })
      .subscribe();
    return () => supabase.removeChannel(sub);
  }, [profile?.id]); // eslint-disable-line

  async function loadVenue() {
    try {
      const v = await api.venues.getByCode(roomCode);
      setVenue(v);
      loadQueue(v.id);
      loadBanned(v.id);
    } catch { navigate('/guest'); }
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

  // Real-time queue updates — NO filter (filtered subscriptions need special Supabase
  // publication config; check venue_id manually in the callback instead)
  // Also runs a polling fallback every 8s in case real-time is silently broken
  // (common on Supabase free tier if queue_items isn't in the realtime publication
  // or guest RLS policies don't allow SELECT)
  useEffect(() => {
    if (!venue) return;

    const qSub = supabase
      .channel(`guest-queue-${venue.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'queue_items' },
        (payload) => {
          const vid = payload.new?.venue_id ?? payload.old?.venue_id;
          if (!vid || vid === venue.id) loadQueue(venue.id); // vid missing on DELETE — refresh anyway
        })
      .subscribe();

    // Also subscribe to venue changes so jukebox_paused / queue_open_when_paused update live
    const vSub = supabase
      .channel(`guest-venue-${venue.id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'venues' },
        (payload) => { if (payload.new?.id === venue.id) setVenue(payload.new); })
      .subscribe();

    // Polling fallback — guarantees now-playing updates even if real-time is silent
    const poll = setInterval(() => loadQueue(venue.id), 8000);

    return () => {
      supabase.removeChannel(qSub);
      supabase.removeChannel(vSub);
      clearInterval(poll);
    };
  }, [venue?.id]); // eslint-disable-line

  // Presence: broadcast identity to host's Users tab
  useEffect(() => {
    if (!venue || !profile) return;
    const ch = supabase.channel(`presence-${venue.id}`);
    ch.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await ch.track({ name: profile.display_name, isRegistered: true, ts: Date.now() });
      }
    });
    return () => supabase.removeChannel(ch);
  }, [venue?.id, profile?.display_name]);

  const handleSelect = useCallback(async (song) => {
    const isBanned = banned.some(b => b.youtube_video_id === song.videoId);
    if (isBanned) { showToast(t.songBanned); return; }
    if (venue) {
      const { price } = await api.queue.price(venue.id).catch(() => ({ price: 3 }));
      setQuickPrice(price);
    }
    setSelected(song);
  }, [banned, venue, t]);

  async function handleConfirm(playType) {
    if (!selected || !venue) return;
    if (venue.jukebox_paused && !venue.queue_open_when_paused) { showToast('Jukebox is paused — try again soon'); setSelected(null); return; }
    const cost = playType === 'normal' ? 2 : quickPrice;
    if (credits < cost) { showToast(t.insufficientCredits); return; }
    const requesterName = profile?.display_name ?? 'Guest';
    try {
      const result = await api.queue.add(venue.id, {
        youtube_video_id: selected.videoId, song_title: selected.title,
        thumbnail_url: selected.thumbnail, play_type: playType, requester_name: requesterName,
      }, token);
      const newBalance = credits - result.credits_charged;
      prevCreditsRef.current = newBalance;
      setCredits(newBalance);
      refreshProfile();
      setSessionHistory(prev => [{ ...selected, playType, credits: result.credits_charged }, ...prev]);
      showToast(t.songAddedToQueue);
      setSelected(null);
      loadQueue(venue.id);
    } catch (err) {
      const msg = err.data?.error;
      if (msg === 'insufficient_credits') showToast(t.insufficientCredits);
      else if (msg === 'song_banned') showToast(t.songBanned);
      else if (msg === 'user_banned') showToast('You have been banned from this jukebox');
      else showToast(t.error);
    }
  }

  function showToast(msg, duration = 3000) {
    setToast(msg);
    setTimeout(() => setToast(''), duration);
  }

  const nowPlayingItem = queue.find(i => i.status === 'playing');
  const nowPlaying = nowPlayingItem ? { type: 'requested', item: nowPlayingItem } : null;
  const vibeActive = !nowPlayingItem && venue?.vibe_mode_enabled && queue.filter(i => i.status === 'pending').length === 0;
  const bannedIds = new Set(banned.map(b => b.youtube_video_id));

  if (!venue) return <div className="center-screen"><p style={{ color: '#8B6F52' }}>{t.loading}</p></div>;

  const tabs = [
    { key: 'search', icon: <Search size={14} />, label: 'Search' },
    { key: 'queue', icon: <ListMusic size={14} />, label: `Queue (${queue.filter(i => i.status === 'pending').length})` },
    { key: 'history', icon: <Clock size={14} />, label: 'History' },
  ];

  return (
    <div style={{ maxWidth: 520, margin: '0 auto', padding: '0 0 80px', minHeight: '100vh', background: '#0E0A07' }}>
      {/* Header */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 50,
        background: '#120C06', borderBottom: '1px solid #2A1F17',
        padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 16, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: '#F0E6D3', display: 'flex', alignItems: 'center', gap: 7 }}>
            <Logo size={20} /> {venue.name}
          </div>
          {vibeActive && (
            <div style={{ fontSize: 11, color: '#FF6B35', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
              <Music size={11} /> {t.vibeMode}
            </div>
          )}
        </div>
        <CreditBalance balance={credits} />
      </div>

      <div style={{ padding: '12px 16px' }}>
        <NowPlaying nowPlaying={nowPlaying} vibeActive={vibeActive} />
      </div>

      {/* Paused — blocked entirely */}
      {venue.jukebox_paused && !venue.queue_open_when_paused ? (
        <div style={{ padding: '48px 24px', textAlign: 'center' }}>
          <Pause size={52} color="#FF6B35" style={{ marginBottom: 16, opacity: 0.7 }} />
          <h2 style={{ margin: '0 0 10px', color: '#F0E6D3', fontSize: 20 }}>Jukebox Paused</h2>
          <p style={{ margin: 0, color: '#8B6F52', fontSize: 14 }}>
            The host has paused song requests.<br />Check back in a moment!
          </p>
        </div>
      ) : (
        <>
      {/* Queuing-mode banner (paused but accepting requests) */}
      {venue.jukebox_paused && venue.queue_open_when_paused && (
        <div style={{
          margin: '0 16px 12px', padding: '10px 14px', borderRadius: 10,
          background: 'rgba(52,211,153,0.07)', border: '1px solid rgba(52,211,153,0.25)',
          display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#34d399',
        }}>
          <ListMusic size={14} />
          <span><strong>Queuing mode</strong> — add songs now, they'll play when the host starts the jukebox.</span>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, padding: '0 16px 12px', borderBottom: '1px solid #2A1F17' }}>
        {tabs.map(({ key, icon, label }) => (
          <button key={key} onClick={() => setTab(key)} style={{
            padding: '6px 12px', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 12,
            background: tab === key ? '#FF6B35' : '#1A1008',
            color: tab === key ? '#F0E6D3' : '#8B6F52',
            fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5, fontFamily: 'inherit',
          }}>
            {icon} {label}
          </button>
        ))}
      </div>

      <div style={{ padding: '16px' }}>
        {tab === 'search' && <SongSearch bannedIds={bannedIds} onSelect={handleSelect} vibeDescription={venue.vibe_description ?? ''} />}
        {tab === 'queue' && <QueueDisplay items={queue} isHost={false} />}
        {tab === 'history' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {!sessionHistory.length && <p style={{ color: '#8B6F52', textAlign: 'center' }}>{t.requestHistory}</p>}
            {sessionHistory.map((s, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                background: '#1A1008', border: '1px solid #2A1F17', borderRadius: 10, padding: '10px 14px',
              }}>
                {s.thumbnail && <img src={s.thumbnail} alt="" style={{ width: 48, height: 36, objectFit: 'cover', borderRadius: 4 }} />}
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#F0E6D3' }}>{s.title}</div>
                  <div style={{ fontSize: 11, color: '#8B6F52' }}>{s.playType} · {s.credits} {t.credits}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Song confirmation modal */}
      {selected && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(14,10,7,0.85)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 200, padding: '0 0 16px' }}>
          <div style={{ background: '#120C06', border: '1px solid #2A1F17', borderRadius: '14px 14px 10px 10px', padding: 24, width: '100%', maxWidth: 520 }}>
            <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
              {selected.thumbnail && <img src={selected.thumbnail} alt="" style={{ width: 72, height: 54, objectFit: 'cover', borderRadius: 8 }} />}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: '#F0E6D3' }}>{selected.title}</div>
                <div style={{ fontSize: 12, color: '#8B6F52' }}>{selected.channel}</div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
              <button style={{ flex: 1, padding: 14, borderRadius: 7, border: 'none', cursor: 'pointer', background: credits >= 2 ? '#3D2B1A' : '#1A1008', color: credits >= 2 ? '#F0E6D3' : '#5A4535', fontWeight: 700, fontSize: 14, fontFamily: 'inherit', opacity: credits < 2 ? 0.5 : 1 }}
                onClick={() => handleConfirm('normal')} disabled={credits < 2}>
                {t.normalPlay}<br /><span style={{ fontSize: 12, fontWeight: 400, color: '#8B6F52' }}>2 {t.credits}</span>
              </button>
              <button style={{ flex: 1, padding: 14, borderRadius: 7, border: 'none', cursor: 'pointer', background: credits >= quickPrice ? '#FF6B35' : '#1A1008', color: '#F0E6D3', fontWeight: 700, fontSize: 14, fontFamily: 'inherit', opacity: credits < quickPrice ? 0.5 : 1, boxShadow: credits >= quickPrice ? '0 0 14px rgba(255,107,53,0.4)' : 'none' }}
                onClick={() => handleConfirm('quick')} disabled={credits < quickPrice}>
                Quick Play<br /><span style={{ fontSize: 12, fontWeight: 400 }}>{quickPrice} {t.credits}</span>
              </button>
            </div>
            <button className="btn-secondary" style={{ width: '100%' }} onClick={() => setSelected(null)}>{t.cancel}</button>
          </div>
        </div>
      )}
        </>
      )}

      {toast && (
        <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', background: '#1A1008', border: '1px solid #FF6B35', borderRadius: 999, padding: '10px 20px', fontSize: 14, fontWeight: 600, zIndex: 300, boxShadow: '0 8px 24px rgba(0,0,0,0.5)', color: '#F0E6D3', whiteSpace: 'nowrap' }}>
          {toast}
        </div>
      )}

      <VersionFooter />
    </div>
  );
}
