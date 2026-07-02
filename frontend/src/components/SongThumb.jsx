import { useState } from 'react';
import { Music } from 'lucide-react';

// Shared thumbnail renderer: real image with object-fit cover, or a muted
// placeholder box with a music-note icon if there's no src or it fails to load.
export default function SongThumb({ src, size = 48, radius = 8, iconRatio = 0.42 }) {
  const [broken, setBroken] = useState(false);

  if (!src || broken) {
    return (
      <div style={{
        width: size, height: size, borderRadius: radius, flexShrink: 0,
        background: 'var(--bg-card)', border: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Music size={Math.round(size * iconRatio)} color="var(--text-muted)" />
      </div>
    );
  }

  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      onError={() => setBroken(true)}
      style={{ width: size, height: size, objectFit: 'cover', borderRadius: radius, flexShrink: 0, display: 'block' }}
    />
  );
}
