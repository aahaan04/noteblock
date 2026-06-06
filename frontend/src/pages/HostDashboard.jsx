import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Music, Settings, LogOut, Plus, QrCode, ChevronUp, ChevronDown, Home } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useLang } from '../context/LangContext.jsx';
import { supabase } from '../lib/supabase.js';
import VenueQRCode from '../components/VenueQRCode.jsx';

function makeRoomCode() {
  return Math.random().toString(36).slice(2, 6).toUpperCase() +
         Math.random().toString(36).slice(2, 6).toUpperCase();
}

export default function HostDashboard() {
  const { profile, user, signOut } = useAuth();
  const { t } = useLang();
  const navigate = useNavigate();

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
    <div style={{ maxWidth: 800, margin: '0 auto', padding: '24px 16px', minHeight: '100vh', background: '#0E0A07' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 32 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Music size={26} color="#FF6B35" />
            <h1 style={{ margin: 0, fontSize: 24, fontWeight: 900, color: '#F0E6D3' }}>Noteblock</h1>
          </div>
          <p style={{ margin: '4px 0 0', color: '#8B6F52', fontSize: 14 }}>{profile?.display_name}</p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn-secondary" onClick={() => navigate('/settings')} style={{ fontSize: 13 }}>
            <Settings size={15} /> {t.settings}
          </button>
          <button className="btn-secondary" onClick={signOut} style={{ fontSize: 13 }}>
            <LogOut size={15} /> {t.logout}
          </button>
        </div>
      </div>

      {/* Venues header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 20, color: '#F0E6D3' }}>{t.myVenues}</h2>
        <button className="btn-primary" onClick={() => { setShowCreate(true); setCreateError(''); }}>
          <Plus size={16} /> {t.createVenue}
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <form onSubmit={createVenue} style={{
          background: '#1A1008', border: '1px solid #FF6B35',
          borderRadius: 10, padding: 20, marginBottom: 20,
          display: 'flex', flexDirection: 'column', gap: 10,
        }}>
          <div style={{ display: 'flex', gap: 10 }}>
            <input className="input" style={{ flex: 1 }} placeholder={t.venueName}
              value={newName} onChange={e => setNewName(e.target.value)} autoFocus required />
            <button className="btn-primary" type="submit" disabled={creating}>
              {creating ? t.loading : t.createVenue}
            </button>
            <button type="button" className="btn-secondary" onClick={() => setShowCreate(false)}>{t.cancel}</button>
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

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {venues.map(venue => (
          <VenueCard key={venue.id} venue={venue}
            onManage={() => navigate(`/host/venue/${venue.id}`)}
            showQR={expandedQR === venue.id}
            onToggleQR={() => setExpandedQR(expandedQR === venue.id ? null : venue.id)}
            onStatusChange={updated => setVenues(prev => prev.map(v => v.id === updated.id ? updated : v))}
          />
        ))}
      </div>
    </div>
  );
}

function VenueCard({ venue, onManage, showQR, onToggleQR, onStatusChange }) {
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
    <div style={{ background: '#1A1008', border: '1px solid #2A1F17', borderRadius: 10, padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <h3 style={{ margin: 0, fontSize: 18, color: '#F0E6D3', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {venue.name}
            </h3>
            <span style={{
              fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999, flexShrink: 0,
              background: isActive ? 'rgba(52,211,153,0.12)' : 'rgba(248,113,113,0.12)',
              color: isActive ? '#34d399' : '#f87171',
            }}>
              {isActive ? t.active : t.closed}
            </span>
          </div>
          <div style={{ fontSize: 13, color: '#5A4535', fontFamily: 'monospace', letterSpacing: 2 }}>
            {venue.room_code}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <button className="btn-secondary" style={{ fontSize: 12 }} onClick={onToggleQR}>
            <QrCode size={14} /> {showQR ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
          <button className="btn-secondary" style={{ fontSize: 12 }} onClick={toggleStatus} disabled={toggling}>
            {isActive ? t.closeRoom : t.openRoomAction}
          </button>
          <button className="btn-primary" style={{ fontSize: 12 }} onClick={onManage}>
            {t.manageVenue}
          </button>
        </div>
      </div>

      {showQR && (
        <div style={{ marginTop: 20, paddingTop: 20, borderTop: '1px solid #2A1F17', display: 'flex', justifyContent: 'center' }}>
          <VenueQRCode roomCode={venue.room_code} size={180} />
        </div>
      )}
    </div>
  );
}
