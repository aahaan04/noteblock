import { useLang } from '../context/LangContext.jsx';

export default function CreditBalance({ balance, anonymous, onBuy }) {
  const { t } = useLang();

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 999,
      padding: '6px 14px',
    }}>
      <span style={{ fontSize: 18 }}>🪙</span>
      <span style={{ fontWeight: 700, fontSize: 16, color: 'var(--accent)' }}>{balance}</span>
      <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t.credits}</span>
      {onBuy && (
        <button
          onClick={onBuy}
          style={{
            marginLeft: 4,
            background: 'var(--accent)',
            border: 'none',
            color: '#fff',
            fontSize: 11,
            fontWeight: 700,
            padding: '3px 10px',
            borderRadius: 999,
            cursor: 'pointer',
          }}
        >
          {t.buyCredits}
        </button>
      )}
      {anonymous && (
        <span title={t.anonymousCreditWarning} style={{ fontSize: 14, cursor: 'help' }}>⚠️</span>
      )}
    </div>
  );
}
