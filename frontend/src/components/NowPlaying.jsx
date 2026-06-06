import { useLang } from '../context/LangContext.jsx';

export default function NowPlaying({ nowPlaying, vibeActive }) {
  const { t } = useLang();

  if (!nowPlaying && !vibeActive) return null;

  const isVibe = vibeActive || nowPlaying?.type === 'vibe';
  const title = isVibe ? (nowPlaying?.title ?? 'Vibe') : nowPlaying?.item?.song_title;
  const requester = !isVibe && nowPlaying?.item?.requester_name;

  return (
    <div style={{
      background: 'linear-gradient(135deg, var(--surface) 0%, rgba(99,102,241,0.12) 100%)',
      border: '1px solid var(--border)',
      borderRadius: 12,
      padding: '14px 18px',
      display: 'flex',
      alignItems: 'center',
      gap: 14,
    }}>
      <span style={{ fontSize: 28 }}>{isVibe ? '🎵' : '▶️'}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 2 }}>
          {isVibe ? t.vibeMode : t.nowPlaying}
        </div>
        <div style={{ fontWeight: 700, fontSize: 15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--text)' }}>
          {title}
        </div>
        {requester && (
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {t.requestedBy} {requester}
          </div>
        )}
      </div>
      {/* Animated bars */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 20, flexShrink: 0 }}>
        {[1, 2, 3, 4].map(i => (
          <div
            key={i}
            style={{
              width: 3,
              background: 'var(--accent)',
              borderRadius: 2,
              animation: `bar${i} 0.8s ease-in-out infinite alternate`,
              height: `${[12, 20, 16, 10][i - 1]}px`,
            }}
          />
        ))}
      </div>
    </div>
  );
}
