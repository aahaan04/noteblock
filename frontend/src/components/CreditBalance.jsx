import { Coins, AlertTriangle } from 'lucide-react';
import { useLang } from '../context/LangContext.jsx';

export default function CreditBalance({ balance, anonymous, onBuy }) {
  const { t } = useLang();

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      background: '#1A1008',
      border: '1px solid #2A1F17',
      borderRadius: 999,
      padding: '6px 14px',
    }}>
      <Coins size={16} color="#C89B6E" />
      <span style={{ fontWeight: 700, fontSize: 16, color: '#C89B6E' }}>{balance}</span>
      <span style={{ fontSize: 13, color: '#8B6F52' }}>{t.credits}</span>
      {onBuy && (
        <button
          onClick={onBuy}
          style={{
            marginLeft: 4,
            background: '#FF6B35',
            border: 'none',
            color: '#F0E6D3',
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
          <AlertTriangle size={14} color="#8B6F52" />
        </span>
      )}
    </div>
  );
}
