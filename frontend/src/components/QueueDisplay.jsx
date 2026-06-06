import { Zap, X } from 'lucide-react';
import { useLang } from '../context/LangContext.jsx';

export default function QueueDisplay({ items, isHost, onRemove, onSkip, nowPlaying }) {
  const { t } = useLang();

  const pending = items.filter(i => i.status === 'pending');

  if (!pending.length) {
    return (
      <div style={{ textAlign: 'center', color: '#8B6F52', padding: '2rem 0' }}>
        {t.emptyQueue}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
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
}

function QueueItem({ item, position, isHost, onRemove }) {
  const { t } = useLang();
  const isQuick = item.play_type === 'quick';

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      background: '#1A1008',
      border: `1px solid ${isQuick ? '#FF6B35' : '#2A1F17'}`,
      borderRadius: 10,
      padding: '10px 14px',
      boxShadow: isQuick ? '0 0 10px rgba(255,107,53,0.12)' : 'none',
    }}>
      <span style={{ color: '#5A4535', fontVariantNumeric: 'tabular-nums', minWidth: 20, fontSize: 13 }}>
        {position}
      </span>
      {item.thumbnail_url && (
        <img
          src={item.thumbnail_url}
          alt=""
          style={{ width: 48, height: 36, objectFit: 'cover', borderRadius: 4, flexShrink: 0 }}
        />
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: '#F0E6D3' }}>
          {item.song_title}
        </div>
        <div style={{ fontSize: 12, color: '#8B6F52' }}>
          {t.requestedBy} {item.requester_name ?? 'Guest'}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        {isQuick && (
          <span style={{
            background: '#FF6B35',
            color: '#F0E6D3',
            fontSize: 10,
            fontWeight: 700,
            padding: '2px 7px',
            borderRadius: 999,
            display: 'flex',
            alignItems: 'center',
            gap: 3,
          }}>
            <Zap size={10} /> QUICK
          </span>
        )}
        {isHost && (
          <button
            onClick={() => onRemove(item.id)}
            style={{ background: 'none', border: 'none', color: '#5A4535', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: 4, borderRadius: 4 }}
            title={t.removeFromQueue}
          >
            <X size={16} />
          </button>
        )}
      </div>
    </div>
  );
}
