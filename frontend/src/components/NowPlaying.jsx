import { Music, Play, Radio } from 'lucide-react';
import { useLang } from '../context/LangContext.jsx';

const decode = s => s?.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&#x27;/g, "'") ?? s;

export default function NowPlaying({ nowPlaying, vibeActive, vibeTitle, vibeChannel }) {
  const { t } = useLang();

  if (!nowPlaying && !vibeActive) return null;

  const isVibe = vibeActive || nowPlaying?.type === 'vibe';
  const title = decode(isVibe ? (nowPlaying?.title ?? vibeTitle ?? t.vibe) : nowPlaying?.item?.song_title);
  const requester = !isVibe && nowPlaying?.item?.requester_name;
  const channel = isVibe ? vibeChannel : null;

  return (
    <div style={{
      background: isVibe
        ? 'var(--bg-card)'
        : 'linear-gradient(135deg, var(--bg-card) 0%, rgba(255,107,53,0.06) 100%)',
      border: isVibe ? '1px solid var(--border)' : '1px solid #FF6B35',
      borderRadius: 10,
      padding: '12px 16px',
      display: 'flex',
      alignItems: 'center',
      gap: 14,
      boxShadow: isVibe ? 'none' : '0 0 20px rgba(255,107,53,0.1)',
    }}>
      <div style={{ color: isVibe ? 'var(--text-secondary)' : '#FF6B35', flexShrink: 0 }}>
        {isVibe ? <Radio size={20} /> : <Play size={14} />}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Label row — no uppercase transform so Hindi/Chinese render correctly */}
        <div style={{
          fontSize: 10, fontWeight: 700, letterSpacing: 1,
          color: isVibe ? 'var(--text-secondary)' : '#FF6B35',
          marginBottom: 2,
          display: 'flex', alignItems: 'center', gap: 4,
        }}>
          {isVibe ? (
            <><Radio size={10} /> {t.vibe}</>
          ) : (
            <><Play size={10} /> {t.nowPlaying}</>
          )}
        </div>
        <div style={{ fontWeight: 700, fontSize: 15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--text-primary)' }}>
          {title}
        </div>
        {requester && (
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            {t.requestedBy} {requester}
          </div>
        )}
        {channel && (
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            {channel}
          </div>
        )}
      </div>
      {/* Animated bars — only for non-vibe */}
      {!isVibe && (
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
      )}
    </div>
  );
}
