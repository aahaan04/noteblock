import { Music, Play } from 'lucide-react';
import { useLang } from '../context/LangContext.jsx';

export default function NowPlaying({ nowPlaying, vibeActive }) {
  const { t } = useLang();

  if (!nowPlaying && !vibeActive) return null;

  const isVibe = vibeActive || nowPlaying?.type === 'vibe';
  const title = isVibe ? (nowPlaying?.title ?? 'Vibe') : nowPlaying?.item?.song_title;
  const requester = !isVibe && nowPlaying?.item?.requester_name;

  return (
    <div style={{
      background: 'linear-gradient(135deg, #1A1008 0%, rgba(255,107,53,0.06) 100%)',
      border: '1px solid #FF6B35',
      borderRadius: 10,
      padding: '14px 18px',
      display: 'flex',
      alignItems: 'center',
      gap: 14,
      boxShadow: '0 0 20px rgba(255,107,53,0.1)',
    }}>
      <div style={{ color: '#FF6B35', flexShrink: 0 }}>
        {isVibe ? <Music size={22} /> : <Play size={22} />}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: '#FF6B35', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 2 }}>
          {isVibe ? t.vibeMode : t.nowPlaying}
        </div>
        <div style={{ fontWeight: 700, fontSize: 15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: '#F0E6D3' }}>
          {title}
        </div>
        {requester && (
          <div style={{ fontSize: 12, color: '#8B6F52' }}>
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
              background: '#FF6B35',
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
