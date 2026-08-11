import { useEffect, useMemo, useRef, useState } from 'react';
import { getCountries, getCountryCallingCode, parsePhoneNumberFromString } from 'libphonenumber-js';

// Country names come from the browser's own Intl data — no need to bundle or
// hand-maintain a name list alongside libphonenumber-js's metadata.
let regionNames = null;
try { regionNames = new Intl.DisplayNames(['en'], { type: 'region' }); } catch { /* unsupported browser — falls back to the ISO code */ }

// India and the US pinned to the top (most of this app's users are in one of
// the two), everything else alphabetical after them.
const PINNED = ['IN', 'US'];
const COUNTRIES = getCountries()
  .map(code => ({ code, calling: getCountryCallingCode(code), name: regionNames?.of(code) ?? code }))
  .sort((a, b) => a.name.localeCompare(b.name));
COUNTRIES.sort((a, b) => {
  const pa = PINNED.indexOf(a.code), pb = PINNED.indexOf(b.code);
  if (pa !== -1 || pb !== -1) return (pa === -1 ? PINNED.length : pa) - (pb === -1 ? PINNED.length : pb);
  return 0; // already alphabetical from the sort above; Array#sort is stable
});

// E.164 string for the currently entered country + national number, or null
// if what's been typed so far isn't a complete, valid number yet. Uses the
// library's own formatted output rather than hand-concatenating digits —
// some countries (e.g. Italy) keep a leading 0 in the national number even
// in E.164 form, which a naive "+callingCode + digits" concatenation would
// silently get wrong.
export function toE164(country, nationalNumber) {
  if (!nationalNumber) return null;
  const parsed = parsePhoneNumberFromString(nationalNumber, country);
  return parsed?.isValid() ? parsed.number : null;
}

// Custom dropdown rather than a native <select>. A native select was tried
// first (with a CSS trick to show just the short code when closed and full
// names in the open dropdown), but that relied on overriding the select's
// own text color and turned out to render inconsistently across real
// browsers — invisible/blank until hovered on at least one report. Building
// the dropdown outright removes that whole class of risk: full control over
// both the closed and open states, no browser-specific form-control styling
// quirks. Loses the native OS picker on mobile, but a search box (which
// native selects don't get here either) more than makes up for the list
// being 200+ countries long.
export default function PhoneInput({ country, onCountryChange, value, onChange, autoFocus }) {
  const callingCode = useMemo(() => getCountryCallingCode(country), [country]);
  const selected = useMemo(() => COUNTRIES.find(c => c.code === country), [country]);

  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const wrapRef = useRef(null);
  const triggerRef = useRef(null);
  const filterInputRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    function onKey(e) {
      if (e.key === 'Escape') { setOpen(false); triggerRef.current?.focus(); }
    }
    document.addEventListener('mousedown', onDocMouseDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    if (open) { setFilter(''); filterInputRef.current?.focus(); }
  }, [open]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return COUNTRIES;
    return COUNTRIES.filter(c =>
      c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q) || c.calling.includes(q)
    );
  }, [filter]);

  function pick(code) {
    onCountryChange(code);
    setOpen(false);
    triggerRef.current?.focus();
  }

  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <div ref={wrapRef} style={{ position: 'relative', flex: '0 1 40%', minWidth: 0 }}>
        <button
          ref={triggerRef}
          type="button"
          className="input"
          onClick={() => setOpen(o => !o)}
          title={selected?.name ?? country}
          aria-haspopup="listbox"
          aria-expanded={open}
          style={{
            width: '100%', minWidth: 0, cursor: 'pointer', textAlign: 'left',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6,
          }}
        >
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{country}</span>
          <span aria-hidden="true" style={{ fontSize: 10, color: 'var(--text-secondary)', flexShrink: 0 }}>▾</span>
        </button>
        {open && (
          <div role="listbox" style={{
            position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 50,
            width: 260, maxWidth: '90vw', background: 'var(--bg-card)', border: '1px solid var(--border)',
            borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.35)', overflow: 'hidden',
          }}>
            <input
              ref={filterInputRef}
              value={filter}
              onChange={e => setFilter(e.target.value)}
              placeholder="Search country"
              style={{
                width: '100%', boxSizing: 'border-box', padding: '10px 12px', border: 'none',
                borderBottom: '1px solid var(--border)', background: 'transparent', color: 'var(--text-primary)',
                fontSize: 14, outline: 'none', fontFamily: 'inherit',
              }}
            />
            <div style={{ maxHeight: 240, overflowY: 'auto' }}>
              {filtered.length === 0 && (
                <div style={{ padding: '12px 14px', fontSize: 13, color: 'var(--text-secondary)' }}>No matches</div>
              )}
              {filtered.map(c => (
                <div
                  key={c.code}
                  role="option"
                  aria-selected={c.code === country}
                  onClick={() => pick(c.code)}
                  style={{
                    padding: '9px 14px', fontSize: 14, cursor: 'pointer',
                    background: c.code === country ? 'var(--border)' : 'transparent',
                    color: 'var(--text-primary)',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'var(--border)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = c.code === country ? 'var(--border)' : 'transparent'; }}
                >
                  {c.name} (+{c.calling})
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      <div style={{ position: 'relative', flex: '1 1 60%', minWidth: 0 }}>
        <span style={{
          position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)',
          color: 'var(--text-secondary)', fontSize: 15, pointerEvents: 'none',
        }}>
          +{callingCode}
        </span>
        {/* Fixed, generous padding rather than measuring callingCode length —
            country calling codes are at most 3 digits, so this comfortably
            fits all of them without a per-country width calculation. */}
        <input
          className="input"
          type="tel"
          inputMode="numeric"
          placeholder="9999999999"
          value={value}
          onChange={e => onChange(e.target.value.replace(/[^\d\s]/g, ''))}
          autoFocus={autoFocus}
          style={{ paddingLeft: 52, width: '100%' }}
        />
      </div>
    </div>
  );
}
