import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Settings, Plus, QrCode, Home } from 'lucide-react';

function useIsMobile() {
  const [m, setM] = useState(() => window.innerWidth < 480);
  useEffect(() => {
    const fn = () => setM(window.innerWidth < 480);
    window.addEventListener('resize', fn);
    return () => window.removeEventListener('resize', fn);
  }, []);
  return m;
}
import Logo from '../components/Logo.jsx';
import VersionFooter from '../components/VersionFooter.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useLang } from '../context/LangContext.jsx';
import { supabase } from '../lib/supabase.js';
import VenueQRCode from '../components/VenueQRCode.jsx';

function makeRoomCode() {
  return Math.random().toString(36).slice(2, 6).toUpperCase() +
         Math.random().toString(36).slice(2, 6).toUpperCase();
}

export default function HostDashboard() {
  const { profile, user } = useAuth();
  const { t } = useLang();
  const navigate = useNavigate();
  const isMobile = useIsMobile();

  const [venues, setVenues] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [expandedQR, setExpandedQR] = useState(null);

  useEffect(() => {
    if (user) loadVenues();
  }, [user]);

  async function loadVenues() {
    setLoading(true);
    const { data, error } = await supabase
      .from('venues').select('*').eq('host_id', user.id).order('created_at', { ascending: false });
    if (!error) setVenues(data ?? []);
    setLoading(false);
  }

  async function createVenue(e) {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    setCreateError('');
    const { data, error } = await supabase
      .from('venues')
      .insert({ host_id: user.id, name: newName.trim(), room_code: makeRoomCode(), welcome_credits: 10, crossfade_duration_seconds: 5 })
      .select().single();
    if (error) { setCreateError(error.message); } else {
      setVenues(prev => [data, ...prev]);
      setNewName(''); setShowCreate(false);
    }
    setCreating(false);
  }

  return (
    <div style={{
      maxWidth: 800, margin: '0 auto', padding: '20px 16px', minHeight: '100vh',
      background: 'radial-gradient(ellipse at 50% 30%, rgba(255,107,53,0.04) 0%, transparent 60%), #0E0A07',
    }}>

      {/* ── Header ── */}
      <div style={{ marginBottom: 28 }}>
        {/* Top row: logo + settings icon only */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <Logo size={30} />
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 900, color: '#F0E6D3', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            Noteblock
          </h1>
          <button
            onClick={() => navigate('/settings')}
            style={{ background: 'none', border: 'none', color: '#8B6F52', cursor: 'pointer', padding: 8, borderRadius: 8, display: 'flex', alignItems: 'center', flexShrink: 0 }}
            title={t.settings}
          >
            <Settings size={18} />
          </button>
        </div>
        <p style={{ margin: 0, color: '#8B6F52', fontSize: 13, paddingLeft: 40 }}>{profile?.display_name}</p>
      </div>

      {/* ── Venues header ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: '#F0E6D3' }}>{t.myVenues}</h2>
        <button className="btn-primary" onClick={() => { setShowCreate(true); setCreateError(''); }}
          style={{ fontSize: 13, padding: '9px 16px', boxShadow: '0 0 16px rgba(255,107,53,0.35)' }}>
          <Plus size={15} /> {t.createVenue}
        </button>
      </div>

      {/* ── Create form ── */}
      {showCreate && (
        <form onSubmit={createVenue} style={{
          background: '#1A1008', border: '1px solid #FF6B35',
          borderRadius: 10, padding: 16, marginBottom: 20,
          display: 'flex', flexDirection: 'column', gap: 10,
        }}>
          <input className="input" placeholder={t.venueName}
            value={newName} onChange={e => setNewName(e.target.value)} autoFocus required />
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn-primary" type="submit" disabled={creating} style={{ flex: 1 }}>
              {creating ? t.loading : t.createVenue}
            </button>
            <button type="button" className="btn-secondary" onClick={() => setShowCreate(false)} style={{ flex: 1 }}>
              {t.cancel}
            </button>
          </div>
          {createError && <p style={{ margin: 0, color: '#f87171', fontSize: 13 }}>Error: {createError}</p>}
        </form>
      )}

      {loading && <p style={{ color: '#8B6F52', textAlign: 'center' }}>{t.loading}</p>}

      {!loading && venues.length === 0 && (
        <div style={{ textAlign: 'center', color: '#8B6F52', padding: '3rem 0' }}>
          <Home size={48} color="#2A1F17" style={{ marginBottom: 12 }} />
          <p>{t.noVenues}</p>
          <button className="btn-primary" onClick={() => setShowCreate(true)}>
            <Plus size={16} /> {t.createVenue}
          </button>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {venues.map(venue => (
          <VenueCard key={venue.id} venue={venue}
            isMobile={isMobile}
            onManage={() => navigate(`/host/venue/${venue.id}`)}
            showQR={expandedQR === venue.id}
            onToggleQR={() => setExpandedQR(expandedQR === venue.id ? null : venue.id)}
            onStatusChange={updated => setVenues(prev => prev.map(v => v.id === updated.id ? updated : v))}
          />
        ))}
      </div>
      <VersionFooter />
    </div>
  );
}

function VenueCard({ venue, onManage, showQR, onToggleQR, onStatusChange, isMobile }) {
  const { t } = useLang();
  const [toggling, setToggling] = useState(false);

  async function toggleStatus() {
    setToggling(true);
    const newStatus = venue.status === 'active' ? 'closed' : 'active';
    const { data } = await supabase.from('venues').update({ status: newStatus }).eq('id', venue.id).select().single();
    if (data) onStatusChange(data);
    setToggling(false);
  }

  const isActive = venue.status === 'active';

  return (
    <div style={{ background: '#1A1008', border: '1px solid #2A1F17', borderRadius: 12, padding: '20px' }}>
      {/* Venue name + status badge */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <h3 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: '#F0E6D3', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {venue.name}
        </h3>
        <span style={{
          fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 999, flexShrink: 0,
          background: isActive ? 'rgba(52,211,153,0.12)' : '#2A1F17',
          color: isActive ? '#34d399' : '#5A4535',
        }}>
          {isActive ? t.active : t.closed}
        </span>
      </div>

      {/* Room code badge */}
      <div style={{ marginBottom: 16 }}>
        <span style={{
          background: '#2A1F17', color: '#8B6F52', borderRadius: 6,
          padding: '4px 10px', fontFamily: 'monospace', letterSpacing: 2, fontSize: 12,
        }}>
          {venue.room_code}
        </span>
      </div>

      {/* Action buttons — stacked on mobile, side-by-side on desktop */}
      {isMobile ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button className="btn-primary" style={{ width: '100%', fontSize: 14, boxShadow: '0 0 14px rgba(255,107,53,0.35)' }} onClick={onManage}>
            {t.manageVenue}
          </button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn-secondary" style={{ flex: 1, fontSize: 13 }} onClick={toggleStatus} disabled={toggling}>
              {isActive ? t.closeRoom : t.openRoomAction}
            </button>
            <button className="btn-secondary" style={{ padding: '9px 12px', flexShrink: 0 }} onClick={onToggleQR} title="QR Code">
              <QrCode size={15} />
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn-secondary" style={{ padding: '9px 12px', flexShrink: 0 }} onClick={onToggleQR} title="QR Code">
            <QrCode size={15} />
          </button>
          <button className="btn-secondary" style={{ flex: 1, fontSize: 13 }} onClick={toggleStatus} disabled={toggling}>
            {isActive ? t.closeRoom : t.openRoomAction}
          </button>
          <button className="btn-primary" style={{ flex: 1, fontSize: 13, boxShadow: '0 0 14px rgba(255,107,53,0.35)' }} onClick={onManage}>
            {t.manageVenue}
          </button>
        </div>
      )}

      {showQR && (
        <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid #2A1F17', display: 'flex', justifyContent: 'center' }}>
          <VenueQRCode roomCode={venue.room_code} size={180} />
        </div>
      )}
    </div>
  );
}
