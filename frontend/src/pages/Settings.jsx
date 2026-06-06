import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, LogOut } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useLang } from '../context/LangContext.jsx';
import { api } from '../lib/api.js';

export default function Settings() {
  const { profile, token, refreshProfile, signOut } = useAuth();
  const { t, lang, setLang } = useLang();
  const navigate = useNavigate();

  const [displayName, setDisplayName] = useState(profile?.display_name ?? '');
  const [saved, setSaved] = useState(false);

  async function handleSave(e) {
    e.preventDefault();
    try {
      await api.users.updateProfile({ display_name: displayName, language: lang }, token);
      await refreshProfile();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {}
  }

  const goBack = () => {
    if (profile?.role === 'host') navigate('/host/dashboard');
    else navigate('/guest');
  };

  return (
    <div style={{ maxWidth: 400, margin: '0 auto', padding: '32px 16px', minHeight: '100vh', background: '#0E0A07' }}>
      <button onClick={goBack} style={{ background: 'none', border: 'none', color: '#8B6F52', cursor: 'pointer', marginBottom: 24, fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
        <ArrowLeft size={16} /> {t.back}
      </button>

      <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 28, color: '#F0E6D3' }}>{t.settingsTitle}</h1>

      {/* Language */}
      <div style={{ marginBottom: 24 }}>
        <label style={{ fontSize: 13, fontWeight: 600, color: '#8B6F52', display: 'block', marginBottom: 10 }}>
          {t.language}
        </label>
        <div style={{ display: 'flex', gap: 10 }}>
          {[{ code: 'en', label: t.english }, { code: 'hi', label: t.hindi }].map(({ code, label }) => (
            <button key={code} onClick={() => setLang(code)} style={{
              flex: 1, padding: 12, borderRadius: 7, border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: 15,
              background: lang === code ? '#FF6B35' : '#1A1008',
              color: lang === code ? '#F0E6D3' : '#8B6F52',
              transition: 'all 0.15s', fontFamily: 'inherit',
            }}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {profile && (
        <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24 }}>
          <div>
            <label style={{ fontSize: 13, fontWeight: 600, color: '#8B6F52', display: 'block', marginBottom: 6 }}>
              {t.displayName}
            </label>
            <input className="input" value={displayName} onChange={e => setDisplayName(e.target.value)} />
          </div>
          <button className="btn-primary" type="submit" style={{ alignSelf: 'flex-start', padding: '10px 24px' }}>
            {saved ? t.saved : t.save}
          </button>
        </form>
      )}

      {profile && (
        <button className="btn-secondary" style={{ width: '100%' }} onClick={signOut}>
          <LogOut size={16} /> {t.logout}
        </button>
      )}
    </div>
  );
}
