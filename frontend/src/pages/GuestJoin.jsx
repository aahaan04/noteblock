import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Mail, User, ArrowRight, Music, CheckCircle } from 'lucide-react';
import Logo from '../components/Logo.jsx';
import VersionFooter from '../components/VersionFooter.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { supabase } from '../lib/supabase.js';
import { api } from '../lib/api.js';

export default function GuestJoin() {
  const { roomCode } = useParams();
  const { profile, token, loading, sendMagicLink, refreshProfile } = useAuth();
  const navigate = useNavigate();

  const [venue, setVenue] = useState(null);
  const [venueError, setVenueError] = useState('');

  // 'email' → user enters email
  // 'sent'  → magic link sent, waiting for click
  // 'name'  → new user, pick display name
  const [phase, setPhase] = useState('email');
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Load venue
  useEffect(() => {
    api.venues.getByCode(roomCode)
      .then(v => { if (v.status === 'closed') setVenueError('This room is currently closed.'); else setVenue(v); })
      .catch(() => setVenueError('Room not found.'));
  }, [roomCode]);

  // After magic link click: session is established → decide what to do
  useEffect(() => {
    if (loading || !token || !venue) return;
    if (phase === 'name') return; // already handling name entry

    // If display_name was auto-generated from email prefix, ask for a real name
    const emailPrefix = profile?.email?.split('@')[0] ?? '';
    const needsName = !profile?.display_name || profile.display_name === emailPrefix;

    if (needsName) {
      setDisplayName('');
      setPhase('name');
    } else {
      joinRoom();
    }
  }, [loading, token, venue, profile?.id]); // eslint-disable-line

  async function joinRoom() {
    if (!venue || !token) return;
    await api.users.welcome(venue.id, token).catch(() => {});
    await refreshProfile();
    navigate(`/room/${roomCode}`);
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
      setError(err.message ?? 'Could not save name.');
    } finally { setBusy(false); }
  }

  // ── Error / loading states ────────────────────────────────────────────────────
  if (venueError) return (
    <div className="center-screen">
      <Music size={48} color="#2A1F17" style={{ marginBottom: 16 }} />
      <p style={{ color: '#f87171' }}>{venueError}</p>
      <button className="btn-secondary" onClick={() => navigate('/')}>← Home</button>
      <VersionFooter />
    </div>
  );

  if (!venue) return (
    <div className="center-screen">
      <p style={{ color: '#8B6F52' }}>Loading…</p>
      <VersionFooter />
    </div>
  );

  return (
    <div className="center-screen">
      <div style={{ width: '100%', maxWidth: 340 }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}>
            <Logo size={44} />
          </div>
          <p style={{ color: '#8B6F52', margin: '0 0 4px', fontSize: 13 }}>Joining</p>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 900, color: '#F0E6D3' }}>{venue.name}</h1>
        </div>

        {/* ── Phase: email ── */}
        {phase === 'email' && (
          <form onSubmit={handleSendLink} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600, color: '#8B6F52', marginBottom: 6 }}>
                <Mail size={12} /> Your email
              </label>
              <input
                className="input"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                autoFocus
                style={{ fontSize: 16 }}
              />
              <p style={{ margin: '6px 0 0', fontSize: 11, color: '#5A4535' }}>
                We'll send a magic link — no password needed
              </p>
            </div>
            {error && <p style={{ margin: 0, color: '#f87171', fontSize: 13 }}>{error}</p>}
            <button className="btn-primary" type="submit" disabled={busy} style={{ padding: 14, fontSize: 15 }}>
              {busy ? 'Sending…' : <><Mail size={16} /> Send Magic Link</>}
            </button>
            {venue.welcome_credits > 0 && (
              <p style={{ textAlign: 'center', fontSize: 12, color: '#8B6F52', margin: 0 }}>
                Get <strong style={{ color: '#FF6B35' }}>{venue.welcome_credits} free credits</strong> on your first visit
              </p>
            )}
          </form>
        )}

        {/* ── Phase: sent ── */}
        {phase === 'sent' && (
          <div style={{ textAlign: 'center' }}>
            <CheckCircle size={52} color="#34d399" style={{ marginBottom: 16 }} />
            <h2 style={{ margin: '0 0 8px', color: '#F0E6D3', fontSize: 20 }}>Check your email</h2>
            <p style={{ color: '#8B6F52', fontSize: 14, margin: '0 0 24px' }}>
              We sent a magic link to<br />
              <strong style={{ color: '#F0E6D3' }}>{email}</strong>
            </p>
            <p style={{ color: '#5A4535', fontSize: 12, margin: '0 0 20px' }}>
              Click the link in the email to join the room. You can close this tab.
            </p>
            <button
              style={{ background: 'none', border: 'none', color: '#8B6F52', cursor: 'pointer', fontSize: 13 }}
              onClick={() => { setPhase('email'); setError(''); }}
            >
              ← Use a different email
            </button>
          </div>
        )}

        {/* ── Phase: name ── */}
        {phase === 'name' && (
          <form onSubmit={handleSetName} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600, color: '#8B6F52', marginBottom: 6 }}>
                <User size={12} /> Your display name
              </label>
              <p style={{ margin: '0 0 10px', fontSize: 13, color: '#8B6F52' }}>
                This is how you'll appear when requesting songs.
              </p>
              <input
                className="input"
                type="text"
                placeholder="e.g. Alex"
                maxLength={32}
                value={displayName}
                onChange={e => setDisplayName(e.target.value)}
                autoFocus
                style={{ fontSize: 17 }}
              />
            </div>
            {error && <p style={{ margin: 0, color: '#f87171', fontSize: 13 }}>{error}</p>}
            <button className="btn-primary" type="submit" disabled={busy} style={{ padding: 14, fontSize: 15 }}>
              {busy ? 'Entering room…' : <>Enter Room <ArrowRight size={16} /></>}
            </button>
          </form>
        )}
      </div>
      <VersionFooter />
    </div>
  );
}
