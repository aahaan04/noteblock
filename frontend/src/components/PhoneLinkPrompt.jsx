import { useState } from 'react';
import { Phone, X, CheckCircle2 } from 'lucide-react';
import PhoneAuthFlow from './PhoneAuthFlow.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useLang } from '../context/LangContext.jsx';

// Non-blocking prompt shown to any logged-in user (host or guest) whose
// account predates phone auth and has never linked a number. Dismissible —
// per the migration requirement, nobody is forced to re-register or link a
// phone before continuing to use their existing account. Reappears on the
// next full page load until they either link a number or it's dismissed
// again, since dismissal is in-memory only (not persisted).
export default function PhoneLinkPrompt() {
  const { profile } = useAuth();
  const { t } = useLang();
  const [dismissed, setDismissed] = useState(false);
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);

  if (!profile || profile.phone_verified || dismissed) return null;

  if (done) {
    return (
      <div style={{
        background: 'rgba(52,211,153,0.08)', border: '1px solid rgba(52,211,153,0.3)', borderRadius: 12,
        padding: '12px 16px', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <CheckCircle2 size={18} color="#34d399" style={{ flexShrink: 0 }} />
        <span style={{ fontSize: 13, color: '#34d399', fontWeight: 600 }}>{t.phoneLinkedSuccess}</span>
      </div>
    );
  }

  return (
    <div style={{
      background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12,
      padding: '14px 16px', marginBottom: 20,
    }}>
      {!open ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <Phone size={18} color="#FF6B35" style={{ flexShrink: 0 }} />
          <span style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 600, flex: 1, minWidth: 200 }}>
            {t.linkPhoneBanner}
          </span>
          <button
            onClick={() => setOpen(true)}
            style={{
              background: '#FF6B35', border: 'none', borderRadius: 8, padding: '8px 14px',
              fontSize: 12, fontWeight: 700, color: '#0E0A07', cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            {t.linkPhoneCta}
          </button>
          <button
            onClick={() => setDismissed(true)}
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4, display: 'flex' }}
            aria-label={t.dismiss}
          >
            <X size={16} />
          </button>
        </div>
      ) : (
        <div style={{ maxWidth: 360 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{t.linkPhoneCta}</span>
            <button
              onClick={() => setOpen(false)}
              style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4, display: 'flex' }}
              aria-label={t.dismiss}
            >
              <X size={16} />
            </button>
          </div>
          <PhoneAuthFlow linking onDone={() => { setOpen(false); setDone(true); }} />
        </div>
      )}
    </div>
  );
}
