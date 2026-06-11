import { useEffect, useRef, useState } from 'react';
import { Maximize2, Minimize2, SlidersHorizontal, X, Save, Check } from 'lucide-react';

const STYLES = ['bars', 'wave', 'pulse', 'ripple', 'orbit', 'spectrum'];
const STYLE_LABELS = { bars: 'Bars', wave: 'Wave', pulse: 'Pulse', ripple: 'Ripple', orbit: 'Orbit', spectrum: 'Spectrum' };

const THEMES = [
  { id: 'ember', label: 'Ember', a: '#FF6B35', b: '#6B4226' },
  { id: 'neon', label: 'Neon', a: '#00FF94', b: '#00B4D8' },
  { id: 'gold', label: 'Gold', a: '#FFD700', b: '#C89B6E' },
  { id: 'candy', label: 'Candy', a: '#FF6EB4', b: '#A855F7' },
  { id: 'ice', label: 'Ice', a: '#7DD3FC', b: '#818CF8' },
  { id: 'mono', label: 'Mono', a: '#F0E6D3', b: '#F0E6D3' },
];

const BG_OPTIONS = [
  { id: 'dark', label: 'Dark', style: { background: '#120C06' } },
  { id: 'black', label: 'Black', style: { background: '#000' } },
  { id: 'transparent', label: 'Clear', style: { background: 'transparent' } },
];

const GLOW_OPTIONS = ['none', 'subtle', 'strong'];

function drawBars(ctx, w, h, phase, bars, colorA, colorB, glow) {
  ctx.clearRect(0, 0, w, h);
  const barW = w / bars * 0.7;
  const gap = w / bars * 0.3;
  for (let i = 0; i < bars; i++) {
    const t = (i / bars);
    const color = lerpColor(colorA, colorB, t);
    const bh = h * 0.2 + h * 0.6 * Math.abs(Math.sin(phase * 2.3 + i * 0.4 + Math.sin(i * 0.7) * 0.5));
    const x = i * (barW + gap) + gap / 2;
    if (glow !== 'none') ctx.shadowBlur = glow === 'strong' ? 12 : 5;
    ctx.shadowColor = color;
    ctx.fillStyle = color;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, h - bh, barW, bh, 2);
    else ctx.rect(x, h - bh, barW, bh);
    ctx.fill();
  }
  ctx.shadowBlur = 0;
}

function drawWave(ctx, w, h, phase, colorA, colorB, glow) {
  ctx.clearRect(0, 0, w, h);
  ctx.beginPath();
  for (let x = 0; x <= w; x++) {
    const t = x / w;
    const y = h / 2 + Math.sin(t * Math.PI * 4 + phase * 3) * h * 0.3 * Math.sin(t * Math.PI);
    x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  const color = lerpColor(colorA, colorB, 0.5);
  if (glow !== 'none') { ctx.shadowBlur = glow === 'strong' ? 16 : 6; ctx.shadowColor = color; }
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.shadowBlur = 0;
}

function drawPulse(ctx, w, h, phase, colorA, colorB, glow) {
  ctx.clearRect(0, 0, w, h);
  const r = Math.min(w, h) * 0.25 + Math.min(w, h) * 0.12 * Math.sin(phase * 2.5);
  const color = lerpColor(colorA, colorB, 0.5);
  if (glow !== 'none') { ctx.shadowBlur = glow === 'strong' ? 24 : 10; ctx.shadowColor = color; }
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, r, 0, Math.PI * 2);
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.shadowBlur = 0;
}

