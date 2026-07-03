import { memo } from 'react';
import { X, ListMusic } from 'lucide-react';
import { useLang } from '../context/LangContext.jsx';
import SongThumb from './SongThumb.jsx';

const decode = s => s?.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&#x27;/g, "'") ?? s;

// Memoised: skips re-renders when parent re-renders but item data hasn't changed
// (e.g. when a song's play-position/volume changes inside CrossfadePlayer).
const QueueItem = memo(function QueueItem({ item, position, isHost, onRemove }) {
  const { t } = useLang();
  const isQuick = item.play_type === 'quick';

  // Host queue tab (VenueControl).
  if (isHost) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', gap: 14,
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        padding: '12px 14px',
      }}>
        <span style={{ color: 'var(--text-muted)', fontWeight: 800, minWidth: 20, textAlign: 'center', fontSize: 14 }}>
          {position}
        </span>
        <SongThumb src={item.thumbnail_url} size={46} radius={8} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--text-primary)' }}>
            {decode(item.song_title)}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 500, marginTop: 2 }}>
            {t.requestedBy} {decode(item.requester_name) ?? 'Guest'}
          </div>
        </div>
        {isQuick ? (
          <span style={{
            background: '#FF6B35', color: '#0E0A07',
            fontSize: 10, fontWeight: 800, padding: '4px 9px', borderRadius: 6,
            boxShadow: '0 0 8px rgba(255,107,53,0.3)', flexShrink: 0,
          }}>
            Quick
          </span>
        ) : (
          <span style={{
            background: 'var(--border)', color: 'var(--credits)', border: '1px solid #3D2B1A',
            fontSize: 10, fontWeight: 800, padding: '4px 9px', borderRadius: 6, flexShrink: 0,
          }}>
            Normal
          </span>
        )}
        <button
          onClick={() => onRemove(item.id)}
          style={{ width: 32, height: 32, borderRadius: 8, border: 'none', background: 'var(--border)', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
          title={t.removeFromQueue}
        >
          <X size={14} />
        </button>
      </div>
    );
  }

  // Guest queue tab — list row with position number, thumbnail, and a play-type badge.
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderBottom: '1px solid var(--bg-card)' }}>
      <span style={{ color: 'var(--text-muted)', fontWeight: 800, width: 18, textAlign: 'center', flexShrink: 0, fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
        {position}
      </span>
      <SongThumb src={item.thumbnail_url} size={44} radius={8} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--text-primary)' }}>
          {decode(item.song_title)}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 500 }}>
          {t.requestedBy} {decode(item.requester_name) ?? 'Guest'}
        </div>
      </div>
      {isQuick ? (
        <span style={{ borderRadius: 6, padding: '3px 8px', fontSize: 10, fontWeight: 800, flexShrink: 0, background: '#FF6B35', color: '#0E0A07', boxShadow: '0 0 8px rgba(255,107,53,0.3)' }}>
          QUICK
        </span>
      ) : (
        <span style={{ borderRadius: 6, padding: '3px 8px', fontSize: 10, fontWeight: 800, flexShrink: 0, background: 'var(--border)', color: 'var(--credits)', border: '1px solid var(--btn-normal)' }}>
          NORMAL
        </span>
      )}
    </div>
  );
});

// Memoised: only re-renders when the queue array reference changes (i.e. after a
// real-time queue fetch), not on unrelated VenueControl/GuestRoom state updates
// such as nowPlaying, venue, or vibeActive changing.
export default memo(function QueueDisplay({ items, isHost, onRemove }) {
  const { t } = useLang();

  const pending = items.filter(i => i.status === 'pending');

  if (!pending.length) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: isHost ? '90px 20px' : '2rem 0', textAlign: 'center' }}>
        <ListMusic size={48} color="var(--border)" style={{ marginBottom: 16 }} />
        <div style={{ color: 'var(--text-muted)', fontSize: 14, fontWeight: 600 }}>{t.emptyQueue}</div>
      </div>
    );
  }

  return (
    <div style={isHost ? { display: 'flex', flexDirection: 'column', gap: 8 } : { display: 'flex', flexDirection: 'column' }}>
      {pending.map((item, idx) => (
        <QueueItem
          key={item.id}
          item={item}
          position={idx + 1}
          isHost={isHost}
          onRemove={onRemove}
        />
      ))}
    </div>
  );
});
