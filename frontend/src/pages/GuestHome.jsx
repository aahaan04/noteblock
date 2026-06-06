import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Music, Settings, LogOut, ArrowRight, Coins } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useLang } from '../context/LangContext.jsx';
import { api } from '../lib/api.js';

export default function GuestHome() {
  const { profile, token, signOut } = useAuth();
  const { t } = useLang();
  const navigate = useNavigate();
  const [savedRooms, setSavedRooms] = useState([]);
  const [roomInput, setRoomInput] = useState('');

  useEffect(() => {
    if (token) api.users.savedRooms(token).then(setSavedRooms).catch(() => {});
  }, [token]);

  function handleJoin(e) {
    e.preventDefault();
    const code = roomInput.trim().toUpperCase();
    if (code) navigate(`/join/${code}`);
  }

  return (
    <div style={{ maxWidth: 480, margin: '0 auto', padding: '32px 16px', minHeight: '100vh', background: '#0E0A07' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 32 }}>
        <Music size={24} color="#FF6B35" />
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 900, flex: 1, color: '#F0E6D3' }}>Noteblock</h1>
        {token ? (
          <button className="btn-secondary" style={{ fontSize: 12 }} onClick={signOut}>
            <LogOut size={14} /> {t.logout}
          </button>
        ) : (
          <button className="btn-secondary" style={{ fontSize: 12 }} onClick={() => navigate('/')}>{t.login}</button>
        )}
        <button className="btn-secondary" style={{ fontSize: 12, padding: '8px 10px' }} onClick={() => navigate('/settings')}>
          <Settings size={15} />
        </button>
      </div>

      {profile && (
        <p style={{ color: '#8B6F52', marginBottom: 24, fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
          Welcome, <strong style={{ color: '#F0E6D3' }}>{profile.display_name}</strong>
          <Coins size={14} color="#C89B6E" />
          <span style={{ color: '#C89B6E', fontWeight: 700 }}>{profile.credits_balance}</span>
          <span>{t.credits}</span>
        </p>
      )}

      {/* Join by code */}
      <div style={{ background: '#1A1008', border: '1px solid #2A1F17', borderRadius: 10, padding: 20, marginBottom: 24 }}>
        <h3 style={{ margin: '0 0 12px', fontSize: 16, color: '#F0E6D3' }}>Join a Room</h3>
        <form onSubmit={handleJoin} style={{ display: 'flex', gap: 10 }}>
          <input
            className="input"
            style={{ flex: 1, fontFamily: 'monospace', letterSpacing: 3, fontSize: 18, textTransform: 'uppercase' }}
            placeholder="ROOM CODE"
            value={roomInput}
            onChange={e => setRoomInput(e.target.value.toUpperCase())}
            maxLength={8}
          />
          <button className="btn-primary" type="submit" style={{ padding: '10px 16px' }}>
            <ArrowRight size={18} />
          </button>
        </form>
      </div>

      {/* Saved rooms */}
      {savedRooms.length > 0 && (
        <div>
          <h3 style={{ fontSize: 16, marginBottom: 12, color: '#F0E6D3' }}>{t.savedRooms}</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {savedRooms.map(r => (
              <div key={r.id} style={{
                display: 'flex', alignItems: 'center', gap: 12,
                background: '#1A1008', border: '1px solid #2A1F17',
                borderRadius: 10, padding: '12px 16px',
              }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 15, color: '#F0E6D3' }}>{r.venue?.name}</div>
                  <div style={{ fontSize: 12, color: '#5A4535', fontFamily: 'monospace', letterSpacing: 2 }}>{r.venue?.room_code}</div>
                </div>
                <span style={{
                  fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999,
                  background: r.venue?.status === 'active' ? 'rgba(52,211,153,0.12)' : 'rgba(248,113,113,0.12)',
                  color: r.venue?.status === 'active' ? '#34d399' : '#f87171',
                }}>
                  {r.venue?.status === 'active' ? t.active : t.closed}
                </span>
                <button className="btn-primary" style={{ fontSize: 13 }} onClick={() => navigate(`/join/${r.venue?.room_code}`)}>
                  {t.rejoin}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
