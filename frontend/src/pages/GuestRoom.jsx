import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Search, ListMusic, Clock, Pause, Settings, X, Sun, Moon, LogOut, Check } from 'lucide-react';
import Logo from '../components/Logo.jsx';
import VersionFooter from '../components/VersionFooter.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useLang } from '../context/LangContext.jsx';
import { useTheme } from '../context/ThemeContext.jsx';
import { api } from '../lib/api.js';
import { supabase } from '../lib/supabase.js';
import SongSearch from '../components/SongSearch.jsx';
import QueueDisplay from '../components/QueueDisplay.jsx';
import NowPlaying from '../components/NowPlaying.jsx';
import CreditBalance from '../components/CreditBalance.jsx';

const decode = s => s?.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&#x27;/g, "'") ?? s;

const HISTORY_MAX = 100;
const CONFETTI_COLORS = ['#FF6B35','#FFD700','#34d399','#60a5fa','#f472b6','#a78bfa','#FF4444','#FFCC00'];

function historyKey(venueId, profileId) {
  return `nb_history_${venueId}_${profileId ?? 'anon'}`;
}
function loadStoredHistory(venueId, profileId) {
  try { return JSON.parse(localStorage.getItem(historyKey(venueId, profileId)) ?? '[]'); }
  catch { return []; }
}
function saveStoredHistory(venueId, profileId, entries) {
  try { localStorage.setItem(historyKey(venueId, profileId), JSON.stringify(entries.slice(0, HISTORY_MAX))); }
  catch {}
}
function formatHistoryDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const diffDays = Math.floor((Date.now() - d) / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// ── Warning popup shown when guest tries to request while jukebox is off ─────
function PausedWarnPopup({ onDismiss, t }) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, 3500);
    return () => clearTimeout(timer);
  }, []); // eslint-disable-line

  return (
    <div
      onClick={onDismiss}
      style={{
        position: 'fixed', inset: 0, zIndex: 500,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}
    >
      <style>{`
        @keyframes pwPopIn {
          0%   { opacity: 0; transform: scale(0.7) translateY(20px); }
          60%  { transform: scale(1.04) translateY(-4px); }
          100% { opacity: 1; transform: scale(1) translateY(0); }
        }
        @keyframes pwIconPop {
          0%   { transform: scale(0); opacity: 0; }
          70%  { transform: scale(1.2); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes pwDrain {
          0%   { width: 100%; }
          100% { width: 0%; }
        }
      `}</style>
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--bg-page)', border: '1px solid var(--border)',
          borderRadius: 20, padding: '32px 24px 24px',
          width: '100%', maxWidth: 320, textAlign: 'center',
          boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
          animation: 'pwPopIn 0.4s cubic-bezier(0.34,1.56,0.64,1) forwards',
          position: 'relative',
        }}
      >
        <button
          onClick={onDismiss}
          style={{
            position: 'absolute', top: 12, right: 12,
            background: 'var(--bg-card)', border: '1px solid var(--border)',
            borderRadius: 6, color: 'var(--text-muted)',
            cursor: 'pointer', padding: 4, display: 'flex', alignItems: 'center',
          }}
        >
          <X size={14} />
        </button>
        <div style={{
          width: 64, height: 64, borderRadius: '50%',
          background: 'rgba(255,107,53,0.12)', border: '2px solid rgba(255,107,53,0.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 16px',
          animation: 'pwIconPop 0.4s 0.15s cubic-bezier(0.34,1.56,0.64,1) both',
        }}>
          <Pause size={28} color="#FF6B35" />
        </div>
        <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 8 }}>
          {t.jukeboxOff}
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: 18 }}>
          {t.jukeboxOffMsg}
        </div>
        <div style={{ height: 3, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
          <div style={{ height: '100%', background: '#FF6B35', borderRadius: 2, animation: 'pwDrain 3.5s linear forwards' }} />
        </div>
      </div>
    </div>
  );
}

