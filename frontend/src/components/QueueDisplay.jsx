import { useLang } from '../context/LangContext.jsx';

export default function QueueDisplay({ items, isHost, onRemove, onSkip, nowPlaying }) {
  const { t } = useLang();

  const playing = items.find(i => i.status === 'playing');
  const pending = items.filter(i => i.status === 'pending');

  if (!playing && !pending.length) {
    return (
      <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem 0' }}>
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
      background: 'var(--surface)',
      border: `1px solid ${isQuick ? 'var(--accent)' : 'var(--border)'}`,
      borderRadius: 10,
      padding: '10px 14px',
    }}>
      <span style={{ color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums', minWidth: 20 }}>
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
        <div style={{ fontWeight: 600, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {item.song_title}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {t.requestedBy} {item.requester_name ?? 'Guest'}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        {isQuick && (
          <span style={{
            background: 'var(--accent)',
            color: '#fff',
            fontSize: 10,
            fontWeight: 700,
            padding: '2px 7px',
            borderRadius: 999,
          }}>
            QUICK
          </span>
        )}
        {isHost && (
          <button
            onClick={() => onRemove(item.id)}
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 16 }}
            title={t.removeFromQueue}
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
}
