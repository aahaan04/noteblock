import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Mail, User, ArrowRight, Music, CheckCircle, Loader } from 'lucide-react';
import Logo from '../components/Logo.jsx';
import VersionFooter from '../components/VersionFooter.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useLang } from '../context/LangContext.jsx';
import { supabase } from '../lib/supabase.js';
import { api } from '../lib/api.js';

export default function GuestJoin() {
  const { roomCode } = useParams();
  const { profile, token, loading, sendMagicLink, refreshProfile } = useAuth();
  const { t } = useLang();
  const navigate = useNavigate();

  const [venue, setVenue] = useState(null);
  const [venueError, setVenueError] = useState('');

  // 'detecting' → waiting for auth/venue to resolve (shown on magic-link redirect)
  // 'email'     → not logged in, enter email
  // 'sent'      → magic link sent, waiting
  // 'name'      → new user, pick display name
  const [phase, setPhase] = useState('detecting');
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const joinedRef = useRef(false); // prevent double-join

  // Load venue
  useEffect(() => {
    api.venues.getByCode(roomCode)
      .then(v => {
        if (v.status === 'closed') setVenueError('This room is currently closed.');
        else setVenue(v);
      })
      .catch(() => setVenueError('Room not found.'));
  }, [roomCode]);

  // Once auth resolves AND venue is loaded, decide what to do
  useEffect(() => {
    if (loading || !venue) return; // still waiting

    if (!token) {
      // Not logged in — show email form
      setPhase('email');
      return;
    }

    // Already logged in (returning user OR just clicked magic link)
    if (joinedRef.current) return;

    const emailPrefix = profile?.email?.split('@')[0] ?? '';
    const needsName =
      !profile?.display_name ||
      profile.display_name === emailPrefix ||
      profile.display_name === 'User';

    if (needsName) {
      setDisplayName('');
      setPhase('name');
    } else {
      joinRoom();
    }
  }, [loading, token, venue, profile?.id]); // eslint-disable-line

  async function joinRoom() {
    if (joinedRef.current) return;
    joinedRef.current = true;
    await api.users.welcome(venue.id, token).catch(() => {});
    await refreshProfile();
    navigate(`/room/${roomCode}`, { replace: true });
  }

  async function handleSendLink(e) {
    e?.preventDefault();
    setError('');
    const addr = email.trim().toLowerCase();
    if (!addr || !addr.includes('@')) { setError('Enter a valid email address.'); return; }
    setBusy(true);
    try {
      const redirectTo = `${window.location.origin}/join/${roomCode}`;
      await sendMagicLink(addr, redirectTo);
      setPhase('sent');
    } catch (err) {
      setError(err.message ?? 'Could not send link. Try again.');
    } finally { setBusy(false); }
  }

  async function handleSetName(e) {
    e?.preventDefault();
    setError('');
    const name = displayName.trim();
    if (!name) { setError('Enter a display name.'); return; }
    setBusy(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const tok = session?.access_token ?? token;
      await api.users.updateProfile({ display_name: name }, tok);
      await refreshProfile();
      await joinRoom();
    } catch (err) {
      setError(err.message ?? 'Could not save name. Try again.');
      setBusy(false);
    }
  }

  const outerStyle = {
    minHeight: '100svh', display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center', padding: '24px 16px',
    background: 'radial-gradient(ellipse at center, rgba(255,107,53,0.06) 0%, transparent 70%), var(--bg-app)',
  };

  // ── Error state ───────────────────────────────────────────────────────────────
  if (venueError) return (
    <div style={outerStyle}>
      <Music size={48} color="var(--border)" style={{ marginBottom: 16 }} />
      <p style={{ color: '#f87171' }}>{venueError}</p>
      <button className="btn-secondary" onClick={() => navigate('/')}>
        <ArrowRight size={14} style={{ transform: 'rotate(180deg)' }} /> Home
      </button>
      <VersionFooter />
    </div>
  );

  // ── Detecting / loading ───────────────────────────────────────────────────────
  if (phase === 'detecting' || (!venue && !venueError)) return (
    <div style={outerStyle}>
      <Loader size={32} color="#FF6B35" style={{ marginBottom: 16, animation: 'spin 1s linear infinite' }} />
      <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
        {t.loading}
      </p>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      <VersionFooter />
    </div>
  );

  return (
    <div style={outerStyle}>
      <div style={{ width: '100%', maxWidth: 360 }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 8 }}>
            <Logo size={64} />
          </div>
          <h1 style={{ margin: '0 0 4px', fontSize: 28, fontWeight: 900, color: 'var(--text-primary)' }}>{venue.name}</h1>
          <p style={{ color: 'var(--text-secondary)', margin: 0, fontSize: 13 }}>Request songs for this venue</p>
        </div>

        {/* ── Phase: email ── */}
        {phase === 'email' && (
          <form onSubmit={handleSendLink} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <input
              className="input"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              autoFocus
              style={{ fontSize: 16, height: 48, paddingLeft: 16, paddingRight: 16 }}
            />
            {error && <p style={{ margin: 0, color: '#f87171', fontSize: 13 }}>{error}</p>}
            <button className="btn-primary" type="submit" disabled={busy}
              style={{ width: '100%', height: 52, fontSize: 16, boxShadow: '0 0 20px rgba(255,107,53,0.4)' }}>
              {busy ? 'Sending...' : <><Mail size={16} /> Send Magic Link</>}
            </button>
            {venue.welcome_credits > 0 && (
              <p style={{ textAlign: 'center', fontSize: 13, color: 'var(--text-secondary)', margin: 0 }}>
                Get {venue.welcome_credits} <strong style={{ color: 'var(--credits)' }}>free credits</strong> on first visit
              </p>
            )}
          </form>
        )}

        {/* ── Phase: sent ── */}
        {phase === 'sent' && (
          <div style={{ textAlign: 'center' }}>
            <CheckCircle size={56} color="#34d399" style={{ marginBottom: 16 }} />
            <h2 style={{ margin: '0 0 8px', color: 'var(--text-primary)', fontSize: 20 }}>Check your email</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: 14, margin: '0 0 16px' }}>
              We sent a magic link to<br />
              <strong style={{ color: 'var(--text-primary)' }}>{email}</strong>
            </p>
            <p style={{ color: 'var(--text-muted)', fontSize: 12, margin: '0 0 20px' }}>
              Click the link to be taken straight into the room.
            </p>
            <button
              style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 13 }}
              onClick={() => { setPhase('email'); setError(''); }}
            >
              Use a different email
            </button>
          </div>
        )}

        {/* ── Phase: name ── */}
        {phase === 'name' && (
          <form onSubmit={handleSetName} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
                <User size={12} /> Your display name
              </label>
              <p style={{ margin: '0 0 10px', fontSize: 13, color: 'var(--text-secondary)' }}>
                This is how you appear when requesting songs.
              </p>
              <input
                className="input"
                type="text"
                placeholder="e.g. Alex"
                maxLength={32}
                value={displayName}
                onChange={e => setDisplayName(e.target.value)}
                autoFocus
                style={{ fontSize: 17, height: 48 }}
              />
            </div>
            {error && <p style={{ margin: 0, color: '#f87171', fontSize: 13 }}>{error}</p>}
            <button className="btn-primary" type="submit" disabled={busy}
              style={{ width: '100%', height: 52, fontSize: 16, boxShadow: '0 0 20px rgba(255,107,53,0.4)' }}>
              {busy ? 'Entering room...' : <>Enter Room <ArrowRight size={16} /></>}
            </button>
          </form>
        )}
      </div>
      <VersionFooter />
    </div>
  );
}
