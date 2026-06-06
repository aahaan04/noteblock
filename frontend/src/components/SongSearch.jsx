import { useState, useCallback, useRef } from 'react';
import { api } from '../lib/api.js';
import { useLang } from '../context/LangContext.jsx';

export default function SongSearch({ venueId, bannedIds = new Set(), onSelect }) {
  const { t } = useLang();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef(null);

  const search = useCallback((q) => {
    clearTimeout(debounceRef.current);
    if (!q.trim()) { setResults([]); return; }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const data = await api.youtube.search(q);
        setResults(data.filter(r => !bannedIds.has(r.videoId)));
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 500);
  }, [bannedIds]);

  const handleChange = (e) => {
    setQuery(e.target.value);
    search(e.target.value);
  };

  return (
    <div>
      <div style={{ position: 'relative', marginBottom: 12 }}>
        <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 18, pointerEvents: 'none' }}>
          🔍
        </span>
        <input
          type="text"
          value={query}
          onChange={handleChange}
          placeholder={t.searchSongs}
          style={{
            width: '100%', boxSizing: 'border-box',
            paddingLeft: 40, paddingRight: 16, paddingTop: 12, paddingBottom: 12,
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            color: 'var(--text)',
            fontSize: 15,
            outline: 'none',
          }}
        />
      </div>

      {loading && (
        <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '1rem 0' }}>
          {t.searching}
        </div>
      )}

      {!loading && query && results.length === 0 && (
        <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '1rem 0' }}>
          {t.noResults}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {results.map(r => (
          <SongCard key={r.videoId} song={r} onSelect={onSelect} />
        ))}
      </div>
    </div>
  );
}

function SongCard({ song, onSelect }) {
  return (
    <button
      onClick={() => onSelect(song)}
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        padding: '10px 14px',
        textAlign: 'left',
        cursor: 'pointer',
        width: '100%',
        transition: 'border-color 0.15s',
      }}
      onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--accent)'}
      onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
    >
      {song.thumbnail && (
        <img
          src={song.thumbnail}
          alt=""
          style={{ width: 60, height: 45, objectFit: 'cover', borderRadius: 6, flexShrink: 0 }}
        />
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontWeight: 600, fontSize: 14,
          color: 'var(--text)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {song.title}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {song.channel}
          {song.duration && ` · ${song.duration}`}
        </div>
      </div>
    </button>
  );
}
