import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useLang } from '../context/LangContext.jsx';
import { api } from '../lib/api.js';

export default function GuestJoin() {
  const { roomCode } = useParams();
  const { profile, token, refreshProfile } = useAuth();
  const { t, lang, setLang } = useLang();
  const navigate = useNavigate();

  const [venue, setVenue] = useState(null);
  const [error, setError] = useState('');
  const [langChosen, setLangChosen] = useState(false);
  const [displayName, setDisplayName] = useState(
    () => profile?.display_name || localStorage.getItem('nb_guest_name') || ''
  );

  useEffect(() => {
    loadVenue();
  }, [roomCode]);

  async function loadVenue() {
    try {
      const v = await api.venues.getByCode(roomCode);
      if (v.status === 'closed') {
        setError('This room is currently closed.');
        return;
      }
      setVenue(v);
    } catch {
      setError('Room not found.');
    }
  }

  async function proceed() {
    if (!venue) return;

    // Save display name to localStorage (used as requester_name in room)
    const name = displayName.trim() || 'Guest';
    localStorage.setItem('nb_guest_name', name);

    // Grant welcome credits for logged-in guests
    if (token && profile?.role !== 'host') {
      await api.users.welcome(venue.id, token).catch(() => {});
      await refreshProfile(); // sync updated credits_balance into auth context
    }

    // Anonymous: give welcome credits once per device per room
    if (!token) {
      const creditKey = `nb_credits_granted_${venue.id}`;
      if (!localStorage.getItem(creditKey)) {
        const existing = parseInt(localStorage.getItem('nb_anon_credits') ?? '0');
        localStorage.setItem('nb_anon_credits', String(existing + (venue.welcome_credits ?? 10)));
        localStorage.setItem(creditKey, '1');
      }
    }

    navigate(`/room/${roomCode}`);
  }

  if (error) {
    return (
      <div className="center-screen">
        <div style={{ fontSize: 48, marginBottom: 16 }}>🚫</div>
        <p style={{ color: '#f87171' }}>{error}</p>
        <button className="btn-secondary" onClick={() => navigate('/')}>← Home</button>
      </div>
    );
  }

  if (!venue) {
    return <div className="center-screen"><p style={{ color: 'var(--text-muted)' }}>{t.loading}</p></div>;
  }

  // First-time language choice
  if (!langChosen && !localStorage.getItem('nb_lang')) {
    return (
      <div className="center-screen">
        <div style={{ textAlign: 'center', maxWidth: 320 }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🌐</div>
          <h2 style={{ marginBottom: 8 }}>{t.chooseLanguage}</h2>
          <div style={{ display: 'flex', gap: 12, marginTop: 20, justifyContent: 'center' }}>
            <button className="btn-primary" style={{ minWidth: 120 }} onClick={() => { setLang('en'); setLangChosen(true); }}>
              English
            </button>
            <button className="btn-secondary" style={{ minWidth: 120 }} onClick={() => { setLang('hi'); setLangChosen(true); }}>
              हिंदी
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="center-screen">
      <div style={{ textAlign: 'center', maxWidth: 340 }}>
        <div style={{ fontSize: 56, marginBottom: 12 }}>🎵</div>
        <p style={{ color: 'var(--text-muted)', margin: '0 0 4px' }}>{t.welcomeTo}</p>
        <h1 style={{ margin: '0 0 24px', fontSize: 28, fontWeight: 900 }}>{venue.name}</h1>

        {venue.welcome_credits > 0 && (
          <div style={{
            background: 'rgba(99,102,241,0.12)',
            border: '1px solid var(--accent)',
            borderRadius: 10,
            padding: '12px 20px',
            marginBottom: 24,
            fontSize: 14,
            color: 'var(--text)',
          }}>
            🎁 You'll receive <strong>{venue.welcome_credits} free credits</strong> to request songs!
          </div>
        )}

        {/* Display name */}
        <div style={{ marginBottom: 16, textAlign: 'left' }}>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>
            👤 Your name <span style={{ fontWeight: 400 }}>(shown when you request songs)</span>
          </label>
          <input
            type="text"
            value={displayName}
            onChange={e => setDisplayName(e.target.value)}
            placeholder="Enter a nickname…"
            maxLength={32}
            style={{
              width: '100%', padding: '10px 14px', borderRadius: 8,
              border: '1px solid var(--border)', background: 'var(--surface)',
              color: 'var(--text)', fontSize: 14, boxSizing: 'border-box',
            }}
          />
        </div>

        <button className="btn-primary" style={{ width: '100%', padding: 16, fontSize: 16, marginBottom: 12 }} onClick={proceed}>
          {t.joinVenue} →
        </button>

        {!token && (
          <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            ⚠️ {t.anonymousCreditWarning}{' '}
            <a href="/" style={{ color: 'var(--accent)' }}>{t.login}</a>
          </p>
        )}
      </div>
    </div>
  );
}
