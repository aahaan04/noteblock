import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Phone, KeyRound, User, ArrowRight, Music, RotateCcw } from 'lucide-react';
import Logo from '../components/Logo.jsx';
import VersionFooter from '../components/VersionFooter.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { supabase } from '../lib/supabase.js';
import { api } from '../lib/api.js';

// phase: 'phone' | 'otp' | 'name' | 'joining'
export default function GuestJoin() {
  const { roomCode } = useParams();
  const { profile, token, sendOtp, verifyPhoneOtp, refreshProfile } = useAuth();
  const navigate = useNavigate();

  const [venue, setVenue] = useState(null);
  const [venueError, setVenueError] = useState('');
  const [phase, setPhase] = useState('phone');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [resendTimer, setResendTimer] = useState(0);

  // Load venue info
  useEffect(() => {
    api.venues.getByCode(roomCode)
      .then(v => { if (v.status === 'closed') setVenueError('This room is currently closed.'); else setVenue(v); })
      .catch(() => setVenueError('Room not found.'));
  }, [roomCode]);

  // Countdown timer for resend
  useEffect(() => {
    if (resendTimer <= 0) return;
    const id = setTimeout(() => setResendTimer(t => t - 1), 1000);
    return () => clearTimeout(id);
  }, [resendTimer]);

  // If already logged in, skip straight to joining
  useEffect(() => {
    if (!token || !venue) return;
    joinRoom();
  }, [token, venue]);

  async function joinRoom() {
    if (!venue) return;
    // Grant welcome credits on first visit (RPC is idempotent)
    await api.users.welcome(venue.id, token).catch(() => {});
    await refreshProfile();
    navigate(`/room/${roomCode}`);
  }

  async function handleSendOtp(e) {
    e?.preventDefault();
    setError('');
    const cleaned = phone.trim();
    if (!cleaned) { setError('Enter your phone number.'); return; }
    setBusy(true);
    try {
      await sendOtp(cleaned);
      setPhase('otp');
      setResendTimer(30);
    } catch (err) {
      setError(err.message ?? 'Could not send code. Check the number and try again.');
    } finally { setBusy(false); }
  }

  async function handleVerifyOtp(e) {
    e?.preventDefault();
    setError('');
    if (otp.length < 6) { setError('Enter the 6-digit code.'); return; }
    setBusy(true);
    try {
      await verifyPhoneOtp(phone.trim(), otp.trim());
      // AuthContext will load/create profile. Wait briefly for it.
      // If display_name is just the phone number stub, ask for a name.
      setPhase('name');
    } catch (err) {
      setError(err.message ?? 'Invalid code. Try again.');
    } finally { setBusy(false); }
  }

  async function handleSetName(e) {
    e?.preventDefault();
    setError('');
    const name = displayName.trim();
    if (!name) { setError('Enter a display name.'); return; }
    setBusy(true);
    try {
      // Get token from current session (available after OTP verification)
      const { data: { session } } = await supabase.auth.getSession();
      const tok = session?.access_token ?? token;
      await api.users.updateProfile({ display_name: name }, tok);
      await refreshProfile();
      await joinRoom();
    } catch (err) {
      setError(err.message ?? 'Could not save name.');
    } finally { setBusy(false); }
  }

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
          <Logo size={44} style={{ margin: '0 auto 14px' }} />
          <p style={{ color: '#8B6F52', margin: '0 0 4px', fontSize: 13 }}>Joining</p>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 900, color: '#F0E6D3' }}>{venue.name}</h1>
        </div>

        {/* ── Phase: phone ── */}
        {phase === 'phone' && (
          <form onSubmit={handleSendOtp} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600, color: '#8B6F52', marginBottom: 6 }}>
                <Phone size={12} /> Phone number
              </label>
              <input
                className="input"
                type="tel"
                placeholder="+1 555 000 0000"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                autoFocus
                style={{ fontSize: 17, letterSpacing: 1 }}
              />
              <p style={{ margin: '6px 0 0', fontSize: 11, color: '#5A4535' }}>
                Include country code (e.g. +1 for US, +91 for India)
              </p>
            </div>
            {error && <p style={{ margin: 0, color: '#f87171', fontSize: 13 }}>{error}</p>}
            <button className="btn-primary" type="submit" disabled={busy} style={{ padding: 14, fontSize: 15 }}>
              {busy ? 'Sending…' : <><Phone size={16} /> Send Code</>}
            </button>
            {venue.welcome_credits > 0 && (
              <p style={{ textAlign: 'center', fontSize: 12, color: '#8B6F52', margin: 0 }}>
                You'll get <strong style={{ color: '#FF6B35' }}>{venue.welcome_credits} free credits</strong> on your first visit
              </p>
            )}
          </form>
        )}

        {/* ── Phase: otp ── */}
        {phase === 'otp' && (
          <form onSubmit={handleVerifyOtp} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600, color: '#8B6F52', marginBottom: 6 }}>
                <KeyRound size={12} /> Verification code
              </label>
              <p style={{ margin: '0 0 10px', fontSize: 13, color: '#8B6F52' }}>
                Sent to <strong style={{ color: '#F0E6D3' }}>{phone}</strong>
              </p>
              <input
                className="input"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                placeholder="000000"
                maxLength={6}
                value={otp}
                onChange={e => setOtp(e.target.value.replace(/\D/g, ''))}
                autoFocus
                style={{ fontSize: 28, letterSpacing: 8, textAlign: 'center', fontFamily: 'monospace' }}
              />
            </div>
            {error && <p style={{ margin: 0, color: '#f87171', fontSize: 13 }}>{error}</p>}
            <button className="btn-primary" type="submit" disabled={busy} style={{ padding: 14, fontSize: 15 }}>
              {busy ? 'Verifying…' : <><KeyRound size={16} /> Verify Code</>}
            </button>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <button type="button" style={{ background: 'none', border: 'none', color: '#8B6F52', cursor: 'pointer', fontSize: 13, display: 'flex', alignItems: 'center', gap: 4 }}
                onClick={() => { setPhase('phone'); setOtp(''); setError(''); }}>
                <RotateCcw size={13} /> Change number
              </button>
              {resendTimer > 0
                ? <span style={{ fontSize: 12, color: '#5A4535' }}>Resend in {resendTimer}s</span>
                : <button type="button" style={{ background: 'none', border: 'none', color: '#FF6B35', cursor: 'pointer', fontSize: 13 }}
                    onClick={handleSendOtp} disabled={busy}>Resend code</button>
              }
            </div>
          </form>
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
