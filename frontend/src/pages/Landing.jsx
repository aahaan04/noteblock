import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sliders, Music } from 'lucide-react';
import Logo from '../components/Logo.jsx';
import VersionFooter from '../components/VersionFooter.jsx';
import WelcomeParticles from '../components/WelcomeParticles.jsx';
import PhoneAuthFlow from '../components/PhoneAuthFlow.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useLang } from '../context/LangContext.jsx';

const WELCOME_FONT = "'Manrope', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

export default function Landing() {
  const { profile, loading } = useAuth();
  const { t } = useLang();
  const navigate = useNavigate();

  const [mode, setMode] = useState(null); // null | 'host-auth' | 'guest-code'
  const [roomCode, setRoomCode] = useState('');

  useEffect(() => {
    if (!loading && profile) {
      if (profile.role === 'host') navigate('/host/dashboard', { replace: true });
      else navigate('/guest', { replace: true });
    }
  }, [loading, profile]);

  if (loading) return null;

  const handleGuestJoin = (e) => {
    e.preventDefault();
    const code = roomCode.trim().toUpperCase();
    if (code) navigate(`/join/${code}`);
  };

  // ── Landing screen ────────────────────────────────────────────────────────────
  if (!mode) return (
    <div className="center-screen" style={{ fontFamily: WELCOME_FONT, justifyContent: 'flex-start', paddingTop: 'min(18vh, 160px)' }}>
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

  // ── Host: phone + SMS OTP auth ────────────────────────────────────────────────
  return (
    <div className="center-screen">
      <div style={{ width: '100%', maxWidth: 360, padding: '0 4px' }}>
        <button
          onClick={() => setMode(null)}
          style={{ background: 'none', border: 'none', color: '#8B6F52', cursor: 'pointer', marginBottom: 24, fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}
        >
          {t.back}
        </button>

        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <Sliders size={32} color="#FF6B35" />
          <h2 style={{ margin: '8px 0 4px', color: '#F0E6D3' }}>{t.iAmHost}</h2>
          <p style={{ color: '#8B6F52', fontSize: 13 }}>{t.hostNote}</p>
        </div>

        <PhoneAuthFlow role="host" onDone={() => navigate('/host/dashboard', { replace: true })} />
      </div>
      <VersionFooter />
    </div>
  );
}
