import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Settings, Plus, QrCode, Home, Users, ListMusic, Radio } from 'lucide-react';

const HOST_FONT = "'Manrope', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

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
  const [queueCounts, setQueueCounts] = useState({});  // venueId -> pending queue count
  const [onlineCounts, setOnlineCounts] = useState({}); // venueId -> live connected guest count

  useEffect(() => {
    if (user) loadVenues();
  }, [user]);

  async function loadVenues() {
    setLoading(true);
    const { data, error } = await supabase
      .from('venues')
      .select('id, host_id, name, room_code, status, vibe_mode_enabled')
      .eq('host_id', user.id)
      .order('created_at', { ascending: false });
    if (!error) setVenues(data ?? []);
    setLoading(false);
  }

  const venueIdsKey = venues.map(v => v.id).join(',');

  // Live pending-queue count per venue, kept fresh via realtime subscription.
  useEffect(() => {
    if (!venues.length) return;
    let cancelled = false;
    async function loadQueueCounts() {
      const { data } = await supabase
        .from('queue_items')
        .select('venue_id')
        .in('venue_id', venues.map(v => v.id))
        .eq('status', 'pending');
      if (cancelled) return;
      const counts = {};
      for (const row of data ?? []) counts[row.venue_id] = (counts[row.venue_id] ?? 0) + 1;
      setQueueCounts(counts);
    }
    loadQueueCounts();
    const sub = supabase
      .channel('host-dashboard-queue-counts')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'queue_items' }, () => loadQueueCounts())
      .subscribe();
    return () => { cancelled = true; supabase.removeChannel(sub); };
  }, [venueIdsKey]); // eslint-disable-line

  // Live connected-guest count per venue via Supabase Presence (same channel
  // naming convention used in GuestRoom/VenueControl's Users tab).
  useEffect(() => {
    if (!venues.length) return;
    const channels = venues.map(v => {
      const ch = supabase.channel(`presence-${v.id}`);
      const sync = () => {
        const state = ch.presenceState();
        const all = Object.values(state).flat();
        const seen = new Set();
        const unique = all.filter(p => { if (seen.has(p.name)) return false; seen.add(p.name); return true; });
        setOnlineCounts(prev => ({ ...prev, [v.id]: unique.length }));
      };
      ch.on('presence', { event: 'sync' }, sync)
        .on('presence', { event: 'join' }, sync)
        .on('presence', { event: 'leave' }, sync)
        .subscribe();
      return ch;
    });
    return () => channels.forEach(ch => supabase.removeChannel(ch));
  }, [venueIdsKey]); // eslint-disable-line

  async function createVenue(e) {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    setCreateError('');
    const { data, error } = await supabase
      .from('venues')
      .insert({ host_id: user.id, name: newName.trim(), room_code: makeRoomCode(), welcome_credits: 10, crossfade_duration_seconds: 5 })
      .select('id, host_id, name, room_code, status, vibe_mode_enabled').single();
    if (error) { setCreateError(error.message); } else {
      setVenues(prev => [data, ...prev]);
      setNewName(''); setShowCreate(false);
    }
    setCreating(false);
  }

  const activeCount = venues.filter(v => v.status === 'active').length;

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-page)', fontFamily: HOST_FONT }}>
      {/* ── Top bar ── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: isMobile ? '14px 16px' : '18px 28px',
        background: 'var(--bg-card)', borderBottom: '1px solid var(--border)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          <Logo size={30} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.3px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              Noteblock
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 500 }}>{profile?.display_name}</div>
          </div>
        </div>
        <button
          onClick={() => navigate('/settings')}
          style={{ width: 36, height: 36, borderRadius: 10, border: 'none', background: 'var(--border)', color: 'var(--text-primary)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
          title={t.settings}
        >
          <Settings size={16} />
        </button>
      </div>

      {/* ── Body ── */}
      <div style={{
        padding: isMobile ? '24px 16px' : '40px 48px',
        background: 'radial-gradient(ellipse at 50% 0%, rgba(255,107,53,0.05) 0%, transparent 55%), var(--bg-page)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28, flexWrap: 'wrap', gap: 14 }}>
          <div>
            <div style={{ fontSize: isMobile ? 22 : 26, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.5px' }}>{t.myVenues}</div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 3, fontWeight: 500 }}>
              {venues.length} {venues.length === 1 ? 'venue' : 'venues'} · {activeCount} active
            </div>
          </div>
          <button
            className="primary-btn-host"
            onClick={() => { setShowCreate(true); setCreateError(''); }}
            style={{
              background: '#FF6B35', border: 'none', borderRadius: 9, padding: '11px 18px',
              fontSize: 13, fontWeight: 800, color: '#0E0A07', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 6,
              boxShadow: '0 0 16px rgba(255,107,53,0.35)', fontFamily: 'inherit',
            }}
          >
            <Plus size={15} /> {t.createVenue}
          </button>
        </div>

        {/* ── Create form ── */}
        {showCreate && (
          <form onSubmit={createVenue} style={{
            background: 'var(--bg-card)', border: '1px solid #FF6B35',
            borderRadius: 14, padding: 18, marginBottom: 24,
            display: 'flex', flexDirection: 'column', gap: 12,
          }}>
            <input className="input" placeholder={t.venueName}
              value={newName} onChange={e => setNewName(e.target.value)} autoFocus required />
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn-primary" type="submit" disabled={creating} style={{ flex: 1 }}>
                {creating ? t.loading : t.createVenue}
              </button>
              <button type="button" className="btn-secondary" onClick={() => setShowCreate(false)} style={{ flex: 1, height: 52 }}>
                {t.cancel}
              </button>
            </div>
            {createError && <p style={{ margin: 0, color: '#f87171', fontSize: 13 }}>Error: {createError}</p>}
          </form>
        )}

        {loading && <p style={{ color: 'var(--text-secondary)', textAlign: 'center' }}>{t.loading}</p>}

        {!loading && venues.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '3rem 0' }}>
            <Home size={48} color="var(--border)" style={{ marginBottom: 12 }} />
            <p>{t.noVenues}</p>
            <button className="btn-primary" onClick={() => setShowCreate(true)}>
              <Plus size={16} /> {t.createVenue}
            </button>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(320px, 1fr))', gap: 18 }}>
          {venues.map(venue => (
            <VenueCard key={venue.id} venue={venue}
              isMobile={isMobile}
              queueCount={queueCounts[venue.id] ?? 0}
              onlineCount={onlineCounts[venue.id] ?? 0}
              onManage={() => navigate(`/host/venue/${venue.id}`)}
              showQR={expandedQR === venue.id}
              onToggleQR={() => setExpandedQR(expandedQR === venue.id ? null : venue.id)}
              onStatusChange={updated => setVenues(prev => prev.map(v => v.id === updated.id ? updated : v))}
            />
          ))}
        </div>
        <VersionFooter />
      </div>
    </div>
  );
}

