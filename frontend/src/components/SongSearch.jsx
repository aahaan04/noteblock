import { useState, useCallback, useRef, useEffect } from 'react';
import { Search, Sparkles, ChevronDown } from 'lucide-react';
import { api } from '../lib/api.js';
import { useLang } from '../context/LangContext.jsx';

const PAGE_SIZE = 5;
const decode = s => s?.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&#x27;/g, "'") ?? s;

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
        <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: 'var(--text-secondary)' }}>
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
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: 7,
            color: 'var(--text-primary)',
            fontSize: 15,
            outline: 'none',
            fontFamily: 'inherit',
            transition: 'border-color 0.15s',
          }}
          onFocus={e => e.target.style.borderColor = '#FF6B35'}
          onBlur={e => e.target.style.borderColor = 'var(--border)'}
        />
      </div>

      {loading && (
        <div style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '1rem 0' }}>
          {t.searching}
        </div>
      )}

      {!loading && query && results.length === 0 && (
        <div style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '1rem 0' }}>
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
                padding: '10px', borderRadius: 7, border: '1px dashed var(--border)',
                background: 'transparent', color: 'var(--text-secondary)',
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

      {/* Vibe suggestions — only render when loading or there are results */}
      {vibeDescription && (suggestionsLoading || suggestions.length > 0) && (
        <div style={{ marginTop: query && results.length ? 20 : 0 }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10,
            fontSize: 11, fontWeight: 700, color: 'var(--credits)',
            textTransform: 'uppercase', letterSpacing: '0.06em',
          }}>
            <Sparkles size={13} />
            <span>Suggested for this vibe</span>
          </div>
          {suggestionsLoading && (
            <div style={{ color: 'var(--text-secondary)', fontSize: 13, padding: '8px 0' }}>{t.searching}</div>
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
        background: accent ? 'rgba(200,155,110,0.06)' : 'var(--bg-card)',
        border: `1px solid ${accent ? 'rgba(200,155,110,0.2)' : 'var(--border)'}`,
        borderRadius: 10,
        padding: '10px 14px',
        textAlign: 'left',
        cursor: 'pointer',
        width: '100%',
        transition: 'border-color 0.15s',
      }}
      onMouseEnter={e => e.currentTarget.style.borderColor = '#FF6B35'}
      onMouseLeave={e => e.currentTarget.style.borderColor = accent ? 'rgba(200,155,110,0.2)' : 'var(--border)'}
    >
      {song.thumbnail && (
        <img
          src={song.thumbnail}
          alt=""
          style={{ width: 60, height: 45, objectFit: 'cover', borderRadius: 6, flexShrink: 0 }}
        />
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {decode(song.title)}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
          {decode(song.channel)}
          {song.duration && ` · ${song.duration}`}
        </div>
      </div>
    </button>
  );
}
