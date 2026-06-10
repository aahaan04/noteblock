import { Music, Play, Radio } from 'lucide-react';
import { useLang } from '../context/LangContext.jsx';

const decode = s => s?.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&#x27;/g, "'") ?? s;

export default function NowPlaying({ nowPlaying, vibeActive }) {
  const { t } = useLang();

  if (!nowPlaying && !vibeActive) return null;

  const isVibe = vibeActive || nowPlaying?.type === 'vibe';
  const title = decode(isVibe ? (nowPlaying?.title ?? 'Vibe') : nowPlaying?.item?.song_title);
  const requester = !isVibe && nowPlaying?.item?.requester_name;

  return (
    <div style={{
      background: isVibe
        ? '#1A1008'
        : 'linear-gradient(135deg, #1A1008 0%, rgba(255,107,53,0.06) 100%)',
      border: isVibe ? '1px solid #2A1F17' : '1px solid #FF6B35',
      borderRadius: 10,
      padding: '12px 16px',
      display: 'flex',
      alignItems: 'center',
      gap: 14,
      boxShadow: isVibe ? 'none' : '0 0 20px rgba(255,107,53,0.1)',
    }}>
      <div style={{ color: isVibe ? '#8B6F52' : '#FF6B35', flexShrink: 0 }}>
        {isVibe ? <Radio size={20} /> : <Play size={14} />}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 10, fontWeight: 700, letterSpacing: 2,
          color: isVibe ? '#8B6F52' : '#FF6B35',
          textTransform: 'uppercase', marginBottom: 2,
          display: 'flex', alignItems: 'center', gap: 4,
        }}>
          {isVibe ? (
            <><Radio size={10} /> VIBE</>
          ) : (
            <><Play size={10} /> NOW PLAYING</>
          )}
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
