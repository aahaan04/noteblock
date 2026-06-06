import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Music, Globe, AlertTriangle, User, ArrowRight } from 'lucide-react';
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

  useEffect(() => { loadVenue(); }, [roomCode]);

  async function loadVenue() {
    try {
      const v = await api.venues.getByCode(roomCode);
      if (v.status === 'closed') { setError('This room is currently closed.'); return; }
      setVenue(v);
    } catch { setError('Room not found.'); }
  }

  async function proceed() {
    if (!venue) return;
    const name = displayName.trim() || 'Guest';
    localStorage.setItem('nb_guest_name', name);

    if (token && profile?.role !== 'host') {
      await api.users.welcome(venue.id, token).catch(() => {});
      await refreshProfile();
    }

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
        <Music size={48} color="#2A1F17" style={{ marginBottom: 16 }} />
        <p style={{ color: '#f87171' }}>{error}</p>
        <button className="btn-secondary" onClick={() => navigate('/')}>← Home</button>
      </div>
    );
  }

  if (!venue) return <div className="center-screen"><p style={{ color: '#8B6F52' }}>{t.loading}</p></div>;

  // Language selection
  if (!langChosen && !localStorage.getItem('nb_lang')) {
    return (
      <div className="center-screen">
        <div style={{ textAlign: 'center', maxWidth: 320 }}>
          <Globe size={48} color="#FF6B35" style={{ marginBottom: 16 }} />
          <h2 style={{ marginBottom: 8, color: '#F0E6D3' }}>{t.chooseLanguage}</h2>
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
        <Music size={52} color="#FF6B35" style={{ marginBottom: 12 }} />
        <p style={{ color: '#8B6F52', margin: '0 0 4px' }}>{t.welcomeTo}</p>
        <h1 style={{ margin: '0 0 24px', fontSize: 28, fontWeight: 900, color: '#F0E6D3' }}>{venue.name}</h1>

        {venue.welcome_credits > 0 && (
          <div style={{
            background: 'rgba(255,107,53,0.08)',
            border: '1px solid rgba(255,107,53,0.3)',
            borderRadius: 10,
            padding: '12px 20px',
            marginBottom: 24, fontSize: 14, color: '#F0E6D3',
          }}>
            You'll receive <strong style={{ color: '#FF6B35' }}>{venue.welcome_credits} free credits</strong> to request songs!
          </div>
        )}

        {/* Display name */}
        <div style={{ marginBottom: 16, textAlign: 'left' }}>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#8B6F52', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 5 }}>
            <User size={13} /> Your name <span style={{ fontWeight: 400 }}>(shown when you request songs)</span>
          </label>
          <input
            type="text"
            value={displayName}
            onChange={e => setDisplayName(e.target.value)}
            placeholder="Enter a nickname…"
            maxLength={32}
            className="input"
          />
        </div>

        <button className="btn-primary" style={{ width: '100%', padding: 16, fontSize: 16, marginBottom: 12 }} onClick={proceed}>
          {t.joinVenue} <ArrowRight size={18} />
        </button>

        {!token && (
          <p style={{ fontSize: 12, color: '#8B6F52', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
            <AlertTriangle size={12} /> {t.anonymousCreditWarning}{' '}
            <a href="/" style={{ color: '#FF6B35' }}>{t.login}</a>
          </p>
        )}
      </div>
    </div>
  );
}