function VenueCard({ venue, onManage, showQR, onToggleQR, onStatusChange, isMobile, queueCount, onlineCount }) {
  const { t } = useLang();
  const [toggling, setToggling] = useState(false);

  async function toggleStatus() {
    setToggling(true);
    const newStatus = venue.status === 'active' ? 'closed' : 'active';
    const { data } = await supabase.from('venues').update({ status: newStatus }).eq('id', venue.id).select('id, host_id, name, room_code, status, vibe_mode_enabled').single();
    if (data) onStatusChange(data);
    setToggling(false);
  }

  const isActive = venue.status === 'active';
  const statPillStyle = { display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600 };

  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16, padding: 22 }}>
      {/* Venue name + status badge */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 19, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 6, letterSpacing: '-0.3px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {venue.name}
          </div>
          <span style={{
            display: 'inline-block', fontFamily: 'monospace', fontSize: 11, fontWeight: 700, letterSpacing: 1.5,
            background: 'var(--border)', color: 'var(--text-secondary)', borderRadius: 6, padding: '4px 9px',
          }}>
            {venue.room_code}
          </span>
        </div>
        {isActive ? (
          <span style={{
            display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0,
            background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.3)',
            borderRadius: 20, padding: '6px 12px', fontSize: 12, fontWeight: 700, color: '#4ADE80',
          }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#4ADE80' }} />
            {t.active}
          </span>
        ) : (
          <span style={{ flexShrink: 0, background: 'var(--border)', color: 'var(--text-muted)', borderRadius: 20, padding: '6px 12px', fontSize: 12, fontWeight: 700 }}>
            {t.closed}
          </span>
        )}
      </div>

      {/* Live stat row */}
      <div style={{ display: 'flex', gap: 16, margin: '14px 0 18px', flexWrap: 'wrap' }}>
        <span style={statPillStyle}><Users size={13} /> {onlineCount} guests</span>
        <span style={statPillStyle}><ListMusic size={13} /> {queueCount} queued</span>
        <span style={statPillStyle}><Radio size={13} /> Vibe {venue.vibe_mode_enabled ? 'on' : 'off'}</span>
      </div>

      {/* Action buttons — stacked on mobile, side-by-side on desktop */}
      {isMobile ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button className="btn-primary" style={{ width: '100%', height: 52, fontSize: 14, boxShadow: '0 0 14px rgba(255,107,53,0.35)' }} onClick={onManage}>
            {t.manageVenue}
          </button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn-secondary" style={{ flex: 1, height: 52, fontSize: 13 }} onClick={toggleStatus} disabled={toggling}>
              {isActive ? t.closeRoom : t.openRoomAction}
            </button>
            <button className="btn-secondary" style={{ width: 52, height: 52, flexShrink: 0, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onToggleQR} title="QR Code">
              <QrCode size={15} />
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn-secondary" style={{ flex: 1, height: 44, fontSize: 13 }} onClick={toggleStatus} disabled={toggling}>
            {isActive ? t.closeRoom : t.openRoomAction}
          </button>
          <button className="btn-primary" style={{ flex: 1, height: 44, fontSize: 13, boxShadow: '0 0 14px rgba(255,107,53,0.35)' }} onClick={onManage}>
            {t.manageVenue}
          </button>
          <button className="btn-secondary" style={{ width: 44, height: 44, flexShrink: 0, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onToggleQR} title="QR Code">
            <QrCode size={15} />
          </button>
        </div>
      )}

      {showQR && (
        <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'center' }}>
          <VenueQRCode roomCode={venue.room_code} size={180} />
        </div>
      )}
    </div>
  );
}
