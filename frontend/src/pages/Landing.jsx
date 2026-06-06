import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useLang } from '../context/LangContext.jsx';

export default function Landing() {
  const { signIn, signUp, signInWithGoogle, profile, loading } = useAuth();
  const { t } = useLang();
  const navigate = useNavigate();

  const [mode, setMode] = useState(null); // null | 'host-auth' | 'guest-auth' | 'guest-anon'
  const [authTab, setAuthTab] = useState('login'); // 'login' | 'signup'
  const [form, setForm] = useState({ email: '', password: '', displayName: '' });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Redirect if already logged in
  if (!loading && profile) {
    if (profile.role === 'host') navigate('/host/dashboard', { replace: true });
    else navigate('/guest', { replace: true });
    return null;
  }

  const isHost = mode === 'host-auth';

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      if (authTab === 'login') {
        await signIn(form.email, form.password);
      } else {
        await signUp(form.email, form.password, form.displayName, isHost ? 'host' : 'guest');
      }
      // Auth context will redirect via profile load
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogle = async () => {
    setError('');
    try { await signInWithGoogle(); } catch (err) { setError(err.message); }
  };

  const handleGuestAnon = () => {
    navigate('/guest');
  };

  // Landing screen
  if (!mode) {
    return (
      <div className="center-screen">
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <div style={{ fontSize: 56, marginBottom: 8 }}>🎵</div>
          <h1 style={{ fontSize: 36, fontWeight: 900, margin: 0, background: 'linear-gradient(135deg, var(--accent), var(--accent2))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            {t.appName}
          </h1>
          <p style={{ color: 'var(--text-muted)', marginTop: 6 }}>{t.tagline}</p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, width: '100%', maxWidth: 320 }}>
          <button className="btn-primary" style={{ padding: '16px', fontSize: 16 }} onClick={() => setMode('host-auth')}>
            🎛️ {t.iAmHost}
          </button>
          <button className="btn-secondary" style={{ padding: '16px', fontSize: 16 }} onClick={() => setMode('guest-auth')}>
            🎶 {t.iAmGuest}
          </button>
          <button
            style={{
              padding: '12px',
              fontSize: 14,
              background: 'none',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              textDecoration: 'underline',
            }}
            onClick={handleGuestAnon}
          >
            {t.continueAsGuest}
          </button>
        </div>
      </div>
    );
  }

  // Auth form
  return (
    <div className="center-screen">
      <div style={{ width: '100%', maxWidth: 360 }}>
        <button
          onClick={() => setMode(null)}
          style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', marginBottom: 24, fontSize: 14 }}
        >
          {t.back}
        </button>

        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ fontSize: 32 }}>{isHost ? '🎛️' : '🎶'}</div>
          <h2 style={{ margin: '8px 0 4px' }}>{isHost ? t.iAmHost : t.iAmGuest}</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>{isHost ? t.hostNote : t.guestNote}</p>
        </div>

        {!isHost && (
          <div style={{ marginBottom: 16 }}>
            <button
              className="btn-secondary"
              style={{ width: '100%', padding: 12 }}
              onClick={handleGuestAnon}
            >
              {t.continueAsGuest}
            </button>
            <p style={{ textAlign: 'center', fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
              ⚠️ {t.anonymousCreditWarning}
            </p>
            <div style={{ textAlign: 'center', color: 'var(--text-muted)', margin: '12px 0', fontSize: 13 }}>— {t.orContinueWith} —</div>
          </div>
        )}

        {/* Tabs */}
        <div style={{ display: 'flex', background: 'var(--surface)', borderRadius: 10, padding: 4, marginBottom: 20 }}>
          {['login', 'signup'].map(tab => (
            <button
              key={tab}
              onClick={() => setAuthTab(tab)}
              style={{
                flex: 1, padding: '8px', borderRadius: 8, border: 'none', cursor: 'pointer',
                background: authTab === tab ? 'var(--accent)' : 'transparent',
                color: authTab === tab ? '#fff' : 'var(--text-muted)',
                fontWeight: 600, fontSize: 14,
                transition: 'all 0.15s',
              }}
            >
              {tab === 'login' ? t.login : t.signup}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {authTab === 'signup' && (
            <input
              className="input"
              type="text"
              placeholder={t.displayName}
              value={form.displayName}
              onChange={e => setForm(f => ({ ...f, displayName: e.target.value }))}
              required
            />
          )}
          <input
            className="input"
            type="email"
            placeholder={t.email}
            value={form.email}
            onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
            required
          />
          <input
            className="input"
            type="password"
            placeholder={t.password}
            value={form.password}
            onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
            required
          />
          {error && <p style={{ color: '#f87171', fontSize: 13, margin: 0 }}>{error}</p>}
          <button className="btn-primary" type="submit" disabled={submitting} style={{ padding: 14, fontSize: 15 }}>
            {submitting ? t.loading : (authTab === 'login' ? t.login : t.signup)}
          </button>
        </form>

        {/* Google OAuth — uncomment once enabled in Supabase Dashboard → Auth → Providers → Google */}
        {/* <div style={{ marginTop: 16 }}>
          <button className="btn-secondary" style={{ width: '100%', padding: 12 }} onClick={handleGoogle}>
            <span style={{ marginRight: 8 }}>G</span> {t.signInWithGoogle}
          </button>
        </div> */}
      </div>
    </div>
  );
}
