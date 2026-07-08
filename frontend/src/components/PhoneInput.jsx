import { useMemo } from 'react';
import { getCountries, getCountryCallingCode, parsePhoneNumberFromString } from 'libphonenumber-js';

// Country names come from the browser's own Intl data — no need to bundle or
// hand-maintain a name list alongside libphonenumber-js's metadata.
let regionNames = null;
try { regionNames = new Intl.DisplayNames(['en'], { type: 'region' }); } catch { /* unsupported browser — falls back to the ISO code */ }

const COUNTRIES = getCountries()
  .map(code => ({ code, calling: getCountryCallingCode(code), name: regionNames?.of(code) ?? code }))
  .sort((a, b) => a.name.localeCompare(b.name));

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

  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <select
        className="input"
        value={country}
        onChange={e => onCountryChange(e.target.value)}
        style={{ flex: '0 0 130px', width: 130, cursor: 'pointer' }}
      >
        {COUNTRIES.map(c => (
          <option key={c.code} value={c.code}>{c.name} (+{c.calling})</option>
        ))}
      </select>
      <div style={{ position: 'relative', flex: 1 }}>
        <span style={{
          position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)',
          color: 'var(--text-secondary)', fontSize: 15, pointerEvents: 'none',
        }}>
          +{callingCode}
        </span>
        <input
          className="input"
          type="tel"
          inputMode="numeric"
          placeholder="98765 43210"
          value={value}
          onChange={e => onChange(e.target.value.replace(/[^\d\s]/g, ''))}
          autoFocus={autoFocus}
          style={{ paddingLeft: 16 + callingCode.length * 9 + 12 }}
        />
      </div>
    </div>
  );
}
