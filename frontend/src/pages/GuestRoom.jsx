import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Search, ListMusic, Clock, Music, Pause, Settings, X, Sun, Moon, LogOut } from 'lucide-react';
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
  const now = new Date();
  const diffDays = Math.floor((now - d) / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function GuestRoom() {
  const { roomCode } = useParams();
  const { profile, token, refreshProfile, signOut } = useAuth();
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
  const [showSettings, setShowSettings] = useState(false);
  const [settingsName, setSettingsName] = useState(profile?.display_name ?? '');
  const [nameSaved, setNameSaved] = useState(false);
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
          showToast(`You have been gifted ${diff} credit${diff !== 1 ? 's' : ''}! You now have ${newBal}.`, 5000);
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

  // Real-time + polling fallback
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
        (payload) => { if (payload.new?.id === venue.id) setVenue(payload.new); })
      .subscribe();

    // Polling fallback every 5s — guarantees fresh now-playing + paused state
    const poll = setInterval(() => {
      loadQueue(venue.id);
      refreshVenue();
    }, 5000);

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
    if (venue.jukebox_paused && !venue.queue_open_when_paused) {
      showToast('Jukebox is paused — try again soon'); setSelected(null); return;
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
      const entry = { ...selected, playType, credits: result.credits_charged, timestamp: Date.now() };
      setSessionHistory(prev => {
        const updated = [entry, ...prev];
        saveStoredHistory(venue.id, profile?.id, updated);
        return updated;
      });
      const playLabel = playType === 'quick' ? '⚡ Quick Play' : '▶ Normal Play';
      showToast(`${playLabel} — "${decode(selected.title)}" added to queue!`, 4000);
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

  // Stale-playing guard: ignore 'playing' items stuck for > 15 min
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
    { key: 'search',  icon: <Search size={14} />,   label: t.searchSongs.replace('…','') },
    { key: 'queue',   icon: <ListMusic size={14} />, label: `${t.queue} (${queue.filter(i => i.status === 'pending').length})` },
    { key: 'history', icon: <Clock size={14} />,     label: 'History' },
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
            <span style={{ fontSize: 11, color: '#FF6B35', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
              <Music size={11} /> {t.vibeMode}
            </span>
          )}
        </div>
        <CreditBalance balance={credits} />
        {/* Settings button */}
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
      {venue.jukebox_paused && !venue.queue_open_when_paused ? (
        <div style={{ padding: '12px 16px 0' }}>
          <div style={{
            background: 'var(--bg-card)', border: '1px solid var(--border)',
            borderRadius: 10, padding: '12px 16px',
            display: 'flex', alignItems: 'center', gap: 14,
          }}>
            <Pause size={24} color="var(--text-muted)" style={{ flexShrink: 0 }} />
            <div>
              <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary)', marginBottom: 2 }}>{t.jukeboxOff}</div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{t.jukeboxOffMsg}</div>
            </div>
          </div>
        </div>
      ) : venue.jukebox_paused && venue.queue_open_when_paused ? (
        <div style={{ padding: '12px 16px 0' }}>
          <div style={{
            background: 'rgba(52,211,153,0.07)', border: '1px solid rgba(52,211,153,0.25)',
            borderRadius: 10, padding: '12px 16px',
            display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: '#34d399',
          }}>
            <ListMusic size={16} style={{ flexShrink: 0 }} />
            <div>
              <div style={{ fontWeight: 700, marginBottom: 2 }}>{t.queuingMode}</div>
              <div style={{ fontSize: 12, color: '#6ee7b7' }}>{t.queuingModeMsg}</div>
            </div>
          </div>
        </div>
      ) : (
        <div style={{ padding: '12px 16px 0' }}>
          <NowPlaying nowPlaying={nowPlaying} vibeActive={vibeActive} />
        </div>
      )}

      {/* ── Tabs & content ── */}
      {!(venue.jukebox_paused && !venue.queue_open_when_paused) && (
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
                      onClick={() => {
                        setSessionHistory([]);
                        if (venue?.id) saveStoredHistory(venue.id, profile?.id, []);
                      }}
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
                    <div key={i} style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 14px',
                    }}>
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
      )}

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

      {/* ── Settings sheet ── */}
      {showSettings && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 300 }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowSettings(false); }}
        >
          <div style={{ background: 'var(--bg-page)', border: '1px solid var(--border)', borderRadius: '16px 16px 0 0', padding: '20px 20px 32px', width: '100%', maxWidth: 520, maxHeight: '85vh', overflowY: 'auto' }}>
            {/* Sheet handle */}
            <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--border)', margin: '0 auto 20px' }} />

            {/* Title row */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 22 }}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: 'var(--text-primary)' }}>{t.settingsTitle}</h2>
              <button onClick={() => setShowSettings(false)} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', padding: 4 }}>
                <X size={20} />
              </button>
            </div>

            {/* Dark / Light toggle */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '12px 14px', marginBottom: 16,
              background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {dark ? <Moon size={16} color="var(--credits)" /> : <Sun size={16} color="#FF6B35" />}
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)', marginBottom: 1 }}>
                    {dark ? t.darkMode : t.lightMode}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    {dark ? t.switchToLight : t.switchToDark}
                  </div>
                </div>
              </div>
              <button
                onClick={toggle}
                style={{ flexShrink: 0, width: 48, height: 28, borderRadius: 999, border: 'none', cursor: 'pointer', background: dark ? '#FF6B35' : 'var(--border)', position: 'relative', padding: 0 }}
              >
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
                    color: 'var(--text-primary)',
                    opacity: lang === code ? 1 : 0.6,
                    transition: 'opacity 0.15s',
                  }}>
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Display name (logged-in only) */}
            {profile && (
              <form onSubmit={handleSaveName} style={{ marginBottom: 18 }}>
                <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>{t.displayName}</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    className="input"
                    value={settingsName}
                    onChange={e => setSettingsName(e.target.value)}
                    style={{ flex: 1 }}
                  />
                  <button type="submit" className="btn-primary" style={{ padding: '0 18px', height: 44, whiteSpace: 'nowrap' }}>
                    {nameSaved ? t.saved : t.save}
                  </button>
                </div>
              </form>
            )}

            {/* Divider */}
            {profile && <div style={{ height: 1, background: 'var(--border)', margin: '4px 0 16px' }} />}

            {/* Log out */}
            {profile && (
              <button
                onClick={() => { signOut(); setShowSettings(false); }}
                style={{
                  width: '100%', padding: '12px', borderRadius: 8,
                  border: '1px solid var(--border)', background: 'none',
                  color: '#C0392B', cursor: 'pointer', fontWeight: 700, fontSize: 14,
                  fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                }}
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

      {/* ── Toast ── */}
      {toast && (
        <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', background: 'var(--bg-card)', border: '1px solid #FF6B35', borderRadius: 999, padding: '10px 20px', fontSize: 14, fontWeight: 600, zIndex: 400, boxShadow: '0 8px 24px rgba(0,0,0,0.5)', color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
          {toast}
        </div>
      )}

      <VersionFooter />
    </div>
  );
}
