import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, LogOut, Sun, Moon } from 'lucide-react';
import VersionFooter from '../components/VersionFooter.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useLang } from '../context/LangContext.jsx';
import { useTheme } from '../context/ThemeContext.jsx';
import { api } from '../lib/api.js';

export default function Settings() {
  const { profile, token, refreshProfile, signOut } = useAuth();
  const { t, lang, setLang } = useLang();
  const { dark, toggle } = useTheme();
  const navigate = useNavigate();

  const [displayName, setDisplayName] = useState(profile?.display_name ?? '');
  const [saved, setSaved] = useState(false);

  const bg = dark ? '#0E0A07' : '#FAF5EF';
  const cardBg = dark ? '#1A1008' : '#FFF8F2';
  const border = dark ? '#2A1F17' : '#E8D9C8';
  const text = dark ? '#F0E6D3' : '#1A0E06';
  const text2 = dark ? '#8B6F52' : '#7A5C42';

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
    <div style={{ maxWidth: 400, margin: '0 auto', padding: '32px 16px', minHeight: '100vh', background: bg }}>
      <button onClick={goBack} style={{ background: 'none', border: 'none', color: text2, cursor: 'pointer', marginBottom: 24, fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
        <ArrowLeft size={16} /> {t.back}
      </button>

      <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 28, color: text }}>{t.settingsTitle}</h1>

      {/* Dark / Light toggle */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 16, padding: '14px 16px', marginBottom: 20,
        background: cardBg, border: `1px solid ${border}`, borderRadius: 10,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {dark ? <Moon size={16} color="#C89B6E" /> : <Sun size={16} color="#FF6B35" />}
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, color: text, marginBottom: 2 }}>
              {dark ? 'Dark Mode' : 'Light Mode'}
            </div>
            <div style={{ fontSize: 12, color: text2 }}>
              {dark ? 'Switch to light theme' : 'Switch to dark theme'}
            </div>
          </div>
        </div>
        <button
          onClick={toggle}
          style={{
            flexShrink: 0, width: 48, height: 28, borderRadius: 999, border: 'none', cursor: 'pointer',
            background: dark ? '#FF6B35' : '#2A1F17',
            position: 'relative', transition: 'background 0.2s', padding: 0,
          }}
        >
          <span style={{
            position: 'absolute', top: 4, left: dark ? 24 : 4,
            width: 20, height: 20, borderRadius: '50%', background: '#F0E6D3',
            transition: 'left 0.2s', display: 'block',
          }} />
        </button>
      </div>

      {/* Language */}
      <div style={{ marginBottom: 24 }}>
        <label style={{ fontSize: 13, fontWeight: 600, color: text2, display: 'block', marginBottom: 10 }}>
          {t.language}
        </label>
        <div style={{ display: 'flex', gap: 10 }}>
          {[{ code: 'en', label: t.english }, { code: 'hi', label: t.hindi }].map(({ code, label }) => (
            <button key={code} onClick={() => setLang(code)} style={{
              flex: 1, padding: 12, borderRadius: 7, border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: 15,
              background: lang === code ? '#FF6B35' : cardBg,
              color: lang === code ? '#F0E6D3' : text2,
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
            <label style={{ fontSize: 13, fontWeight: 600, color: text2, display: 'block', marginBottom: 6 }}>
              {t.displayName}
            </label>
            <input className="input" value={displayName} onChange={e => setDisplayName(e.target.value)}
              style={{ background: cardBg, color: text, borderColor: border }} />
          </div>
          <button className="btn-primary" type="submit" style={{ alignSelf: 'flex-start', padding: '10px 24px' }}>
            {saved ? t.saved : t.save}
          </button>
        </form>
      )}

      <div style={{ height: 1, background: border, margin: '8px 0 20px' }} />

      {profile && (
        <button
          style={{
            width: '100%', padding: '12px 20px', borderRadius: 7, border: `1px solid ${border}`,
            background: 'none', color: '#C0392B', cursor: 'pointer', fontWeight: 700, fontSize: 14,
            fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            transition: 'border-color 0.15s',
          }}
          onMouseEnter={e => e.currentTarget.style.borderColor = '#C0392B'}
          onMouseLeave={e => e.currentTarget.style.borderColor = border}
          onClick={signOut}
        >
          <LogOut size={16} /> {t.logout}
        </button>
      )}
      <VersionFooter />
    </div>
  );
}
