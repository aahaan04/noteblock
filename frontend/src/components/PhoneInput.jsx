import { useMemo } from 'react';
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

export default function PhoneInput({ country, onCountryChange, value, onChange, autoFocus }) {
  const callingCode = useMemo(() => getCountryCallingCode(country), [country]);
  const selectedName = useMemo(() => COUNTRIES.find(c => c.code === country)?.name ?? country, [country]);

  return (
    <div style={{ display: 'flex', gap: 8 }}>
      {/* min-width: 0 is required here — without it a flex child holding a
          native <select> won't shrink below its content's intrinsic width,
          so a long country name silently pushes the row wider than its
          container instead of truncating, shoving other elements off. */}
      <div style={{ position: 'relative', flex: '0 1 40%', minWidth: 0 }}>
        {/* The native <select>'s own displayed text is made invisible
            (color: transparent) so the closed box can show just the short
            country code below instead of the full name — a native <select>
            has no other way to show different text closed vs. open, since
            the closed box just mirrors the selected <option>'s content.
            The dropdown itself is unaffected: each <option> below has its
            own explicit color set, overriding the inherited transparency,
            so opening it still shows full names exactly as before. */}
        <select
          className="input"
          value={country}
          onChange={e => onCountryChange(e.target.value)}
          title={selectedName}
          style={{
            width: '100%', minWidth: 0, cursor: 'pointer',
            color: 'transparent', WebkitTextFillColor: 'transparent',
          }}
        >
          {COUNTRIES.map(c => (
            <option key={c.code} value={c.code} style={{ color: '#1A1008' }}>{c.name} (+{c.calling})</option>
          ))}
        </select>
        {/* Overlaid short code, shown only in the closed box. pointer-events:
            none so clicks pass through to the actual <select> underneath. */}
        <span style={{
          position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)',
          color: 'var(--text-primary)', fontSize: 15, pointerEvents: 'none',
          textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', maxWidth: 'calc(100% - 34px)',
        }}>
          {country}
        </span>
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