function drawRipple(ctx, w, h, phase, colorA, colorB) {
  ctx.clearRect(0, 0, w, h);
  const maxR = Math.min(w, h) * 0.42;
  for (let i = 0; i < 4; i++) {
    const r = ((phase * 0.3 + i * 0.25) % 1) * maxR;
    const alpha = 1 - r / maxR;
    const color = lerpColor(colorA, colorB, r / maxR);
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, r, 0, Math.PI * 2);
    ctx.strokeStyle = color + Math.round(alpha * 255).toString(16).padStart(2, '0');
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

function drawOrbit(ctx, w, h, phase, colorA, colorB, glow) {
  ctx.clearRect(0, 0, w, h);
  const cx = w / 2, cy = h / 2;
  const dotCount = 6;
  for (let i = 0; i < dotCount; i++) {
    const angle = (phase * 1.5 + (i / dotCount) * Math.PI * 2);
    const orbitR = Math.min(w, h) * 0.28;
    const x = cx + Math.cos(angle) * orbitR;
    const y = cy + Math.sin(angle) * orbitR;
    const color = lerpColor(colorA, colorB, i / dotCount);
    if (glow !== 'none') { ctx.shadowBlur = glow === 'strong' ? 12 : 5; ctx.shadowColor = color; }
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }
  ctx.shadowBlur = 0;
}

function drawSpectrum(ctx, w, h, phase, bars, colorA, colorB, glow) {
  ctx.clearRect(0, 0, w, h);
  const barW = w / bars * 0.7;
  const gap = w / bars * 0.3;
  const cy = h / 2;
  for (let i = 0; i < bars; i++) {
    const t = i / bars;
    const color = lerpColor(colorA, colorB, t);
    const bh = (h * 0.15 + h * 0.3 * Math.abs(Math.sin(phase * 2.3 + i * 0.4)));
    const x = i * (barW + gap) + gap / 2;
    if (glow !== 'none') { ctx.shadowBlur = glow === 'strong' ? 10 : 4; ctx.shadowColor = color; }
    ctx.fillStyle = color;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, cy - bh, barW, bh * 2, 2);
    else ctx.rect(x, cy - bh, barW, bh * 2);
    ctx.fill();
  }
  ctx.shadowBlur = 0;
}

function hexToRgb(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return [r, g, b];
}

function lerpColor(a, b, t) {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  return `rgb(${Math.round(r1 + (r2 - r1) * t)},${Math.round(g1 + (g2 - g1) * t)},${Math.round(b1 + (b2 - b1) * t)})`;
}

function MiniPreview({ style, colorA, colorB, active, onClick }) {
  const canvasRef = useRef(null);
  const phaseRef = useRef(0);
  const rafRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;

    function animate() {
      phaseRef.current += 0.04;
      const p = phaseRef.current;
      ctx.clearRect(0, 0, w, h);
      if (style === 'bars') drawBars(ctx, w, h, p, 12, colorA, colorB, 'none');
      else if (style === 'wave') drawWave(ctx, w, h, p, colorA, colorB, 'none');
      else if (style === 'pulse') drawPulse(ctx, w, h, p, colorA, colorB, 'none');
      else if (style === 'ripple') drawRipple(ctx, w, h, p, colorA, colorB);
      else if (style === 'orbit') drawOrbit(ctx, w, h, p, colorA, colorB, 'none');
      else if (style === 'spectrum') drawSpectrum(ctx, w, h, p, 12, colorA, colorB, 'none');
      rafRef.current = requestAnimationFrame(animate);
    }
    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, [style, colorA, colorB]);

  return (
    <div onClick={onClick} style={{ cursor: 'pointer', borderRadius: 6, overflow: 'hidden',
      border: active ? '2px solid #FF6B35' : '2px solid #2A1F17', position: 'relative', background: '#120C06' }}>
      <canvas ref={canvasRef} width={64} height={40} style={{ display: 'block' }} />
      <div style={{ position: 'absolute', bottom: 2, left: 0, right: 0, textAlign: 'center',
        fontSize: 8, color: '#8B6F52', fontWeight: 600 }}>{STYLE_LABELS[style]}</div>
    </div>
  );
}

