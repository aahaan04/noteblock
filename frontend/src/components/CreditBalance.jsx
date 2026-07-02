import { Coins, AlertTriangle } from 'lucide-react';
import { useLang } from '../context/LangContext.jsx';

export default function CreditBalance({ balance, anonymous, onBuy }) {
  const { t } = useLang();

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6,
      background: 'var(--border)',
      border: '1px solid var(--btn-normal)',
      borderRadius: 999,
      padding: '5px 12px',
    }}>
      <span style={{
        width: 16, height: 16, borderRadius: '50%', flexShrink: 0,
        background: 'var(--credits)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Coins size={9} color="var(--bg-app)" strokeWidth={2.5} />
      </span>
      <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--credits)', fontVariantNumeric: 'tabular-nums' }}>{balance}</span>
      <span style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 500 }}>{t.credits}</span>
      {onBuy && (
        <button
          onClick={onBuy}
          style={{
            marginLeft: 2,
            background: '#FF6B35',
            border: 'none',
            color: '#fff',
            fontSize: 11,
            fontWeight: 700,
            padding: '3px 10px',
            borderRadius: 999,
            cursor: 'pointer',
            fontFamily: 'inherit',
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
