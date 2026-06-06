import { useState, useCallback, useRef, useEffect } from 'react';
import { Search, Sparkles, ChevronDown } from 'lucide-react';
import { api } from '../lib/api.js';
import { useLang } from '../context/LangContext.jsx';

const PAGE_SIZE = 5;

export default function SongSearch({ bannedIds = new Set(), onSelect, vibeDescription = '' }) {
  const { t } = useLang();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const debounceRef = useRef(null);

  useEffect(() => {
    if (!vibeDescription) return;
    setSuggestionsLoading(true);
    api.youtube.suggestions(vibeDescription)
      .then(data => setSuggestions(data.filter(r => !bannedIds.has(r.videoId))))
      .catch(() => setSuggestions([]))
      .finally(() => setSuggestionsLoading(false));
  }, [vibeDescription]); // eslint-disable-line

  const search = useCallback((q) => {
    clearTimeout(debounceRef.current);
    if (!q.trim()) { setResults([]); setVisibleCount(PAGE_SIZE); return; }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const data = await api.youtube.search(q);
        setResults(data.filter(r => !bannedIds.has(r.videoId)));
        setVisibleCount(PAGE_SIZE);
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

  const visible = results.slice(0, visibleCount);
  const hasMore = results.length > visibleCount;

  return (
    <div>
      {/* Search input */}
      <div style={{ position: 'relative', marginBottom: 12 }}>
        <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: '#8B6F52' }}>
          <Search size={18} />
        </span>
        <input
          type="text"
          value={query}
          onChange={handleChange}
          placeholder={t.searchSongs}
          style={{
            width: '100%', boxSizing: 'border-box',
            paddingLeft: 40, paddingRight: 16, paddingTop: 12, paddingBottom: 12,
            background: '#1A1008',
            border: '1px solid #2A1F17',
            borderRadius: 7,
            color: '#F0E6D3',
            fontSize: 15,
            outline: 'none',
            fontFamily: 'inherit',
            transition: 'border-color 0.15s',
          }}
          onFocus={e => e.target.style.borderColor = '#FF6B35'}
          onBlur={e => e.target.style.borderColor = '#2A1F17'}
        />
      </div>

      {loading && (
        <div style={{ textAlign: 'center', color: '#8B6F52', padding: '1rem 0' }}>
          {t.searching}
        </div>
      )}

      {!loading && query && results.length === 0 && (
        <div style={{ textAlign: 'center', color: '#8B6F52', padding: '1rem 0' }}>
          {t.noResults}
        </div>
      )}

      {!loading && results.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 8 }}>
          {visible.map(r => (
            <SongCard key={r.videoId} song={r} onSelect={onSelect} />
          ))}
          {hasMore && (
            <button
              onClick={() => setVisibleCount(c => c + PAGE_SIZE)}
              style={{
                padding: '10px', borderRadius: 7, border: '1px dashed #2A1F17',
                background: 'transparent', color: '#8B6F52',
                cursor: 'pointer', fontSize: 13, fontWeight: 600,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              }}
            >
              <ChevronDown size={16} />
              Load {Math.min(results.length - visibleCount, PAGE_SIZE)} more results
            </button>
          )}
        </div>
      )}

      {/* Vibe suggestions */}
      {vibeDescription && (
        <div style={{ marginTop: query && results.length ? 20 : 0 }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10,
            fontSize: 11, fontWeight: 700, color: '#C89B6E',
            textTransform: 'uppercase', letterSpacing: '0.06em',
          }}>
            <Sparkles size={13} />
            <span>Suggested for this vibe</span>
          </div>
          {suggestionsLoading && (
            <div style={{ color: '#8B6F52', fontSize: 13, padding: '8px 0' }}>Loading suggestions…</div>
          )}
          {!suggestionsLoading && suggestions.length === 0 && (
            <div style={{ color: '#5A4535', fontSize: 13, padding: '8px 0' }}>No suggestions available</div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {suggestions.map(r => (
              <SongCard key={r.videoId} song={r} onSelect={onSelect} accent />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SongCard({ song, onSelect, accent }) {
  return (
    <button
      onClick={() => onSelect(song)}
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        background: accent ? 'rgba(200,155,110,0.06)' : '#1A1008',
        border: `1px solid ${accent ? 'rgba(200,155,110,0.2)' : '#2A1F17'}`,
        borderRadius: 10,
        padding: '10px 14px',
        textAlign: 'left',
        cursor: 'pointer',
        width: '100%',
        transition: 'border-color 0.15s',
      }}
      onMouseEnter={e => e.currentTarget.style.borderColor = '#FF6B35'}
      onMouseLeave={e => e.currentTarget.style.borderColor = accent ? 'rgba(200,155,110,0.2)' : '#2A1F17'}
    >
      {song.thumbnail && (
        <img
          src={song.thumbnail}
          alt=""
          style={{ width: 60, height: 45, objectFit: 'cover', borderRadius: 6, flexShrink: 0 }}
        />
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 14, color: '#F0E6D3', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {song.title}
        </div>
        <div style={{ fontSize: 12, color: '#8B6F52' }}>
          {song.channel}
          {song.duration && ` · ${song.duration}`}
        </div>
      </div>
    </button>
  );
}
