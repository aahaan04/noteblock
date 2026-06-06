import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useLang } from '../context/LangContext.jsx';
import { api } from '../lib/api.js';

export default function GuestJoin() {
  const { roomCode } = useParams();
  const { profile, token } = useAuth();
  const { t, lang, setLang } = useLang();
  const navigate = useNavigate();

  const [venue, setVenue] = useState(null);
  const [error, setError] = useState('');
  const [langChosen, setLangChosen] = useState(false);

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

    // Grant welcome credits for logged-in guests
    if (token && profile?.role !== 'host') {
      await api.users.welcome(venue.id, token).catch(() => {});
    }

    // Anonymous: give session credits
    if (!token) {
      const key = `nb_session_credits_${venue.id}`;
      if (!sessionStorage.getItem(key)) {
        const existing = parseInt(localStorage.getItem('nb_anon_credits') ?? '0');
        localStorage.setItem('nb_anon_credits', String(existing + (venue.welcome_credits ?? 10)));
        sessionStorage.setItem(key, '1');
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
