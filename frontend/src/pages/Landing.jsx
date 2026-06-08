import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sliders, Music, ArrowLeft } from 'lucide-react';
import Logo from '../components/Logo.jsx';
import VersionFooter from '../components/VersionFooter.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useLang } from '../context/LangContext.jsx';

export default function Landing() {
  const { signIn, signUp, profile, loading } = useAuth();
  const { t } = useLang();
  const navigate = useNavigate();

  const [mode, setMode] = useState(null); // null | 'host-auth' | 'guest-code'
  const [authTab, setAuthTab] = useState('login');
  const [form, setForm] = useState({ email: '', password: '', displayName: '' });
  const [roomCode, setRoomCode] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

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

  const handleGuestJoin = (e) => {
    e.preventDefault();
    const code = roomCode.trim().toUpperCase();
    if (code) navigate(`/join/${code}`);
  };

  // ── Landing screen ────────────────────────────────────────────────────────────
  if (!mode) return (
    <div className="center-screen">
      <div style={{ textAlign: 'center', marginBottom: 40 }}>
        <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'center' }}>
          <Logo size={72} />
        </div>
        <h1 style={{ fontSize: 36, fontWeight: 900, margin: 0, color: '#FF6B35', letterSpacing: '-0.5px' }}>
          {t.appName}
        </h1>
        <p style={{ color: '#8B6F52', marginTop: 6 }}>{t.tagline}</p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, width: '100%', maxWidth: 320 }}>
        <button className="btn-primary" style={{ padding: '16px', fontSize: 16 }} onClick={() => setMode('host-auth')}>
          <Sliders size={18} /> {t.iAmHost}
        </button>
        <button className="btn-secondary" style={{ padding: '16px', fontSize: 16 }} onClick={() => setMode('guest-code')}>
          <Music size={18} /> Join a Room
        </button>
      </div>
      <VersionFooter />
    </div>
  );

  // ── Guest: enter room code → phone OTP on join page ───────────────────────────
  if (mode === 'guest-code') return (
    <div className="center-screen">
      <div style={{ width: '100%', maxWidth: 360 }}>
        <button onClick={() => setMode(null)} style={{ background: 'none', border: 'none', color: '#8B6F52', cursor: 'pointer', marginBottom: 24, fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
          <ArrowLeft size={16} /> {t.back}
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
      <div style={{ width: '100%', maxWidth: 360 }}>
        <button onClick={() => setMode(null)} style={{ background: 'none', border: 'none', color: '#8B6F52', cursor: 'pointer', marginBottom: 24, fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
          <ArrowLeft size={16} /> {t.back}
        </button>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <Sliders size={32} color="#FF6B35" />
          <h2 style={{ margin: '8px 0 4px', color: '#F0E6D3' }}>{t.iAmHost}</h2>
          <p style={{ color: '#8B6F52', fontSize: 13 }}>{t.hostNote}</p>
        </div>

        <div style={{ display: 'flex', background: '#1A1008', borderRadius: 7, padding: 4, marginBottom: 20 }}>
          {['login', 'signup'].map(tab => (
            <button key={tab} onClick={() => setAuthTab(tab)} style={{
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
          <input className="input" type="password" placeholder={t.password}
            value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} required />
          {error && <p style={{ color: '#f87171', fontSize: 13, margin: 0 }}>{error}</p>}
          <button className="btn-primary" type="submit" disabled={submitting} style={{ padding: 14, fontSize: 15 }}>
            {submitting ? t.loading : (authTab === 'login' ? t.login : t.signup)}
          </button>
        </form>
      </div>
      <VersionFooter />
    </div>
  );
}
