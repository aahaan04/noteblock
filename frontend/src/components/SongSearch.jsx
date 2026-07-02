import { useState, useCallback, useRef, useEffect } from 'react';
import { Search, Sparkles, ChevronDown, Zap, Coins } from 'lucide-react';
import { api } from '../lib/api.js';
import { useLang } from '../context/LangContext.jsx';
import SongThumb from './SongThumb.jsx';

const PAGE_SIZE = 5;
const decode = s => s?.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&#x27;/g, "'") ?? s;

// `onSelect` (host Ban-Songs picker): tapping a card selects it, caller shows its own confirm UI. Unchanged.
// `onRequest` (guest song request): when provided, each card renders Quick/Normal
// buttons with live pricing that call onRequest(song, playType) directly — no
// intermediate select step. quickPrice/credits/requestingKey are guest-only.
export default function SongSearch({
  bannedIds = new Set(), onSelect, vibeDescription = '',
  onRequest, quickPrice, credits, requestingKey,
}) {
  const { t } = useLang();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const debounceRef  = useRef(null);
  // Ref so the search callback and suggestions filter always see the latest banned set
  // without needing bannedIds in their dependency arrays (which cleared the debounce timer
  // on every ban event, interrupting an in-progress search).
  const bannedIdsRef = useRef(bannedIds);
  useEffect(() => { bannedIdsRef.current = bannedIds; }, [bannedIds]);

  useEffect(() => {
    if (!vibeDescription) return;
    setSuggestionsLoading(true);
    api.youtube.suggestions(vibeDescription)
      .then(data => setSuggestions(data.filter(r => !bannedIdsRef.current.has(r.videoId))))
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
        setResults(data.filter(r => !bannedIdsRef.current.has(r.videoId)));
        setVisibleCount(PAGE_SIZE);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 500);
  }, []); // eslint-disable-line — bannedIds accessed via ref, no timer-clearing on ban events

  const handleChange = (e) => {
    setQuery(e.target.value);
    search(e.target.value);
  };

  const visible = results.slice(0, visibleCount);
  const hasMore = results.length > visibleCount;

  const cardProps = { onSelect, onRequest, quickPrice, credits, requestingKey };

  return (
    <div>
      {/* Search input */}
      <div style={{ position: 'relative', marginBottom: 14 }}>
        <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: 'var(--text-muted)' }}>
          <Search size={16} />
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
            borderRadius: 12,
            color: 'var(--text-primary)',
            fontSize: 14,
            fontWeight: 500,
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
        <div style={{ display: 'flex', flexDirection: 'column', marginBottom: 8 }}>
          {visible.map(r => (
            <SongCard key={r.videoId} song={r} {...cardProps} />
          ))}
          {hasMore && (
            <button
              onClick={() => setVisibleCount(c => c + PAGE_SIZE)}
              style={{
                padding: '10px', borderRadius: 7, border: '1px dashed var(--border)',
                background: 'transparent', color: 'var(--text-secondary)',
                cursor: 'pointer', fontSize: 13, fontWeight: 600, marginTop: 6,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                fontFamily: 'inherit',
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
            fontSize: 11, fontWeight: 800, color: 'var(--credits)',
            textTransform: 'uppercase', letterSpacing: '0.06em',
          }}>
            <Sparkles size={13} />
            <span>Suggested for this vibe</span>
          </div>
          {suggestionsLoading && (
            <div style={{ color: 'var(--text-secondary)', fontSize: 13, padding: '8px 0' }}>{t.searching}</div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {suggestions.map(r => (
              <SongCard key={r.videoId} song={r} accent {...cardProps} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SongCard({ song, onSelect, accent, onRequest, quickPrice, credits, requestingKey }) {
  // Guest request mode: dual Quick/Normal buttons with live pricing, no select step.
  if (onRequest) {
    const normalCost = 2;
    const quickCost = quickPrice ?? 3;
    const canNormal = credits === undefined || credits >= normalCost;
    const canQuick = credits === undefined || credits >= quickCost;
    const normalBusy = requestingKey === `${song.videoId}:normal`;
    const quickBusy = requestingKey === `${song.videoId}:quick`;
    const anyBusy = !!requestingKey;

    return (
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '12px 0', borderBottom: '1px solid var(--bg-card)',
      }}>
        <SongThumb src={song.thumbnail} size={46} radius={10} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', letterSpacing: '-0.1px' }}>
            {decode(song.title)}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 500 }}>
            {decode(song.channel)}
            {song.duration && ` · ${song.duration}`}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0, width: 88 }}>
          <button
            onClick={() => onRequest(song, 'quick')}
            disabled={!canQuick || anyBusy}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              borderRadius: 9, padding: '6px 9px', border: 'none', cursor: canQuick && !anyBusy ? 'pointer' : 'default',
              background: '#FF6B35', boxShadow: canQuick ? '0 0 10px rgba(255,107,53,0.35)' : 'none',
              opacity: !canQuick ? 0.4 : quickBusy ? 0.6 : 1, fontFamily: 'inherit',
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, fontWeight: 700, letterSpacing: 0.2, color: 'rgba(14,10,7,0.75)' }}>
              <Zap size={9} /> QUICK
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 2, fontSize: 12, fontWeight: 800, color: '#0E0A07' }}>
              {quickCost}<Coins size={10} />
            </span>
          </button>
          <button
            onClick={() => onRequest(song, 'normal')}
            disabled={!canNormal || anyBusy}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              borderRadius: 9, padding: '6px 9px',
              background: 'var(--border)', border: '1px solid var(--btn-normal)',
              cursor: canNormal && !anyBusy ? 'pointer' : 'default',
              opacity: !canNormal ? 0.4 : normalBusy ? 0.6 : 1, fontFamily: 'inherit',
            }}
          >
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.2, color: 'var(--text-secondary)' }}>NORMAL</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 2, fontSize: 12, fontWeight: 800, color: 'var(--credits)' }}>
              {normalCost}<Coins size={10} />
            </span>
          </button>
        </div>
      </div>
    );
  }

  // Host Ban-Songs picker mode — unchanged from before.
  return (
    <button
      onClick={() => onSelect(song)}
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        background: accent ? 'rgba(200,155,110,0.06)' : 'var(--bg-card)',
        border: `1px solid ${accent ? 'rgba(200,155,110,0.2)' : 'var(--border)'}`,
        borderRadius: 10,
        padding: '10px 14px',
        marginBottom: 8,
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
          loading="lazy"
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