// ── Confetti popup shown when a song is successfully added ──────────────────
function SongAddedPopup({ popup, onDismiss }) {
  const particles = useMemo(() => {
    const N = 32;
    return Array.from({ length: N }, (_, i) => ({
      id: i,
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      left: `${2 + ((i / N) * 96).toFixed(1)}%`,
      delay: `${(i % 8) * 55}ms`,
      dur: `${520 + (i % 5) * 110}ms`,
      w: 5 + (i % 3) * 3,
      h: 4 + (i % 2) * 4,
      startRot: i * 41,
    }));
  }, []);

  useEffect(() => {
    if (!popup) return;
    const t = setTimeout(onDismiss, 3500);
    return () => clearTimeout(t);
  }, [popup]); // eslint-disable-line

  if (!popup) return null;

  const isQuick = popup.playType === 'quick';

  return (
    <>
      {/* CSS keyframes */}
      <style>{`
        @keyframes cfFall {
          0%   { opacity: 1; transform: translateY(-6px) rotate(0deg) scaleX(1); }
          45%  { opacity: 1; }
          100% { opacity: 0; transform: translateY(150px) rotate(600deg) scaleX(-1); }
        }
        @keyframes popIn {
          0%   { opacity: 0; transform: scale(0.7) translateY(20px); }
          60%  { transform: scale(1.04) translateY(-4px); }
          100% { opacity: 1; transform: scale(1) translateY(0); }
        }
        @keyframes checkPop {
          0%   { transform: scale(0); opacity: 0; }
          70%  { transform: scale(1.2); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes drainBar {
          0%   { width: 100%; }
          100% { width: 0%; }
        }
      `}</style>

      {/* Overlay */}
      <div
        onClick={onDismiss}
        style={{
          position: 'fixed', inset: 0, zIndex: 500,
          background: 'rgba(0,0,0,0.55)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 24,
        }}
      >
        {/* Card */}
        <div
          onClick={e => e.stopPropagation()}
          style={{
            position: 'relative', overflow: 'hidden',
            background: 'var(--bg-page)', border: '1px solid var(--border)',
            borderRadius: 20, padding: '32px 24px 24px',
            width: '100%', maxWidth: 320, textAlign: 'center',
            boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
            animation: 'popIn 0.4s cubic-bezier(0.34,1.56,0.64,1) forwards',
          }}
        >
          {/* Confetti particles — clipped inside card */}
          {particles.map(p => (
            <div key={p.id} style={{
              position: 'absolute',
              left: p.left, top: 0,
              width: p.w, height: p.h,
              background: p.color,
              borderRadius: 2,
              animation: `cfFall ${p.dur} ${p.delay} ease-out forwards`,
              transform: `rotate(${p.startRot}deg)`,
              pointerEvents: 'none',
            }} />
          ))}

          {/* Dismiss button */}
          <button
            onClick={onDismiss}
            style={{
              position: 'absolute', top: 12, right: 12,
              background: 'var(--bg-card)', border: '1px solid var(--border)',
              borderRadius: 6, color: 'var(--text-muted)',
              cursor: 'pointer', padding: 4, display: 'flex', alignItems: 'center',
            }}
          >
            <X size={14} />
          </button>

          {/* Check icon */}
          <div style={{
            width: 64, height: 64, borderRadius: '50%',
            background: 'rgba(52,211,153,0.12)', border: '2px solid rgba(52,211,153,0.4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 16px',
            animation: 'checkPop 0.4s 0.15s cubic-bezier(0.34,1.56,0.64,1) both',
          }}>
            <Check size={28} color="#34d399" strokeWidth={3} />
          </div>

          {/* Heading */}
          <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 6 }}>
            Song Queued! 🎶
          </div>

          {/* Play type badge */}
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            background: isQuick ? 'rgba(255,107,53,0.12)' : 'rgba(255,255,255,0.06)',
            border: `1px solid ${isQuick ? 'rgba(255,107,53,0.35)' : 'var(--border)'}`,
            borderRadius: 999, padding: '4px 12px', marginBottom: 14,
            fontSize: 12, fontWeight: 700,
            color: isQuick ? '#FF6B35' : 'var(--text-secondary)',
          }}>
            {isQuick ? '⚡ Quick Play' : '▶ Normal Play'}
          </div>

          {/* Song title */}
          <div style={{
            fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)',
            padding: '10px 14px',
            background: 'var(--bg-card)', border: '1px solid var(--border)',
            borderRadius: 10,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {popup.title}
          </div>

          {/* Credits spent */}
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 10 }}>
            {popup.credits} credit{popup.credits !== 1 ? 's' : ''} spent
          </div>

          {/* Auto-dismiss progress bar */}
          <div style={{ height: 3, background: 'var(--border)', borderRadius: 2, marginTop: 18, overflow: 'hidden' }}>
            <div style={{
              height: '100%', background: '#FF6B35', borderRadius: 2,
              animation: 'drainBar 3.5s linear forwards',
            }} />
          </div>
        </div>
      </div>
    </>
  );
}

