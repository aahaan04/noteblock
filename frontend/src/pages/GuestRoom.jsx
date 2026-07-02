import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Search, ListMusic, Clock, Pause, Settings, X, Sun, Moon, LogOut, Check,
  ArrowLeft, Globe, User, Receipt, ChevronRight, Disc3, Coins,
} from 'lucide-react';
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
import NowPlayingHome from '../components/NowPlayingHome.jsx';
import CreditBalance from '../components/CreditBalance.jsx';
import SongThumb from '../components/SongThumb.jsx';

const decode = s => s?.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&#x27;/g, "'") ?? s;

const HISTORY_MAX = 100;
const CONFETTI_COLORS = ['#FF6B35','#FFD700','#34d399','#60a5fa','#f472b6','#a78bfa','#FF4444','#FFCC00'];
const GUEST_FONT = "'Manrope', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

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

// ── Small style helpers for the settings-row list ────────────────────────────
const settingsRowStyle = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 0', borderBottom: '1px solid var(--bg-card)' };
const settingsRowLeftStyle = { display: 'flex', alignItems: 'center', gap: 12 };
const settingsIconStyle = { width: 34, height: 34, background: 'var(--border)', borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--credits)', flexShrink: 0 };
const settingsLabelStyle = { fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' };
const settingsSubStyle = { fontSize: 11, color: 'var(--text-secondary)', fontWeight: 500, marginTop: 1 };

function navItemStyle() {
  return { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, padding: '6px 4px', background: 'none', border: 'none', cursor: 'pointer', flex: 1, fontFamily: 'inherit' };
}
function navLabelStyle(active) {
  return { fontSize: 10, fontWeight: 700, color: active ? '#FF6B35' : 'var(--text-muted)', letterSpacing: 0.3 };
}
function segBtnStyle(active) {
  return {
    flex: 1, minHeight: 40, padding: '8px 10px', borderRadius: 9, cursor: 'pointer', fontSize: 12,
    background: active ? '#FF6B35' : 'var(--bg-card)',
    color: active ? '#0E0A07' : 'var(--text-secondary)',
    fontWeight: active ? 700 : 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, fontFamily: 'inherit',
    border: active ? 'none' : '1px solid var(--border)',
  };
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
  const [quickPrice, setQuickPrice] = useState(3);
  const [requestingKey, setRequestingKey] = useState(null); // `${videoId}:${playType}` in flight — guards double-tap
  const [sessionHistory, setSessionHistory] = useState([]);
  const [tab, setTab] = useState('search'); // 'search' | 'home' | 'queue'
  const [queueView, setQueueView] = useState('queue'); // 'queue' | 'history'
  const [toast, setToast] = useState('');
  const [songPopup, setSongPopup] = useState(null); // { title, playType, credits }
  const [pausedWarn, setPausedWarn] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsName, setSettingsName] = useState(profile?.display_name ?? '');
  const [nameSaved, setNameSaved] = useState(false);
  const [packages, setPackages] = useState([]);
  const [buyingPkg, setBuyingPkg] = useState(null);
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

  // Real-time + 30s polling fallback
  useEffect(() => {
    if (!venue) return;
    const qSub = supabase
      .channel(`guest-queue-${venue.id}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'queue_items',
        filter: `venue_id=eq.${venue.id}`,
      }, () => loadQueue(venue.id))
      .subscribe();
    const vSub = supabase
      .channel(`guest-venue-${venue.id}`)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'venues',
        filter: `id=eq.${venue.id}`,
      }, () => {
        // Don't trust payload.new — a partial host update (e.g. vibe_now_playing)
        // can carry a stale jukebox_paused and clobber the banner. Re-fetch instead.
        refreshVenue();
      })
      .subscribe();
    // 30-second fallback poll catches any subscription drops without hammering the API.
    const poll = setInterval(() => { loadQueue(venue.id); refreshVenue(); }, 30000);
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

  // Quick Play price is dynamic (based on pending queue length) — keep it fresh
  // so search-result buttons always show an accurate price without a select step.
  const pendingCount = queue.filter(i => i.status === 'pending').length;
  useEffect(() => {
    if (!venue?.id) return;
    api.queue.price(venue.id).then(({ price }) => setQuickPrice(price)).catch(() => {});
  }, [venue?.id, pendingCount]);

  // Fetch top-up packages only once Settings is actually opened.
  useEffect(() => {
    if (!showSettings) return;
    api.credits.packages().then(setPackages).catch(() => setPackages([]));
  }, [showSettings]);

  // Request a song directly (Quick or Normal) — no intermediate confirm step.
  const handleRequest = useCallback(async (song, playType) => {
    if (requestingKey || !venue) return;
    const isBanned = banned.some(b => b.youtube_video_id === song.videoId);
    if (isBanned) { showToast(t.songBanned); return; }
    if (venue.jukebox_paused && !venue.queue_open_when_paused) { setPausedWarn(true); return; }
    const cost = playType === 'normal' ? 2 : quickPrice;
    if (credits < cost) { showToast(t.insufficientCredits); return; }

    setRequestingKey(`${song.videoId}:${playType}`);
    const requesterName = profile?.display_name ?? 'Guest';
    try {
      const result = await api.queue.add(venue.id, {
        youtube_video_id: song.videoId, song_title: song.title,
        thumbnail_url: song.thumbnail, play_type: playType, requester_name: requesterName,
      }, token);
      const newBalance = credits - result.credits_charged;
      prevCreditsRef.current = newBalance;
      setCredits(newBalance);
      refreshProfile();

      // Persist history
      const entry = { ...song, playType, credits: result.credits_charged, timestamp: Date.now() };
      setSessionHistory(prev => {
        const updated = [entry, ...prev];
        saveStoredHistory(venue.id, profile?.id, updated);
        return updated;
      });

      // Show confetti popup instead of toast
      setSongPopup({ title: decode(song.title), playType, credits: result.credits_charged });
      loadQueue(venue.id);
    } catch (err) {
      const msg = err.data?.error;
      if (msg === 'insufficient_credits') showToast(t.insufficientCredits);
      else if (msg === 'song_banned') showToast(t.songBanned);
      else if (msg === 'user_banned') showToast('You have been banned from this jukebox');
      else if (msg === 'jukebox_paused') setPausedWarn(true);
      else if (msg === 'already_queued') showToast('You already requested this song');
      else showToast(t.error);
    } finally {
      setRequestingKey(null);
    }
  }, [banned, venue, credits, quickPrice, profile, token, t, refreshProfile, requestingKey]); // eslint-disable-line

  // Credit top-up — calls the real purchase-intent endpoint. Razorpay keys aren't
  // configured on the backend yet (it responds 503 payment_not_configured), so this
  // surfaces a friendly "coming soon" message rather than opening a checkout that
  // doesn't exist. Swap in the Razorpay checkout.js flow once keys are added server-side.
  async function handleTopUp(pkg) {
    if (buyingPkg) return;
    setBuyingPkg(pkg.id);
    try {
      await api.credits.purchaseIntent({ package_id: pkg.id }, token);
    } catch (err) {
      if (err.data?.error === 'payment_not_configured') showToast('Credit purchases are coming soon!');
      else showToast(t.error);
    } finally {
      setBuyingPkg(null);
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
  const vibeActive = !nowPlayingItem && venue?.vibe_mode_enabled && pendingCount === 0;
  const bannedIds = new Set(banned.map(b => b.youtube_video_id));
  const bestPkg = packages.length
    ? packages.reduce((best, p) => (p.credits / p.amount_paise > best.credits / best.amount_paise ? p : best), packages[0])
    : null;

  if (!venue) return <div className="center-screen"><p style={{ color: 'var(--text-secondary)' }}>{t.loading}</p></div>;

  return (
    <div style={{ maxWidth: 520, margin: '0 auto', padding: '0 0 84px', minHeight: '100vh', background: 'var(--bg-app)', fontFamily: GUEST_FONT }}>

      {/* ── Sticky header ── */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 50,
        background: 'var(--bg-card)', borderBottom: '1px solid var(--border)',
        height: 56, padding: '0 14px 0 16px', display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Logo size={26} />
          <span style={{ fontWeight: 800, fontSize: 16, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--text-primary)', letterSpacing: '-0.3px' }}>
            {venue.name}
          </span>
          {vibeActive && (
            <span style={{ fontSize: 11, color: '#FF6B35', fontWeight: 600, flexShrink: 0 }}>
              {t.vibeMode}
            </span>
          )}
        </div>
        <CreditBalance balance={credits} />
        <button
          onClick={() => setShowSettings(true)}
          style={{
            width: 34, height: 34, borderRadius: '50%', border: 'none',
            background: 'var(--border)', color: 'var(--text-secondary)',
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0, transition: 'color 0.15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.color = '#FF6B35'; }}
          onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-secondary)'; }}
        >
          <Settings size={16} />
        </button>
      </div>

      {/* ── Status area — hidden on the Home tab, which shows its own big now-playing view ── */}
      {tab !== 'home' && (
        <div style={{ padding: '14px 16px 0' }}>
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
      )}

      {/* ── Tab content ── */}
      <div style={{ padding: tab === 'home' ? '0 16px' : '16px' }}>
        {tab === 'search' && (
          <SongSearch
            bannedIds={bannedIds}
            onRequest={handleRequest}
            quickPrice={quickPrice}
            credits={credits}
            requestingKey={requestingKey}
            vibeDescription={venue.vibe_mode_enabled ? (venue.vibe_description ?? '') : ''}
          />
        )}

        {tab === 'queue' && (
          <div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
              <button onClick={() => setQueueView('queue')} style={segBtnStyle(queueView === 'queue')}>
                <ListMusic size={13} /> {t.queue} ({pendingCount})
              </button>
              <button onClick={() => setQueueView('history')} style={segBtnStyle(queueView === 'history')}>
                <Clock size={13} /> {t.historyTab}
              </button>
            </div>

            {queueView === 'queue' && <QueueDisplay items={queue} isHost={false} />}

            {queueView === 'history' && (
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
                      <SongThumb src={s.thumbnail} size={44} radius={8} />
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
        )}

        {tab === 'home' && (
          <NowPlayingHome venue={venue} nowPlaying={nowPlaying} vibeActive={vibeActive} vibeTitle={venue.vibe_now_playing_title} vibeChannel={venue.vibe_now_playing_channel} />
        )}
      </div>

      {/* ── Bottom navigation ── */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 60,
        maxWidth: 520, margin: '0 auto',
        background: 'var(--bg-card)', borderTop: '1px solid var(--border)',
        padding: '8px 0 max(8px, env(safe-area-inset-bottom))',
        display: 'flex', justifyContent: 'space-around', alignItems: 'center',
      }}>
        <button onClick={() => setTab('search')} style={navItemStyle()}>
          <Search size={20} color={tab === 'search' ? '#FF6B35' : 'var(--text-muted)'} />
          <span style={navLabelStyle(tab === 'search')}>{t.search ?? 'Search'}</span>
        </button>
        <button onClick={() => setTab('home')} style={{ ...navItemStyle(), marginTop: -18 }} title="Now Playing">
          <span style={{
            width: 52, height: 52, borderRadius: '50%', background: '#FF6B35',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 0 20px rgba(255,107,53,0.5)',
          }}>
            <Disc3 size={22} color="#0E0A07" />
          </span>
        </button>
        <button onClick={() => setTab('queue')} style={navItemStyle()}>
          <ListMusic size={20} color={tab === 'queue' ? '#FF6B35' : 'var(--text-muted)'} />
          <span style={navLabelStyle(tab === 'queue')}>{t.queue}</span>
        </button>
      </div>

      {/* ── Confetti popup (song queued) ── */}
      <SongAddedPopup popup={songPopup} onDismiss={() => setSongPopup(null)} />

      {/* ── Jukebox paused warning popup ── */}
      {pausedWarn && (
        <PausedWarnPopup onDismiss={() => setPausedWarn(false)} t={t} />
      )}

      {/* ── Settings — full-screen ── */}
      {showSettings && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'var(--bg-app)', display: 'flex', flexDirection: 'column', fontFamily: GUEST_FONT }}>
          <div style={{ padding: '18px 20px', background: 'var(--bg-card)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 14, flexShrink: 0 }}>
            <button
              onClick={() => setShowSettings(false)}
              style={{ width: 32, height: 32, borderRadius: '50%', border: 'none', background: 'var(--border)', color: 'var(--text-primary)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
            >
              <ArrowLeft size={16} />
            </button>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.3px' }}>{t.settingsTitle}</h2>
          </div>

          <div className="no-scrollbar" style={{ flex: 1, overflowY: 'auto', padding: '20px 16px 40px' }}>

            {/* Credits */}
            <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 10 }}>
              Your Credits
            </div>
            <div style={{ background: 'var(--bg-card)', border: '1px solid #FF6B35', borderRadius: 16, padding: 18, boxShadow: '0 0 20px rgba(255,107,53,0.1)', marginBottom: 20 }}>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600, marginBottom: 6 }}>Current balance</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 30, fontWeight: 800, color: '#FF6B35', letterSpacing: '-0.5px' }}>
                {credits}
                <span style={{ width: 30, height: 30, borderRadius: '50%', background: '#FF6B35', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Coins size={15} color="#0E0A07" />
                </span>
                <span style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 600 }}>{t.credits}</span>
              </div>
              {bestPkg && (
                <button
                  onClick={() => handleTopUp(bestPkg)}
                  disabled={!!buyingPkg}
                  style={{ marginTop: 14, background: '#FF6B35', color: '#0E0A07', border: 'none', borderRadius: 10, padding: 12, fontSize: 14, fontWeight: 800, width: '100%', boxShadow: '0 0 16px rgba(255,107,53,0.35)', cursor: 'pointer', fontFamily: 'inherit', opacity: buyingPkg ? 0.6 : 1 }}
                >
                  {buyingPkg === bestPkg.id ? 'Processing…' : 'Top Up Credits'}
                </button>
              )}
            </div>

            {/* Quick top-up packs */}
            {packages.length > 0 && (
              <>
                <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 10 }}>
                  Quick Top-Up
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 24 }}>
                  {packages.map(pkg => {
                    const isBest = pkg.id === bestPkg?.id;
                    return (
                      <button
                        key={pkg.id}
                        onClick={() => handleTopUp(pkg)}
                        disabled={!!buyingPkg}
                        style={{
                          background: 'var(--bg-card)', border: `1px solid ${isBest ? '#FF6B35' : 'var(--border)'}`,
                          borderRadius: 14, padding: '14px 8px', textAlign: 'center', position: 'relative',
                          cursor: 'pointer', fontFamily: 'inherit',
                          boxShadow: isBest ? '0 0 16px rgba(255,107,53,0.2)' : 'none',
                          opacity: buyingPkg && buyingPkg !== pkg.id ? 0.5 : 1,
                        }}
                      >
                        {isBest && (
                          <span style={{ position: 'absolute', top: -10, left: '50%', transform: 'translateX(-50%)', background: '#FF6B35', color: '#0E0A07', fontSize: 9, fontWeight: 800, padding: '3px 8px', borderRadius: 10, whiteSpace: 'nowrap', letterSpacing: 0.5 }}>
                            BEST VALUE
                          </span>
                        )}
                        <div style={{ fontSize: 20, fontWeight: 800, color: isBest ? '#FF6B35' : 'var(--text-primary)', letterSpacing: '-0.3px', marginBottom: 2 }}>
                          {pkg.credits}
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--text-secondary)', fontWeight: 600, marginBottom: 10 }}>{t.credits}</div>
                        <div style={{ fontSize: 12, fontWeight: 800, borderRadius: 8, padding: 6, background: isBest ? '#FF6B35' : 'var(--border)', color: isBest ? '#0E0A07' : 'var(--text-primary)' }}>
                          ₹{Math.round(pkg.amount_paise / 100)}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            {/* Preferences */}
            <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 10 }}>
              Preferences
            </div>

            {/* Dark / Light */}
            <div style={settingsRowStyle}>
              <div style={settingsRowLeftStyle}>
                <span style={settingsIconStyle}>{dark ? <Moon size={16} /> : <Sun size={16} />}</span>
                <div>
                  <div style={settingsLabelStyle}>{dark ? t.darkMode : t.lightMode}</div>
                  <div style={settingsSubStyle}>{dark ? t.switchToLight : t.switchToDark}</div>
                </div>
              </div>
              <button onClick={toggle} style={{ flexShrink: 0, width: 42, height: 24, borderRadius: 999, border: dark ? 'none' : '1px solid var(--btn-normal)', cursor: 'pointer', background: dark ? '#FF6B35' : 'var(--border)', position: 'relative', padding: 0 }}>
                <span style={{ position: 'absolute', top: 2, left: dark ? 21 : 3, width: 18, height: 18, borderRadius: '50%', background: dark ? '#0E0A07' : 'var(--text-primary)', transition: 'left 0.2s', display: 'block' }} />
              </button>
            </div>

            {/* Language */}
            <div style={{ ...settingsRowStyle, flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
              <div style={settingsRowLeftStyle}>
                <span style={settingsIconStyle}><Globe size={16} /></span>
                <div>
                  <div style={settingsLabelStyle}>{t.language}</div>
                  <div style={settingsSubStyle}>{lang === 'en' ? t.english : lang === 'hi' ? t.hindi : t.mandarin}</div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, paddingLeft: 46 }}>
                {[{ code: 'en', label: t.english }, { code: 'hi', label: t.hindi }, { code: 'zh', label: t.mandarin }].map(({ code, label }) => (
                  <button key={code} onClick={() => setLang(code)} style={{
                    flex: 1, padding: '8px 4px', borderRadius: 7, border: 'none', cursor: 'pointer',
                    fontWeight: 600, fontSize: 13, fontFamily: 'inherit',
                    background: lang === code ? '#FF6B35' : 'var(--bg-app)',
                    color: lang === code ? '#0E0A07' : 'var(--text-secondary)',
                  }}>
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Display name */}
            {profile && (
              <div style={{ ...settingsRowStyle, flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
                <div style={settingsRowLeftStyle}>
                  <span style={settingsIconStyle}><User size={16} /></span>
                  <div>
                    <div style={settingsLabelStyle}>{t.displayName}</div>
                    <div style={settingsSubStyle}>{profile.display_name}</div>
                  </div>
                </div>
                <form onSubmit={handleSaveName} style={{ display: 'flex', gap: 8, paddingLeft: 46 }}>
                  <input className="input" value={settingsName} onChange={e => setSettingsName(e.target.value)} style={{ flex: 1, fontSize: 14, padding: '9px 12px' }} />
                  <button type="submit" className="btn-primary" style={{ padding: '0 16px', height: 38, whiteSpace: 'nowrap', fontSize: 13 }}>
                    {nameSaved ? t.saved : t.save}
                  </button>
                </form>
              </div>
            )}

            {/* Purchase history — no backend endpoint exists yet since Razorpay isn't configured */}
            <button
              onClick={() => showToast('No purchases yet')}
              style={{ ...settingsRowStyle, width: '100%', cursor: 'pointer', background: 'none', border: 'none', borderBottom: '1px solid var(--bg-card)', fontFamily: 'inherit' }}
            >
              <div style={settingsRowLeftStyle}>
                <span style={settingsIconStyle}><Receipt size={16} /></span>
                <div style={{ textAlign: 'left' }}>
                  <div style={settingsLabelStyle}>Purchase History</div>
                  <div style={settingsSubStyle}>View past top-ups</div>
                </div>
              </div>
              <ChevronRight size={16} color="var(--text-muted)" />
            </button>

            {/* Logout */}
            {profile && (
              <button
                onClick={() => { signOut(); setShowSettings(false); }}
                style={{ width: '100%', marginTop: 20, padding: '13px', borderRadius: 10, border: '1px solid var(--border)', background: 'none', color: '#C0392B', cursor: 'pointer', fontWeight: 700, fontSize: 14, fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
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
        <div style={{ position: 'fixed', bottom: 90, left: '50%', transform: 'translateX(-50%)', background: 'var(--bg-card)', border: '1px solid #FF6B35', borderRadius: 999, padding: '10px 20px', fontSize: 14, fontWeight: 600, zIndex: 400, boxShadow: '0 8px 24px rgba(0,0,0,0.5)', color: 'var(--text-primary)', whiteSpace: 'nowrap', maxWidth: 'calc(100vw - 32px)', fontFamily: GUEST_FONT }}>
          {toast}
        </div>
      )}
    </div>
  );
}
