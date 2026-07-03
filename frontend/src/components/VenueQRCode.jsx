import { QRCodeSVG } from 'qrcode.react';
import { useState } from 'react';
import { useLang } from '../context/LangContext.jsx';

export default function VenueQRCode({ roomCode, size = 200 }) {
  const { t } = useLang();
  const [copied, setCopied] = useState(false);

  const joinUrl = `${window.location.origin}/join/${roomCode}`;

  const handleCopy = () => {
    navigator.clipboard.writeText(joinUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleDownload = () => {
    // Convert SVG to PNG via canvas
    const svg = document.querySelector(`#qr-${roomCode} svg`);
    if (!svg) return;
    const data = new XMLSerializer().serializeToString(svg);
    const canvas = document.createElement('canvas');
    canvas.width = size * 2;
    canvas.height = size * 2;
    const ctx = canvas.getContext('2d');
    const img = new Image();
    img.onload = () => {
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const a = document.createElement('a');
      a.download = `noteblock-${roomCode}.png`;
      a.href = canvas.toDataURL('image/png');
      a.click();
    };
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(data)}`;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
      <div
        id={`qr-${roomCode}`}
        style={{
          background: '#fff',
          padding: 16,
          borderRadius: 12,
          display: 'inline-block',
        }}
      >
        <QRCodeSVG value={joinUrl} size={size} level="M" />
      </div>

      <div style={{ fontFamily: 'monospace', fontSize: 20, fontWeight: 700, letterSpacing: 4, color: 'var(--accent)' }}>
        {roomCode}
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn-secondary" onClick={handleCopy} style={{ fontSize: 13 }}>
          {copied ? t.copiedToClipboard : t.shareLink}
        </button>
        <button className="btn-primary" onClick={handleDownload} style={{ fontSize: 13, height: 44 }}>
          {t.downloadQR}
        </button>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
        Guests can scan this to join your room
      </div>
    </div>
  );
}
