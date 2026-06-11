import { Coins, AlertTriangle } from 'lucide-react';
import { useLang } from '../context/LangContext.jsx';

export default function CreditBalance({ balance, anonymous, onBuy }) {
  const { t } = useLang();

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      background: 'var(--bg-card)',
      border: '1px solid var(--border)',
      borderRadius: 999,
      padding: '6px 14px',
    }}>
      <Coins size={16} color="var(--credits)" />
      <span style={{ fontWeight: 700, fontSize: 16, color: 'var(--credits)' }}>{balance}</span>
      <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{t.credits}</span>
      {onBuy && (
        <button
          onClick={onBuy}
          style={{
            marginLeft: 4,
            background: '#FF6B35',
            border: 'none',
            color: 'var(--text-primary)',
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
        <span title={t.anonymousCreditWarning} style={{ cursor: 'help', display: 'flex', alignItems: 'center' }}>
          <AlertTriangle size={14} color="var(--text-secondary)" />
        </span>
      )}
    </div>
  );
}
