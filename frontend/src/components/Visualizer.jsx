import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Maximize2, Minimize2, Expand, Mic, MicOff, SlidersHorizontal, X, Save, Check } from 'lucide-react';

const STYLES = ['bars', 'wave', 'pulse', 'ripple', 'orbit', 'spectrum'];
const STYLE_LABELS = { bars: 'Bars', wave: 'Wave', pulse: 'Pulse', ripple: 'Ripple', orbit: 'Orbit', spectrum: 'Spectrum' };

const THEMES = [
  { id: 'ember', label: 'Ember', a: '#FF6B35', b: '#6B4226' },
  { id: 'neon', label: 'Neon', a: '#00FF94', b: '#00B4D8' },
  { id: 'gold', label: 'Gold', a: '#FFD700', b: '#C89B6E' },
  { id: 'candy', label: 'Candy', a: '#FF6EB4', b: '#A855F7' },
  { id: 'ice', label: 'Ice', a: '#7DD3FC', b: '#818CF8' },
  { id: 'mono', label: 'Mono', a: '#F0E6D3', b: '#F0E6D3' },
  { id: 'multicolor', label: 'Multicolor', a: '#FF6B35', b: '#FFD700' },
];

const BG_OPTIONS = [
  { id: 'dark', label: 'Dark', style: { background: '#120C06' } },
  { id: 'black', label: 'Black', style: { background: '#000' } },
  { id: 'transparent', label: 'Clear', style: { background: 'transparent' } },
];

const GLOW_OPTIONS = ['none', 'subtle', 'strong'];

// Whether this browser/context can support mic capture at all — checked once,
// used to disable the mic button gracefully instead of throwing at click time.
const MIC_SUPPORTED = typeof navigator !== 'undefined'
  && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)
  && typeof window !== 'undefined' && !!(window.AudioContext || window.webkitAudioContext);

const MIC_GRANTED_KEY = 'nb_mic_granted';

// Average of one bucket of a mic frequency array, normalised to 0..1 — lets
// every draw function resample the analyser's bin count down to however many
// discrete elements (bars, dots, rings) that style actually has.
function micBucket(freqData, index, count) {
  const bucketSize = Math.max(1, Math.floor(freqData.length / count));
  const start = index * bucketSize;
  let sum = 0;
  for (let j = 0; j < bucketSize; j++) sum += freqData[start + j] || 0;
  return (sum / bucketSize) / 255;
}

