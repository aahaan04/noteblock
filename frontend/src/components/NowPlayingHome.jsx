import { useState, useEffect } from 'react';
import { Disc3, Play, Radio, Pause, Music } from 'lucide-react';
import { useLang } from '../context/LangContext.jsx';

const decode = s => s?.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&#x27;/g, "'") ?? s;

// Full-screen "quick access to now playing" view, reached via the raised
// center button in the bottom nav. Shows a spinning vinyl-record visual with
// the current song's thumbnail as the record label; spins only while playing.
export default function NowPlayingHome({ venue, nowPlaying, vibeActive, vibeTitle, vibeChannel, vibeThumbnail }) {
  const { t } = useLang();
  const [thumbBroken, setThumbBroken] = useState(false);

  const isVibe = vibeActive || nowPlaying?.type === 'vibe';
  const isPlaying = !!(nowPlaying || vibeActive);
  const title = isPlaying ? decode(isVibe ? (nowPlaying?.title ?? vibeTitle ?? t.vibe) : nowPlaying?.item?.song_title) : null;
  const requester = isPlaying && !isVibe && nowPlaying?.item?.requester_name;
  const channel = isPlaying && isVibe ? vibeChannel : null;
  const thumbnail = isPlaying ? (isVibe ? vibeThumbnail : nowPlaying?.item?.thumbnail_url) : null;

  useEffect(() => { setThumbBroken(false); }, [thumbnail]);

  if (venue?.jukebox_paused) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '60px 24px', textAlign: 'center', minHeight: 360 }}>
        <div style={{
          width: 220, height: 220, borderRadius: '50%', flexShrink: 0,
          background: 'var(--bg-card)', border: '2px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 24,
        }}>
          <Pause size={40} color="var(--text-muted)" />
        </div>
        <div style={{ fontWeight: 800, fontSize: 17, color: 'var(--text-primary)', marginBottom: 6 }}>{t.jukeboxOff}</div>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', maxWidth: 260 }}>{t.jukeboxOffMsg}</div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '48px 24px 24px', textAlign: 'center', minHeight: 380 }}>
      <div style={{
        width: 232, height: 232, borderRadius: '50%', flexShrink: 0, position: 'relative',
        background: 'repeating-radial-gradient(circle, var(--bg-card) 0px, var(--bg-card) 3px, var(--border) 4px)',
        border: '2px solid var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: isPlaying ? '0 0 44px rgba(255,107,53,0.18)' : 'none',
        animation: isPlaying ? 'vinylSpin 7s linear infinite' : 'none',
        marginBottom: 26,
      }}>
        <div style={{
          width: '40%', height: '40%', borderRadius: '50%', overflow: 'hidden',
          border: '4px solid var(--bg-app)', background: 'var(--bg-app)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          {thumbnail && !thumbBroken ? (
            <img src={thumbnail} alt="" onError={() => setThumbBroken(true)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <Music size={28} color={isPlaying ? '#FF6B35' : 'var(--text-muted)'} />
          )}
        </div>
        {/* Spindle dot */}
        <div style={{ position: 'absolute', width: 8, height: 8, borderRadius: '50%', background: 'var(--bg-app)' }} />
      </div>

      {isPlaying ? (
        <>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8,
            fontSize: 11, fontWeight: 700, letterSpacing: 1,
            color: isVibe ? 'var(--text-secondary)' : '#FF6B35',
          }}>
            {!isVibe && <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#FF6B35', animation: 'npPulse 1.2s infinite' }} />}
            {isVibe ? <><Radio size={11} /> {t.vibe}</> : <><Play size={11} /> {t.nowPlaying}</>}
          </div>
          <div style={{ fontWeight: 800, fontSize: 19, color: 'var(--text-primary)', maxWidth: 320, letterSpacing: '-0.3px', marginBottom: 6 }}>
            {title}
          </div>
          {requester && <div style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 500 }}>{t.requestedBy} {requester}</div>}
          {channel && <div style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 500 }}>{channel}</div>}
        </>
      ) : (
        <>
          <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--text-secondary)', marginBottom: 4 }}>Nothing playing yet</div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Search for a song to get the party started</div>
        </>
      )}

      <style>{`
        @keyframes vinylSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes npPulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
      `}</style>
    </div>
  );
}
