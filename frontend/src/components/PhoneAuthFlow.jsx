import { useState, useEffect, useRef } from 'react';
import { MessageSquare } from 'lucide-react';
import PhoneInput, { toE164 } from './PhoneInput.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useLang } from '../context/LangContext.jsx';
import { api } from '../lib/api.js';
import { supabase } from '../lib/supabase.js';

const RESEND_COOLDOWN_SECS = 30;

// The backend attaches stage/detail to 500s from the verify endpoint so a
// failure is reportable straight from the screen, no server log access
// needed. Safe to show: detail only ever appears after the phone number has
// already passed Twilio's own OTP check, so this isn't an open information
// disclosure surface.
function describeError(err, fallback) {
  const data = err?.data ?? {};
  const base = data.error ?? err?.message ?? fallback;
  if (data.stage) return `${base} (${data.stage}${data.detail ? `: ${data.detail}` : ''})`;
  return base;
}

// Shared phone-number -> SMS OTP -> (display name, for new accounts)
// flow, used by the host login screen, the guest join screen, and the
// "link your phone" prompt for pre-existing email-only accounts. Callers own
// all page chrome (header, back button, navigation after completion) — this
// component only renders the form and drives the three phases via useAuth().
//
// props:
//   role     — 'host' to tag brand-new accounts as hosts; omit for guests
//   linking  — true when attaching a phone to the CURRENT session instead of
//              logging in fresh (no new session is issued in that case)
//   onDone   — ({ isNewUser }) => void, called once the whole flow succeeds
export default function PhoneAuthFlow({ role, linking = false, onDone }) {
  const { sendOtp, verifyOtp, linkPhone, refreshProfile } = useAuth();
  const { t } = useLang();

  const [phase, setPhase] = useState('phone'); // 'phone' | 'otp' | 'name'
  const [country, setCountry] = useState('IN');
  const [nationalNumber, setNationalNumber] = useState('');
  const [phoneE164, setPhoneE164] = useState('');
  const [code, setCode] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const cooldownRef = useRef(null);

  useEffect(() => () => clearInterval(cooldownRef.current), []);

  function startCooldown() {
    setCooldown(RESEND_COOLDOWN_SECS);
    clearInterval(cooldownRef.current);
    cooldownRef.current = setInterval(() => {
      setCooldown(c => {
        if (c <= 1) { clearInterval(cooldownRef.current); return 0; }
        return c - 1;
      });
    }, 1000);
  }

  const validE164 = toE164(country, nationalNumber);

  async function handleSendCode(e) {
    e?.preventDefault();
    if (!validE164 || submitting) return;
    setError('');
    setSubmitting(true);
    try {
      await sendOtp(validE164);
      setPhoneE164(validE164);
      setPhase('otp');
      startCooldown();
    } catch (err) {
      setError(describeError(err, t.error));
    } finally { setSubmitting(false); }
  }

  async function handleResend() {
    if (cooldown > 0 || submitting) return;
    setError('');
    setSubmitting(true);
    try {
      await sendOtp(phoneE164);
      startCooldown();
    } catch (err) {
      setError(describeError(err, t.error));
    } finally { setSubmitting(false); }
  }

  async function handleVerify(e) {
    e?.preventDefault();
    if (code.trim().length !== 6 || submitting) return;
    setError('');
    setSubmitting(true);
    try {
      if (linking) {
        await linkPhone(phoneE164, code.trim());
        onDone?.({ isNewUser: false });
        return;
      }
      const result = await verifyOtp(phoneE164, code.trim(), { role });
      if (result.is_new_user) {
        setPhase('name');
      } else {
        onDone?.({ isNewUser: false });
      }
    } catch (err) {
      setError(describeError(err, t.error));
    } finally { setSubmitting(false); }
  }

  async function handleSetName(e) {
    e?.preventDefault();
    const name = displayName.trim();
    if (!name || submitting) return;
    setError('');
    setSubmitting(true);
    try {
      // Session was just hydrated via setSession — pull it fresh rather than
      // relying on context state, which may not have re-rendered yet.
      const { data: { session } } = await supabase.auth.getSession();
      await api.users.updateProfile({ display_name: name }, session?.access_token);
      await refreshProfile();
      onDone?.({ isNewUser: true });
    } catch (err) {
      setError(describeError(err, t.error));
    } finally { setSubmitting(false); }
  }

  if (phase === 'name') {
    return (
      <form onSubmit={handleSetName} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <p style={{ color: 'var(--text-secondary)', fontSize: 13, margin: '0 0 4px', lineHeight: 1.5 }}>
          {t.pickDisplayName}
        </p>
        <input
          className="input"
          type="text"
          placeholder={t.displayName}
          value={displayName}
          onChange={e => setDisplayName(e.target.value)}
          maxLength={50}
          autoFocus
        />
        {error && <p style={{ color: '#f87171', fontSize: 13, margin: 0 }}>{error}</p>}
        <button className="btn-primary" type="submit" disabled={!displayName.trim() || submitting} style={{ padding: 14, fontSize: 15 }}>
          {submitting ? t.loading : t.continueLabel}
        </button>
      </form>
    );
  }

  if (phase === 'otp') {
    return (
      <form onSubmit={handleVerify} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <p style={{ color: 'var(--text-secondary)', fontSize: 13, margin: '0 0 4px', lineHeight: 1.5, display: 'flex', alignItems: 'flex-start', gap: 6 }}>
          <MessageSquare size={15} color="#FF6B35" style={{ flexShrink: 0, marginTop: 1 }} />
          <span>{t.otpSentTo} <strong style={{ color: 'var(--text-primary)' }}>{phoneE164}</strong> {t.viaSms}</span>
        </p>
        <input
          className="input"
          type="text"
          inputMode="numeric"
          maxLength={6}
          placeholder="123456"
          value={code}
          onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
          autoFocus
          style={{ fontFamily: 'monospace', letterSpacing: 6, fontSize: 22, textAlign: 'center' }}
        />
        {error && <p style={{ color: '#f87171', fontSize: 13, margin: 0 }}>{error}</p>}
        <button className="btn-primary" type="submit" disabled={code.trim().length !== 6 || submitting} style={{ padding: 14, fontSize: 15 }}>
          {submitting ? t.loading : t.verifyCode}
        </button>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <button
            type="button"
            onClick={() => { setPhase('phone'); setCode(''); setError(''); }}
            style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 13, padding: 0 }}
          >
            {t.changeNumber}
          </button>
          <button
            type="button"
            onClick={handleResend}
            disabled={cooldown > 0 || submitting}
            style={{ background: 'none', border: 'none', color: cooldown > 0 ? 'var(--text-muted)' : '#FF6B35', cursor: cooldown > 0 ? 'default' : 'pointer', fontSize: 13, fontWeight: 600, padding: 0 }}
          >
            {cooldown > 0 ? `${t.resendCode} (${cooldown}s)` : t.resendCode}
          </button>
        </div>
      </form>
    );
  }

  return (
    <form onSubmit={handleSendCode} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <p style={{ color: 'var(--text-secondary)', fontSize: 13, margin: '0 0 4px', lineHeight: 1.5 }}>
        {t.phoneAuthNote}
      </p>
      <PhoneInput country={country} onCountryChange={setCountry} value={nationalNumber} onChange={setNationalNumber} autoFocus />
      {error && <p style={{ color: '#f87171', fontSize: 13, margin: 0 }}>{error}</p>}
      <button className="btn-primary" type="submit" disabled={!validE164 || submitting} style={{ padding: 14, fontSize: 15 }}>
        {submitting ? t.sendingCode : t.sendCode}
      </button>
    </form>
  );
}