// Overall (whole-spectrum) loudness, 0..1 — used by single-element styles
// (wave, pulse, ripple) that don't have discrete per-bar data.
function micOverall(freqData) {
  let sum = 0;
  for (let i = 0; i < freqData.length; i++) sum += freqData[i];
  return (sum / freqData.length) / 255;
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

// Multicolor mode: maps a 0..1 intensity value to a warm gradient (brand
// orange at rest -> hot pink/red -> bright gold at peak intensity), instead
// of the fixed two-color theme gradient. Same rgb() string shape as
// lerpColor, so it's a drop-in swap wherever a color is picked per-element.
function intensityColor(t) {
  const c = Math.max(0, Math.min(1, t));
  return c < 0.5
    ? lerpColor('#FF6B35', '#FF3B5C', c / 0.5)
    : lerpColor('#FF3B5C', '#FFD700', (c - 0.5) / 0.5);
}

function drawBars(ctx, w, h, phase, bars, colorA, colorB, glow, colorMode, micData) {
  ctx.clearRect(0, 0, w, h);
  const barW = w / bars * 0.7;
  const gap = w / bars * 0.3;
  for (let i = 0; i < bars; i++) {
    const t = (i / bars);
    const sim = Math.abs(Math.sin(phase * 2.3 + i * 0.4 + Math.sin(i * 0.7) * 0.5));
    const intensity = micData ? micBucket(micData, i, bars) : sim;
    const color = colorMode === 'multicolor' ? intensityColor(intensity) : lerpColor(colorA, colorB, t);
    const bh = h * 0.2 + h * 0.6 * intensity;
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

function drawWave(ctx, w, h, phase, colorA, colorB, glow, colorMode, micData) {
  ctx.clearRect(0, 0, w, h);
  const overall = micData ? micOverall(micData) : null;
  const ampScale = overall != null ? (0.3 + overall * 0.9) : 1;
  ctx.beginPath();
  for (let x = 0; x <= w; x++) {
    const t = x / w;
    const y = h / 2 + Math.sin(t * Math.PI * 4 + phase * 3) * h * 0.3 * ampScale * Math.sin(t * Math.PI);
    x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  const simIntensity = Math.abs(Math.sin(phase * 1.1));
  const intensity = overall != null ? overall : simIntensity;
  const color = colorMode === 'multicolor' ? intensityColor(intensity) : lerpColor(colorA, colorB, 0.5);
  if (glow !== 'none') { ctx.shadowBlur = glow === 'strong' ? 16 : 6; ctx.shadowColor = color; }
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.shadowBlur = 0;
}

function drawPulse(ctx, w, h, phase, colorA, colorB, glow, colorMode, micData) {
  ctx.clearRect(0, 0, w, h);
  const simR = Math.sin(phase * 2.5);
  const micIntensity = micData ? micOverall(micData) : null;
  const r = micIntensity != null
    ? Math.min(w, h) * 0.22 + Math.min(w, h) * 0.18 * micIntensity
    : Math.min(w, h) * 0.25 + Math.min(w, h) * 0.12 * simR;
  const intensity = micIntensity != null ? micIntensity : Math.abs(simR);
  const color = colorMode === 'multicolor' ? intensityColor(intensity) : lerpColor(colorA, colorB, 0.5);
  if (glow !== 'none') { ctx.shadowBlur = glow === 'strong' ? 24 : 10; ctx.shadowColor = color; }
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, r, 0, Math.PI * 2);
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.shadowBlur = 0;
}

function drawRipple(ctx, w, h, phase, colorA, colorB, colorMode, micData) {
  ctx.clearRect(0, 0, w, h);
  const maxR = Math.min(w, h) * 0.42;
  const overall = micData ? micOverall(micData) : null;
  for (let i = 0; i < 4; i++) {
    const r = ((phase * 0.3 + i * 0.25) % 1) * maxR;
    const alpha = 1 - r / maxR;
    const posT = r / maxR;
    const intensity = overall != null ? overall : posT;
    const color = colorMode === 'multicolor' ? intensityColor(intensity) : lerpColor(colorA, colorB, posT);
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, r, 0, Math.PI * 2);
    ctx.strokeStyle = color + Math.round(alpha * 255).toString(16).padStart(2, '0');
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

function drawOrbit(ctx, w, h, phase, colorA, colorB, glow, colorMode, micData) {
  ctx.clearRect(0, 0, w, h);
  const cx = w / 2, cy = h / 2;
  const dotCount = 6;
  for (let i = 0; i < dotCount; i++) {
    const angle = (phase * 1.5 + (i / dotCount) * Math.PI * 2);
    const orbitR = Math.min(w, h) * 0.28;
    const x = cx + Math.cos(angle) * orbitR;
    const y = cy + Math.sin(angle) * orbitR;
    const posT = i / dotCount;
    const sim = Math.abs(Math.sin(phase * 2 + i));
    const intensity = micData ? micBucket(micData, i, dotCount) : sim;
    const color = colorMode === 'multicolor' ? intensityColor(intensity) : lerpColor(colorA, colorB, posT);
    const dotR = micData ? 3 + intensity * 6 : 5;
    if (glow !== 'none') { ctx.shadowBlur = glow === 'strong' ? 12 : 5; ctx.shadowColor = color; }
    ctx.beginPath();
    ctx.arc(x, y, dotR, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }
  ctx.shadowBlur = 0;
}

function drawSpectrum(ctx, w, h, phase, bars, colorA, colorB, glow, colorMode, micData) {
  ctx.clearRect(0, 0, w, h);
  const barW = w / bars * 0.7;
  const gap = w / bars * 0.3;
  const cy = h / 2;
  for (let i = 0; i < bars; i++) {
    const t = i / bars;
    const sim = Math.abs(Math.sin(phase * 2.3 + i * 0.4));
    const intensity = micData ? micBucket(micData, i, bars) : sim;
    const color = colorMode === 'multicolor' ? intensityColor(intensity) : lerpColor(colorA, colorB, t);
    const bh = (h * 0.15 + h * 0.3 * intensity);
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

const ctrlBtnStyle = {
  width: 32, height: 32, borderRadius: '50%',
  background: 'rgba(26,16,8,0.85)', border: '1px solid #2A1F17', display: 'flex', alignItems: 'center',
  justifyContent: 'center', color: '#8B6F52', transition: 'all 0.15s', cursor: 'pointer', flexShrink: 0,
};
const ctrlBtnHover = e => { e.currentTarget.style.background = '#2A1F17'; e.currentTarget.style.color = '#F0E6D3'; };
const ctrlBtnLeave = e => { e.currentTarget.style.background = 'rgba(26,16,8,0.85)'; e.currentTarget.style.color = '#8B6F52'; };

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
    colorMode: 'fixed',
    ...externalSettings,
  });

  const [panelOpen, setPanelOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [saved, setSaved] = useState(false);

  // ── Feature 1: modal (expand) view — same canvas/loop, just repositioned ──
  const [modalOpen, setModalOpen] = useState(false);

  // ── Feature 2: mic-reactive input ──
  const [micEnabled, setMicEnabled] = useState(false);
  const [micError, setMicError] = useState(null); // null | 'denied' | 'error'
  const micStreamRef = useRef(null);
  const micAudioCtxRef = useRef(null);
  const micAnalyserRef = useRef(null);
  const micDataArrayRef = useRef(null);

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
      const { style, colorA, colorB, barCount, glow, colorMode } = settings;

      let micData = null;
      if (micEnabled && micAnalyserRef.current && micDataArrayRef.current) {
        micAnalyserRef.current.getByteFrequencyData(micDataArrayRef.current);
        micData = micDataArrayRef.current;
      }

      if (style === 'bars') drawBars(ctx, w, h, p, barCount, colorA, colorB, glow, colorMode, micData);
      else if (style === 'wave') drawWave(ctx, w, h, p, colorA, colorB, glow, colorMode, micData);
      else if (style === 'pulse') drawPulse(ctx, w, h, p, colorA, colorB, glow, colorMode, micData);
      else if (style === 'ripple') drawRipple(ctx, w, h, p, colorA, colorB, colorMode, micData);
      else if (style === 'orbit') drawOrbit(ctx, w, h, p, colorA, colorB, glow, colorMode, micData);
      else if (style === 'spectrum') drawSpectrum(ctx, w, h, p, barCount, colorA, colorB, glow, colorMode, micData);

      rafRef.current = requestAnimationFrame(animate);
    }

    rafRef.current = requestAnimationFrame(animate);
    return () => { cancelAnimationFrame(rafRef.current); ro.disconnect(); };
  }, [settings, speedFactor, micEnabled]);

  // Explicit resize on modal open/close, belt-and-suspenders alongside the
  // ResizeObserver above. The container's box changes synchronously with
  // this state (inline aspect-ratio box vs fixed centered modal box), and
  // the canvas's pixel buffer should snap to the new size immediately
  // rather than staying stretched until whatever next triggers a resize.
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
  }, [modalOpen]);

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

  // Close the modal on Escape, same as clicking the backdrop/X.
  useEffect(() => {
    if (!modalOpen) return;
    function onKey(e) { if (e.key === 'Escape') setModalOpen(false); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modalOpen]);

  function stopMicStream() {
    micStreamRef.current?.getTracks().forEach(t => t.stop());
    micStreamRef.current = null;
    if (micAudioCtxRef.current && micAudioCtxRef.current.state !== 'closed') {
      micAudioCtxRef.current.close().catch(() => {});
    }
    micAudioCtxRef.current = null;
    micAnalyserRef.current = null;
    micDataArrayRef.current = null;
  }

  async function enableMic() {
    if (!MIC_SUPPORTED) return;
    setMicError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const audioCtx = new AudioCtx();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.8;
      source.connect(analyser);

      micStreamRef.current = stream;
      micAudioCtxRef.current = audioCtx;
      micAnalyserRef.current = analyser;
      micDataArrayRef.current = new Uint8Array(analyser.frequencyBinCount);

      try { localStorage.setItem(MIC_GRANTED_KEY, '1'); } catch { /* private browsing etc — non-critical */ }
      setMicEnabled(true);
    } catch (err) {
      setMicError(err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError' ? 'denied' : 'error');
      setMicEnabled(false);
    }
  }

  function disableMic() {
    stopMicStream();
    setMicEnabled(false);
  }

  function handleMicToggle() {
    if (micEnabled) disableMic();
    else enableMic();
  }

  // Release the mic on unmount regardless of toggle state — covers navigating
  // away from the page while mic mode is still active.
  useEffect(() => () => stopMicStream(), []);

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

  const modalBoxStyle = modalOpen ? {
    position: 'fixed', zIndex: 10001, top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
    width: 'min(92vw, calc(86vh * 16 / 9), 1100px)',
  } : { position: 'relative', width: '100%' };

  return (
    <>
      {modalOpen && (
        <div onClick={() => setModalOpen(false)} style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 10000,
        }} />
      )}
      <div ref={containerRef} style={{ aspectRatio: '16/9', overflow: 'hidden', borderRadius: 10, ...bgStyle, ...modalBoxStyle }}>
        {/* Glow background */}
        <div style={{ position: 'absolute', inset: 0, ...glowStyle, pointerEvents: 'none' }} />

        {/* Canvas visualizer — same element/loop whether inline or in the modal */}
        <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', zIndex: 1 }} />

        {/* Controls — top right */}
        <div style={{ position: 'absolute', top: 8, right: 8, zIndex: 2, display: 'flex', gap: 8,
          opacity: fullscreen ? 0.5 : 1, transition: 'opacity 0.2s' }}
          onMouseEnter={e => { if (fullscreen) e.currentTarget.style.opacity = '1'; }}
          onMouseLeave={e => { if (fullscreen) e.currentTarget.style.opacity = '0.5'; }}>
          <button onClick={() => setPanelOpen(p => !p)} style={ctrlBtnStyle}
            onMouseEnter={ctrlBtnHover} onMouseLeave={ctrlBtnLeave} title="Customize">
            <SlidersHorizontal size={14} />
          </button>
          <div style={{ position: 'relative' }}>
            <button
              onClick={handleMicToggle}
              disabled={!MIC_SUPPORTED}
              style={{
                ...ctrlBtnStyle,
                background: micEnabled ? '#FF6B35' : ctrlBtnStyle.background,
                color: micEnabled ? '#0E0A07' : (MIC_SUPPORTED ? '#8B6F52' : '#4A3B2E'),
                cursor: MIC_SUPPORTED ? 'pointer' : 'not-allowed',
                opacity: MIC_SUPPORTED ? 1 : 0.5,
              }}
              onMouseEnter={e => { if (MIC_SUPPORTED && !micEnabled) ctrlBtnHover(e); }}
              onMouseLeave={e => { if (MIC_SUPPORTED && !micEnabled) ctrlBtnLeave(e); }}
              title={!MIC_SUPPORTED ? 'Microphone input needs a secure (HTTPS) connection and a supported browser' : (micEnabled ? 'Turn off microphone input' : 'React to ambient sound via microphone')}
            >
              {micEnabled ? <Mic size={14} /> : <MicOff size={14} />}
            </button>
            {micError && (
              <div style={{
                position: 'absolute', top: 38, right: 0, zIndex: 6, width: 200,
                background: '#1A1008', border: '1px solid #2A1F17', borderRadius: 8,
                padding: '10px 12px', boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
              }}>
                <div style={{ fontSize: 11, color: '#F0E6D3', lineHeight: 1.4, marginBottom: 6 }}>
                  {micError === 'denied'
                    ? 'Mic access was denied. The standard animation will keep playing.'
                    : "Couldn't start the microphone. The standard animation will keep playing."}
                </div>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button onClick={enableMic} style={{ background: 'none', border: 'none', color: '#FF6B35', fontSize: 11, fontWeight: 700, cursor: 'pointer', padding: 0 }}>
                    Retry
                  </button>
                  <button onClick={() => setMicError(null)} style={{ background: 'none', border: 'none', color: '#8B6F52', fontSize: 11, cursor: 'pointer', padding: 0 }}>
                    Dismiss
                  </button>
                </div>
              </div>
            )}
          </div>
          <button onClick={() => setModalOpen(o => !o)} style={ctrlBtnStyle}
            onMouseEnter={ctrlBtnHover} onMouseLeave={ctrlBtnLeave} title={modalOpen ? 'Close expanded view' : 'Expand view'}>
            <Expand size={14} />
          </button>
          <button onClick={toggleFullscreen} style={ctrlBtnStyle}
            onMouseEnter={ctrlBtnHover} onMouseLeave={ctrlBtnLeave} title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
            {fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
          {modalOpen && (
            <button onClick={() => setModalOpen(false)} style={ctrlBtnStyle}
              onMouseEnter={ctrlBtnHover} onMouseLeave={ctrlBtnLeave} title="Close">
              <X size={14} />
            </button>
          )}
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
                <button key={th.id}
                  onClick={() => setSettings(p => ({ ...p, themeId: th.id, colorA: th.a, colorB: th.b, colorMode: th.id === 'multicolor' ? 'multicolor' : 'fixed' }))}
                  title={th.label} style={{ width: 28, height: 28, borderRadius: '50%',
                    background: th.id === 'multicolor'
                      ? 'conic-gradient(from 0deg, #FF6B35, #FF3B5C, #FFD700, #FF6B35)'
                      : `linear-gradient(135deg, ${th.a}, ${th.b})`,
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
    </>
  );
}

function SectionLabel({ children }) {
  return (
    <div style={{ fontSize: 10, color: '#5A4535', fontWeight: 600, letterSpacing: 2,
      textTransform: 'uppercase', marginBottom: 8, paddingBottom: 4,
      borderBottom: '1px solid #2A1F17' }}>{children}</div>
  );
}