export default function Visualizer({ isPlaying, songTitle, requester, settings: externalSettings, onSaveSettings }) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const phaseRef = useRef(0);
  const rafRef = useRef(null);
  const isPlayingRef = useRef(isPlaying);

  const [settings, setSettings] = useState({
    style: 'bars',
    themeId: 'ember',
    colorA: '#FF6B35',
    colorB: '#6B4226',
    speed: 'medium',
    barCount: 48,
    bg: 'dark',
    glow: 'subtle',
    ...externalSettings,
  });

  const [panelOpen, setPanelOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => { if (externalSettings) setSettings(s => ({ ...s, ...externalSettings })); }, [JSON.stringify(externalSettings)]); // eslint-disable-line

  const speedFactor = settings.speed === 'fast' ? 3 : settings.speed === 'slow' ? 0.4 : 1;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    function resize() {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
    }
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    function animate() {
      if (isPlayingRef.current) phaseRef.current += 0.025 * speedFactor;
      const p = phaseRef.current;
      const w = canvas.width, h = canvas.height;
      const { style, colorA, colorB, barCount, glow } = settings;

      if (style === 'bars') drawBars(ctx, w, h, p, barCount, colorA, colorB, glow);
      else if (style === 'wave') drawWave(ctx, w, h, p, colorA, colorB, glow);
      else if (style === 'pulse') drawPulse(ctx, w, h, p, colorA, colorB, glow);
      else if (style === 'ripple') drawRipple(ctx, w, h, p, colorA, colorB);
      else if (style === 'orbit') drawOrbit(ctx, w, h, p, colorA, colorB, glow);
      else if (style === 'spectrum') drawSpectrum(ctx, w, h, p, barCount, colorA, colorB, glow);

      rafRef.current = requestAnimationFrame(animate);
    }

    rafRef.current = requestAnimationFrame(animate);
    return () => { cancelAnimationFrame(rafRef.current); ro.disconnect(); };
  }, [settings, speedFactor]);

  function toggleFullscreen() {
    if (!fullscreen) {
      containerRef.current?.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
  }

  useEffect(() => {
    function onFSChange() { setFullscreen(!!document.fullscreenElement); }
    document.addEventListener('fullscreenchange', onFSChange);
    return () => document.removeEventListener('fullscreenchange', onFSChange);
  }, []);

  async function handleSave() {
    if (onSaveSettings) await onSaveSettings(settings);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  const bgStyle = settings.bg === 'black' ? { background: '#000' }
    : settings.bg === 'transparent' ? { background: 'transparent' }
    : { background: '#120C06' };

  const glowStyle = settings.bg !== 'transparent' ? {
    backgroundImage: 'radial-gradient(ellipse at center, rgba(255,107,53,0.08) 0%, transparent 70%)',
  } : {};

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%', aspectRatio: '16/9', overflow: 'hidden', borderRadius: 10, ...bgStyle }}>
      {/* Glow background */}
      <div style={{ position: 'absolute', inset: 0, ...glowStyle, pointerEvents: 'none' }} />

      {/* Canvas visualizer */}
      <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', zIndex: 1 }} />

      {/* Controls — top right */}
      <div style={{ position: 'absolute', top: 8, right: 8, zIndex: 2, display: 'flex', gap: 8,
        opacity: fullscreen ? 0.5 : 1, transition: 'opacity 0.2s' }}
        onMouseEnter={e => { if (fullscreen) e.currentTarget.style.opacity = '1'; }}
        onMouseLeave={e => { if (fullscreen) e.currentTarget.style.opacity = '0.5'; }}>
        <button onClick={() => setPanelOpen(p => !p)} style={{ width: 32, height: 32, borderRadius: '50%',
          background: 'rgba(26,16,8,0.85)', border: '1px solid #2A1F17', display: 'flex', alignItems: 'center',
          justifyContent: 'center', color: '#8B6F52', transition: 'all 0.15s', cursor: 'pointer' }}
          onMouseEnter={e => { e.currentTarget.style.background = '#2A1F17'; e.currentTarget.style.color = '#F0E6D3'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'rgba(26,16,8,0.85)'; e.currentTarget.style.color = '#8B6F52'; }}>
          <SlidersHorizontal size={14} />
        </button>
        <button onClick={toggleFullscreen} style={{ width: 32, height: 32, borderRadius: '50%',
          background: 'rgba(26,16,8,0.85)', border: '1px solid #2A1F17', display: 'flex', alignItems: 'center',
          justifyContent: 'center', color: '#8B6F52', transition: 'all 0.15s', cursor: 'pointer' }}
          onMouseEnter={e => { e.currentTarget.style.background = '#2A1F17'; e.currentTarget.style.color = '#F0E6D3'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'rgba(26,16,8,0.85)'; e.currentTarget.style.color = '#8B6F52'; }}>
          {fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>
      </div>

      {/* Customization panel */}
      {panelOpen && (
        <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: 240, background: '#1A1008',
          borderLeft: '1px solid #2A1F17', borderRadius: '0 10px 10px 0', zIndex: 3,
          boxShadow: '-4px 0 20px rgba(0,0,0,0.5)', overflowY: 'auto', padding: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#F0E6D3' }}>Visualizer</span>
            <button onClick={() => setPanelOpen(false)} style={{ background: 'none', border: 'none', color: '#8B6F52', cursor: 'pointer', display: 'flex' }}>
              <X size={16} />
            </button>
          </div>

          <SectionLabel>Style</SectionLabel>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, marginBottom: 16 }}>
            {STYLES.map(s => (
              <MiniPreview key={s} style={s} colorA={settings.colorA} colorB={settings.colorB}
                active={settings.style === s} onClick={() => setSettings(p => ({ ...p, style: s }))} />
            ))}
          </div>

          <SectionLabel>Color</SectionLabel>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
            {THEMES.map(th => (
              <button key={th.id} onClick={() => setSettings(p => ({ ...p, themeId: th.id, colorA: th.a, colorB: th.b }))}
                title={th.label} style={{ width: 28, height: 28, borderRadius: '50%',
                  background: `linear-gradient(135deg, ${th.a}, ${th.b})`,
                  border: settings.themeId === th.id ? '2.5px solid #fff' : '2px solid transparent',
                  cursor: 'pointer' }} />
            ))}
          </div>

          <SectionLabel>Speed</SectionLabel>
          <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
            {['slow', 'medium', 'fast'].map(s => (
              <button key={s} onClick={() => setSettings(p => ({ ...p, speed: s }))}
                style={{ flex: 1, height: 32, borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                  background: settings.speed === s ? '#FF6B35' : '#2A1F17',
                  color: settings.speed === s ? '#0E0A07' : '#8B6F52', border: 'none',
                  textTransform: 'capitalize' }}>{s}</button>
            ))}
          </div>

          {(settings.style === 'bars' || settings.style === 'spectrum') && (
            <>
              <SectionLabel>Bar Count ({settings.barCount})</SectionLabel>
              <input type="range" min={20} max={80} value={settings.barCount}
                onChange={e => setSettings(p => ({ ...p, barCount: Number(e.target.value) }))}
                style={{ width: '100%', accentColor: '#FF6B35', marginBottom: 16, padding: 0 }} />
            </>
          )}

          <SectionLabel>Background</SectionLabel>
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            {BG_OPTIONS.map(bg => (
              <button key={bg.id} onClick={() => setSettings(p => ({ ...p, bg: bg.id }))}
                style={{ flex: 1, height: 32, borderRadius: 6, fontSize: 11, fontWeight: 600,
                  ...bg.style, border: settings.bg === bg.id ? '2px solid #FF6B35' : '1px solid #2A1F17',
                  color: '#F0E6D3', cursor: 'pointer' }}>{bg.label}</button>
            ))}
          </div>

          <SectionLabel>Glow</SectionLabel>
          <div style={{ display: 'flex', gap: 6, marginBottom: 20 }}>
            {GLOW_OPTIONS.map(g => (
              <button key={g} onClick={() => setSettings(p => ({ ...p, glow: g }))}
                style={{ flex: 1, height: 32, borderRadius: 6, fontSize: 11, fontWeight: 600,
                  background: settings.glow === g ? '#FF6B35' : '#2A1F17',
                  color: settings.glow === g ? '#0E0A07' : '#8B6F52', border: 'none', cursor: 'pointer',
                  textTransform: 'capitalize' }}>{g}</button>
            ))}
          </div>

          <button onClick={handleSave} className="btn-primary" style={{ width: '100%', height: 40, fontSize: 13 }}>
            {saved ? <><Check size={14} /> Saved</> : <><Save size={14} /> Save</>}
          </button>
        </div>
      )}

      {/* Song info overlay at bottom when fullscreen */}
      {fullscreen && (
        <div style={{ position: 'absolute', bottom: 16, left: 16, right: 16, zIndex: 2 }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#F0E6D3', marginBottom: 4,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{songTitle || 'No song playing'}</div>
          {requester && <div style={{ fontSize: 16, color: '#8B6F52' }}>by {requester}</div>}
        </div>
      )}
    </div>
  );
}

function SectionLabel({ children }) {
  return (
    <div style={{ fontSize: 10, color: '#5A4535', fontWeight: 600, letterSpacing: 2,
      textTransform: 'uppercase', marginBottom: 8, paddingBottom: 4,
      borderBottom: '1px solid #2A1F17' }}>{children}</div>
  );
}