export default function GuestRoom() {
  const { roomCode } = useParams();
  const { profile, token, refreshProfile, signOut, loading: authLoading } = useAuth();
  const { t, lang, setLang } = useLang();
  const { dark, toggle } = useTheme();
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
  const [songPopup, setSongPopup] = useState(null); // { title, playType, credits }
  const [pausedWarn, setPausedWarn] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsName, setSettingsName] = useState(profile?.display_name ?? '');
  const [nameSaved, setNameSaved] = useState(false);
  const prevCreditsRef = useRef(null);

  // Only redirect once auth has settled — avoids false redirect while
  // getSession() is still resolving (token starts null on every mount).
  useEffect(() => {
    if (!authLoading && !token) navigate(`/join/${roomCode}`, { replace: true });
  }, [authLoading, token]); // eslint-disable-line

  // Venue, queue, and banned-songs are all public endpoints — no token needed.
  // Fetch immediately so now-playing appears as soon as the network responds,
  // not after auth resolves.
  useEffect(() => { loadVenue(); }, [roomCode]); // eslint-disable-line

  useEffect(() => {
    const bal = profile?.credits_balance ?? 0;
    setCredits(bal);
    prevCreditsRef.current = bal;
  }, [profile?.id]);

  // Load persistent history once venue + profile are known
  useEffect(() => {
    if (!venue?.id) return;
    const saved = loadStoredHistory(venue.id, profile?.id);
    if (saved.length) setSessionHistory(saved);
  }, [venue?.id, profile?.id]); // eslint-disable-line

  // Keep settingsName in sync if profile loads
  useEffect(() => {
    if (profile?.display_name) setSettingsName(profile.display_name);
  }, [profile?.display_name]);

  // Real-time: watch for credit gifts
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
          showToast(`You've been gifted ${diff} credit${diff !== 1 ? 's' : ''}! Balance: ${newBal}.`, 5000);
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

  // getByCode (REST → DB) is the single authoritative source of venue state.
  async function refreshVenue() {
    try {
      const v = await api.venues.getByCode(roomCode);
      setVenue(v);
    } catch {}
  }

  async function loadBanned(venueId) {
    const id = venueId ?? venue?.id;
    if (!id) return;
    const b = await api.venues.banned.list(id).catch(() => []);
    setBanned(b);
  }

  // Real-time + 5s polling fallback
  useEffect(() => {
    if (!venue) return;
    const qSub = supabase
      .channel(`guest-queue-${venue.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'queue_items' },
        (payload) => {
          const vid = payload.new?.venue_id ?? payload.old?.venue_id;
          if (!vid || vid === venue.id) loadQueue(venue.id);
        })
      .subscribe();
    const vSub = supabase
      .channel(`guest-venue-${venue.id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'venues' },
        (payload) => {
          // Don't trust payload.new — a partial host update (e.g. vibe_now_playing)
          // can carry a stale jukebox_paused and clobber the banner. Re-fetch instead.
          if (payload.new?.id === venue.id) refreshVenue();
        })
      .subscribe();
    const poll = setInterval(() => { loadQueue(venue.id); refreshVenue(); }, 3000);
    return () => { supabase.removeChannel(qSub); supabase.removeChannel(vSub); clearInterval(poll); };
  }, [venue?.id]); // eslint-disable-line

  // Presence
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
    if (venue.jukebox_paused && !venue.queue_open_when_paused) {
      setPausedWarn(true); setSelected(null); return;
    }
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

      // Persist history
      const entry = { ...selected, playType, credits: result.credits_charged, timestamp: Date.now() };
      setSessionHistory(prev => {
        const updated = [entry, ...prev];
        saveStoredHistory(venue.id, profile?.id, updated);
        return updated;
      });

      // Show confetti popup instead of toast
      setSongPopup({ title: decode(selected.title), playType, credits: result.credits_charged });
      setSelected(null);
      loadQueue(venue.id);
    } catch (err) {
      const msg = err.data?.error;
      if (msg === 'insufficient_credits') showToast(t.insufficientCredits);
      else if (msg === 'song_banned') showToast(t.songBanned);
      else if (msg === 'user_banned') showToast('You have been banned from this jukebox');
      else if (msg === 'jukebox_paused') setPausedWarn(true);
      else showToast(t.error);
    }
  }

  async function handleSaveName(e) {
    e.preventDefault();
    try {
      await api.users.updateProfile({ display_name: settingsName, language: lang }, token);
      await refreshProfile();
      setNameSaved(true);
      setTimeout(() => setNameSaved(false), 2000);
    } catch {}
  }

  function showToast(msg, duration = 3000) {
    setToast(msg);
    setTimeout(() => setToast(''), duration);
  }

  // Stale-playing guard: ignore items stuck > 15 min
  const nowPlayingItem = queue.find(i => {
    if (i.status !== 'playing') return false;
    if (i.updated_at) {
      const age = Date.now() - new Date(i.updated_at).getTime();
      if (age > 15 * 60 * 1000) return false;
    }
    return true;
  });
  const nowPlaying = nowPlayingItem ? { type: 'requested', item: nowPlayingItem } : null;
  const vibeActive = !nowPlayingItem && venue?.vibe_mode_enabled && queue.filter(i => i.status === 'pending').length === 0;
  const bannedIds = new Set(banned.map(b => b.youtube_video_id));

  if (!venue) return <div className="center-screen"><p style={{ color: 'var(--text-secondary)' }}>{t.loading}</p></div>;

  const tabs = [
    { key: 'search',  icon: <Search size={14} />,   label: t.search ?? 'Search' },
    { key: 'queue',   icon: <ListMusic size={14} />, label: `${t.queue} (${queue.filter(i => i.status === 'pending').length})` },
    { key: 'history', icon: <Clock size={14} />,     label: t.historyTab },
  ];

  return (
    <div style={{ maxWidth: 520, margin: '0 auto', padding: '0 0 80px', minHeight: '100vh', background: 'var(--bg-app)' }}>

      {/* ── Sticky header ── */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 50,
        background: 'var(--bg-page)', borderBottom: '1px solid var(--border)',
        height: 52, padding: '0 12px 0 16px', display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 7 }}>
          <Logo size={20} />
          <span style={{ fontWeight: 800, fontSize: 16, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--text-primary)' }}>
            {venue.name}
          </span>
          {vibeActive && (
            <span style={{ fontSize: 11, color: '#FF6B35', fontWeight: 600 }}>
              {t.vibeMode}
            </span>
          )}
        </div>
        <CreditBalance balance={credits} />
        <button
          onClick={() => setShowSettings(true)}
          style={{
            width: 36, height: 36, borderRadius: 8, border: '1px solid var(--border)',
            background: 'var(--bg-card)', color: 'var(--text-secondary)',
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0, transition: 'border-color 0.15s, color 0.15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = '#FF6B35'; e.currentTarget.style.color = '#FF6B35'; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
        >
          <Settings size={16} />
        </button>
      </div>

      {/* ── Status area ── */}
      <div style={{ padding: '12px 16px 0' }}>
        {venue.jukebox_paused ? (
          venue.queue_open_when_paused ? (
            <div style={{ background: 'rgba(52,211,153,0.07)', border: '1px solid rgba(52,211,153,0.25)', borderRadius: 10, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 14 }}>
              <Pause size={24} color="#34d399" style={{ flexShrink: 0 }} />
              <div>
                <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary)', marginBottom: 2 }}>{t.jukeboxOff}</div>
                <div style={{ fontSize: 12, color: '#6ee7b7' }}>{t.queuingModeMsg}</div>
              </div>
            </div>
          ) : (
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 14 }}>
              <Pause size={24} color="var(--text-muted)" style={{ flexShrink: 0 }} />
              <div>
                <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary)', marginBottom: 2 }}>{t.jukeboxOff}</div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{t.jukeboxOffMsg}</div>
              </div>
            </div>
          )
        ) : (
          <NowPlaying nowPlaying={nowPlaying} vibeActive={vibeActive} vibeTitle={venue.vibe_now_playing_title} vibeChannel={venue.vibe_now_playing_channel} />
        )}
      </div>

      {/* ── Tabs & content — always shown so guests can browse ── */}
      <>
          <div style={{ display: 'flex', gap: 4, padding: '10px 16px', borderBottom: '1px solid var(--border)' }}>
            {tabs.map(({ key, icon, label }) => (
              <button key={key} onClick={() => setTab(key)} style={{
                flex: 1, minHeight: 44, padding: '6px 10px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 12,
                background: tab === key ? '#FF6B35' : 'transparent',
                color: tab === key ? 'var(--bg-app)' : 'var(--text-secondary)',
                fontWeight: tab === key ? 700 : 500, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, fontFamily: 'inherit',
              }}>
                {icon} {label}
              </button>
            ))}
          </div>

          <div style={{ padding: '16px' }}>
            {tab === 'search' && <SongSearch bannedIds={bannedIds} onSelect={handleSelect} vibeDescription={venue.vibe_description ?? ''} />}
            {tab === 'queue' && <QueueDisplay items={queue} isHost={false} />}
            {tab === 'history' && (
              <div>
                {sessionHistory.length > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
                    <button
                      onClick={() => { setSessionHistory([]); if (venue?.id) saveStoredHistory(venue.id, profile?.id, []); }}
                      style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 7, color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit', padding: '5px 12px' }}
                    >
                      {t.clearHistory}
                    </button>
                  </div>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {!sessionHistory.length && (
                    <p style={{ color: 'var(--text-secondary)', textAlign: 'center', marginTop: 24 }}>{t.noHistory}</p>
                  )}
                  {sessionHistory.map((s, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 14px' }}>
                      {s.thumbnail && <img src={s.thumbnail} alt="" style={{ width: 48, height: 36, objectFit: 'cover', borderRadius: 4, flexShrink: 0 }} />}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{decode(s.title)}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                          {s.playType === 'quick' ? '⚡ Quick' : '▶ Normal'} · {s.credits} {t.credits}
                          {s.timestamp && <span style={{ marginLeft: 6, opacity: 0.7 }}>· {formatHistoryDate(s.timestamp)}</span>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
      </>

      {/* ── Song confirmation modal ── */}
      {selected && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 200, padding: '0 0 16px' }}>
          <div style={{ background: 'var(--bg-page)', border: '1px solid var(--border)', borderRadius: '14px 14px 10px 10px', padding: 24, width: '100%', maxWidth: 520 }}>
            <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
              {selected.thumbnail && <img src={selected.thumbnail} alt="" style={{ width: 72, height: 54, objectFit: 'cover', borderRadius: 8 }} />}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--text-primary)' }}>{decode(selected.title)}</div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{decode(selected.channel)}</div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
              <button
                style={{ flex: 1, minHeight: 56, padding: 14, borderRadius: 7, border: 'none', cursor: 'pointer', background: credits >= 2 ? 'var(--btn-normal)' : 'var(--bg-card)', color: credits >= 2 ? 'var(--text-primary)' : 'var(--text-muted)', fontWeight: 700, fontSize: 14, fontFamily: 'inherit', opacity: credits < 2 ? 0.5 : 1 }}
                onClick={() => handleConfirm('normal')} disabled={credits < 2}>
                {t.normalPlay}<br /><span style={{ fontSize: 12, fontWeight: 400, color: 'var(--text-secondary)' }}>2 {t.credits}</span>
              </button>
              <button
                style={{ flex: 1, minHeight: 56, padding: 14, borderRadius: 7, border: 'none', cursor: 'pointer', background: credits >= quickPrice ? '#FF6B35' : 'var(--bg-card)', color: 'var(--text-primary)', fontWeight: 700, fontSize: 14, fontFamily: 'inherit', opacity: credits < quickPrice ? 0.5 : 1, boxShadow: credits >= quickPrice ? '0 0 16px rgba(255,107,53,0.45)' : 'none' }}
                onClick={() => handleConfirm('quick')} disabled={credits < quickPrice}>
                {t.quickPlay}<br /><span style={{ fontSize: 12, fontWeight: 400 }}>{quickPrice} {t.credits}</span>
              </button>
            </div>
            <button className="btn-secondary" style={{ width: '100%' }} onClick={() => setSelected(null)}>{t.cancel}</button>
          </div>
        </div>
      )}

      {/* ── Confetti popup (song queued) ── */}
      <SongAddedPopup popup={songPopup} onDismiss={() => setSongPopup(null)} />

      {/* ── Jukebox paused warning popup ── */}
      {pausedWarn && (
        <PausedWarnPopup onDismiss={() => setPausedWarn(false)} t={t} />
      )}

      {/* ── Settings sheet ── */}
      {showSettings && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 300 }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowSettings(false); }}
        >
          <div style={{ background: 'var(--bg-page)', border: '1px solid var(--border)', borderRadius: '16px 16px 0 0', padding: '20px 20px 32px', width: '100%', maxWidth: 520, maxHeight: '85vh', overflowY: 'auto' }}>
            <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--border)', margin: '0 auto 20px' }} />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 22 }}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: 'var(--text-primary)' }}>{t.settingsTitle}</h2>
              <button onClick={() => setShowSettings(false)} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', padding: 4 }}>
                <X size={20} />
              </button>
            </div>

            {/* Dark / Light */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', marginBottom: 16, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {dark ? <Moon size={16} color="var(--credits)" /> : <Sun size={16} color="#FF6B35" />}
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)', marginBottom: 1 }}>{dark ? t.darkMode : t.lightMode}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{dark ? t.switchToLight : t.switchToDark}</div>
                </div>
              </div>
              <button onClick={toggle} style={{ flexShrink: 0, width: 48, height: 28, borderRadius: 999, border: 'none', cursor: 'pointer', background: dark ? '#FF6B35' : 'var(--border)', position: 'relative', padding: 0 }}>
                <span style={{ position: 'absolute', top: 4, left: dark ? 24 : 4, width: 20, height: 20, borderRadius: '50%', background: 'var(--text-primary)', transition: 'left 0.2s', display: 'block' }} />
              </button>
            </div>

            {/* Language */}
            <div style={{ marginBottom: 18 }}>
              <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 8 }}>{t.language}</label>
              <div style={{ display: 'flex', gap: 8 }}>
                {[{ code: 'en', label: t.english }, { code: 'hi', label: t.hindi }, { code: 'zh', label: t.mandarin }].map(({ code, label }) => (
                  <button key={code} onClick={() => setLang(code)} style={{
                    flex: 1, padding: '10px 4px', borderRadius: 7, border: 'none', cursor: 'pointer',
                    fontWeight: 600, fontSize: 14, fontFamily: 'inherit',
                    background: lang === code ? '#FF6B35' : 'var(--bg-card)',
                    color: 'var(--text-primary)', opacity: lang === code ? 1 : 0.6,
                  }}>
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Display name */}
            {profile && (
              <form onSubmit={handleSaveName} style={{ marginBottom: 18 }}>
                <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>{t.displayName}</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input className="input" value={settingsName} onChange={e => setSettingsName(e.target.value)} style={{ flex: 1 }} />
                  <button type="submit" className="btn-primary" style={{ padding: '0 18px', height: 44, whiteSpace: 'nowrap' }}>
                    {nameSaved ? t.saved : t.save}
                  </button>
                </div>
              </form>
            )}

            {profile && <div style={{ height: 1, background: 'var(--border)', margin: '4px 0 16px' }} />}

            {/* Logout */}
            {profile && (
              <button
                onClick={() => { signOut(); setShowSettings(false); }}
                style={{ width: '100%', padding: '12px', borderRadius: 8, border: '1px solid var(--border)', background: 'none', color: '#C0392B', cursor: 'pointer', fontWeight: 700, fontSize: 14, fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
                onMouseEnter={e => e.currentTarget.style.borderColor = '#C0392B'}
                onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
              >
                <LogOut size={16} /> {t.logout}
              </button>
            )}
            <VersionFooter />
          </div>
        </div>
      )}

      {/* ── Error / info toasts (NOT for song-added — that uses confetti popup) ── */}
      {toast && (
        <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', background: 'var(--bg-card)', border: '1px solid #FF6B35', borderRadius: 999, padding: '10px 20px', fontSize: 14, fontWeight: 600, zIndex: 400, boxShadow: '0 8px 24px rgba(0,0,0,0.5)', color: 'var(--text-primary)', whiteSpace: 'nowrap', maxWidth: 'calc(100vw - 32px)' }}>
          {toast}
        </div>
      )}

      <VersionFooter />
    </div>
  );
}
