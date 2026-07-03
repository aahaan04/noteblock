import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sliders, Music } from 'lucide-react';
import Logo from '../components/Logo.jsx';
import VersionFooter from '../components/VersionFooter.jsx';
import WelcomeParticles from '../components/WelcomeParticles.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useLang } from '../context/LangContext.jsx';
import { useEffect } from 'react';

const WELCOME_FONT = "'Manrope', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

export default function Landing() {
  const { signIn, signUp, sendMagicLink, profile, loading } = useAuth();
  const { t } = useLang();
  const navigate = useNavigate();

  const [mode, setMode] = useState(null); // null | 'host-auth' | 'guest-code'
  const [authTab, setAuthTab] = useState('login');
  const [form, setForm] = useState({ email: '', password: '', displayName: '' });
  const [roomCode, setRoomCode] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Forgot-password sub-flow
  const [forgotPw, setForgotPw] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotSent, setForgotSent] = useState(false);
  const [forgotSubmitting, setForgotSubmitting] = useState(false);
  const [forgotError, setForgotError] = useState('');

  useEffect(() => {
    if (!loading && profile) {
      if (profile.role === 'host') navigate('/host/dashboard', { replace: true });
      else navigate('/guest', { replace: true });
    }
  }, [loading, profile]);

  if (loading) return null;

  const handleHostSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      if (authTab === 'login') await signIn(form.email, form.password);
      else await signUp(form.email, form.password, form.displayName, 'host');
    } catch (err) {
      setError(err.message);
    } finally { setSubmitting(false); }
  };

  const handleForgotSubmit = async (e) => {
    e.preventDefault();
    setForgotError('');
    setForgotSubmitting(true);
    try {
      await sendMagicLink(forgotEmail, `${window.location.origin}/host/dashboard`);
      setForgotSent(true);
    } catch (err) {
      setForgotError(err.message);
    } finally { setForgotSubmitting(false); }
  };

  const handleGuestJoin = (e) => {
    e.preventDefault();
    const code = roomCode.trim().toUpperCase();
    if (code) navigate(`/join/${code}`);
  };

  // ── Landing screen ────────────────────────────────────────────────────────────
  if (!mode) return (
    <div className="center-screen" style={{ fontFamily: WELCOME_FONT }}>
      {/* Glow + particles + floating block — contained to its own box so the
          rise animation has a clear origin without needing a fixed-size frame */}
      <div style={{ position: 'relative', width: 240, height: 200, marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="wp-glow" />
        <WelcomeParticles />
        <div className="wp-block-wrap" style={{ position: 'relative', zIndex: 2 }}>
          <Logo size={100} />
        </div>
      </div>

      <div style={{ textAlign: 'center', marginBottom: 40 }}>
        <h1 style={{
          fontSize: 40, fontWeight: 800, margin: 0, color: '#FF6B35', letterSpacing: '-1px',
          textShadow: '0 0 30px rgba(255,107,53,0.3)',
        }}>
          {t.appName}
        </h1>
        <p style={{ color: '#8B6F52', marginTop: 8, fontSize: 15, fontWeight: 500 }}>{t.tagline}</p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%', maxWidth: 320 }}>
        <button
          onClick={() => setMode('host-auth')}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
            padding: 16, borderRadius: 12, fontSize: 15, fontWeight: 800, letterSpacing: '-0.1px',
            background: '#FF6B35', color: '#0E0A07', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
            boxShadow: '0 0 28px rgba(255,107,53,0.4)',
          }}
        >
          <Sliders size={17} /> {t.iAmHost}
        </button>
        <button
          onClick={() => setMode('guest-code')}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
            padding: 16, borderRadius: 12, fontSize: 15, fontWeight: 800, letterSpacing: '-0.1px',
            background: '#2A1F17', color: '#F0E6D3', border: '1px solid #3D2B1A', cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          <Music size={17} /> Join a Room
        </button>
      </div>
      <VersionFooter />

      <style>{`
        .wp-glow {
          position: absolute;
          top: 50%; left: 50%;
          width: 320px; height: 320px;
          transform: translate(-50%, -50%);
          background: radial-gradient(circle, rgba(255,107,53,0.14) 0%, transparent 65%);
          pointer-events: none;
          z-index: 0;
          animation: wp-glow-pulse 4s ease-in-out infinite;
        }
        @keyframes wp-glow-pulse {
          0%, 100% { opacity: 0.7; transform: translate(-50%, -50%) scale(1); }
          50%      { opacity: 1;   transform: translate(-50%, -50%) scale(1.08); }
        }
        .wp-block-wrap {
          filter: drop-shadow(0 0 24px rgba(255,107,53,0.35));
          animation: wp-block-float 3s ease-in-out infinite;
        }
        @keyframes wp-block-float {
          0%, 100% { transform: translateY(0); }
          50%      { transform: translateY(-8px); }
        }
        @media (prefers-reduced-motion: reduce) {
          .wp-glow, .wp-block-wrap { animation: none; }
        }
      `}</style>
    </div>
  );

  // ── Guest: enter room code ────────────────────────────────────────────────────
  if (mode === 'guest-code') return (
    <div className="center-screen">
      <div style={{ width: '100%', maxWidth: 360 }}>
        <button onClick={() => setMode(null)} style={{ background: 'none', border: 'none', color: '#8B6F52', cursor: 'pointer', marginBottom: 24, fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
          {t.back}
        </button>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <Logo size={40} style={{ margin: '0 auto 10px' }} />
          <h2 style={{ margin: '8px 0 4px', color: '#F0E6D3' }}>Join a Room</h2>
          <p style={{ color: '#8B6F52', fontSize: 13 }}>Enter the room code shown at the venue</p>
        </div>
        <form onSubmit={handleGuestJoin} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <input
            className="input"
            style={{ fontFamily: 'monospace', letterSpacing: 4, fontSize: 22, textTransform: 'uppercase', textAlign: 'center' }}
            placeholder="ROOM CODE"
            value={roomCode}
            onChange={e => setRoomCode(e.target.value.toUpperCase())}
            maxLength={8}
            autoFocus
          />
          <button className="btn-primary" type="submit" disabled={!roomCode.trim()} style={{ padding: 14, fontSize: 15 }}>
            Continue <Music size={16} />
          </button>
        </form>
      </div>
      <VersionFooter />
    </div>
  );

  // ── Host: email/password auth ─────────────────────────────────────────────────
  return (
    <div className="center-screen">
      <div style={{ width: '100%', maxWidth: 360, padding: '0 4px' }}>
        <button
          onClick={() => { setMode(null); setForgotPw(false); setForgotSent(false); setError(''); setForgotError(''); }}
          style={{ background: 'none', border: 'none', color: '#8B6F52', cursor: 'pointer', marginBottom: 24, fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}
        >
          {t.back}
        </button>

        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <Sliders size={32} color="#FF6B35" />
          <h2 style={{ margin: '8px 0 4px', color: '#F0E6D3' }}>{t.iAmHost}</h2>
          <p style={{ color: '#8B6F52', fontSize: 13 }}>{t.hostNote}</p>
        </div>

        {/* ── Forgot password sub-flow ── */}
        {forgotPw ? (
          forgotSent ? (
            <div style={{ textAlign: 'center', padding: '16px 0' }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>📬</div>
              <p style={{ color: '#F0E6D3', fontWeight: 700, marginBottom: 6 }}>Check your email</p>
              <p style={{ color: '#8B6F52', fontSize: 13, lineHeight: 1.5 }}>
                We sent a login link to <strong style={{ color: '#F0E6D3' }}>{forgotEmail}</strong>. Click it to sign in without a password.
              </p>
              <button
                onClick={() => { setForgotPw(false); setForgotSent(false); setForgotEmail(''); }}
                style={{ marginTop: 20, background: 'none', border: 'none', color: '#FF6B35', cursor: 'pointer', fontSize: 14, fontWeight: 600 }}
              >
                Back to login
              </button>
            </div>
          ) : (
            <form onSubmit={handleForgotSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <p style={{ color: '#8B6F52', fontSize: 13, marginBottom: 4, lineHeight: 1.5 }}>
                Enter your email and we'll send you a magic link to sign in instantly — no password needed.
              </p>
              <input
                className="input"
                type="email"
                placeholder={t.email}
                value={forgotEmail}
                onChange={e => setForgotEmail(e.target.value)}
                required
                autoFocus
              />
              {forgotError && <p style={{ color: '#f87171', fontSize: 13, margin: 0 }}>{forgotError}</p>}
              <button className="btn-primary" type="submit" disabled={forgotSubmitting} style={{ padding: 14, fontSize: 15 }}>
                {forgotSubmitting ? 'Sending…' : 'Send Login Link'}
              </button>
              <button
                type="button"
                onClick={() => { setForgotPw(false); setForgotError(''); }}
                style={{ background: 'none', border: 'none', color: '#8B6F52', cursor: 'pointer', fontSize: 13, padding: '4px 0' }}
              >
                Cancel
              </button>
            </form>
          )
        ) : (
          <>
            {/* ── Login / Sign Up tabs ── */}
            <div style={{ display: 'flex', background: '#1A1008', borderRadius: 7, padding: 4, marginBottom: 20 }}>
              {['login', 'signup'].map(tab => (
                <button key={tab} onClick={() => { setAuthTab(tab); setError(''); }} style={{
                  flex: 1, padding: '8px', borderRadius: 5, border: 'none', cursor: 'pointer',
                  background: authTab === tab ? '#FF6B35' : 'transparent',
                  color: authTab === tab ? '#F0E6D3' : '#8B6F52',
                  fontWeight: 600, fontSize: 14, transition: 'all 0.15s', fontFamily: 'inherit',
                }}>
                  {tab === 'login' ? t.login : t.signup}
                </button>
              ))}
            </div>

            <form onSubmit={handleHostSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {authTab === 'signup' && (
                <input className="input" type="text" placeholder={t.displayName}
                  value={form.displayName} onChange={e => setForm(f => ({ ...f, displayName: e.target.value }))} required />
              )}
              <input className="input" type="email" placeholder={t.email}
                value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} required />
              <div>
                <input className="input" type="password" placeholder={t.password}
                  value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} required />
                {authTab === 'login' && (
                  <button
                    type="button"
                    onClick={() => { setForgotPw(true); setForgotEmail(form.email); setForgotError(''); }}
                    style={{ background: 'none', border: 'none', color: '#8B6F52', cursor: 'pointer', fontSize: 12, marginTop: 6, padding: 0, display: 'block' }}
                  >
                    Forgot password?
                  </button>
                )}
              </div>
              {error && <p style={{ color: '#f87171', fontSize: 13, margin: 0 }}>{error}</p>}
              <button className="btn-primary" type="submit" disabled={submitting} style={{ padding: 14, fontSize: 15 }}>
                {submitting ? t.loading : (authTab === 'login' ? t.login : t.signup)}
              </button>
            </form>
          </>
        )}
      </div>
      <VersionFooter />
    </div>
  );
}
