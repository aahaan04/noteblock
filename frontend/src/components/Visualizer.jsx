import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Maximize2, Minimize2, Expand, Mic, MicOff, SlidersHorizontal, X, Save, Check } from 'lucide-react';

const STYLES = ['bars', 'wave', 'pulse', 'ripple', 'orbit', 'spectrum'];
const STYLE_LABELS = { bars: 'Bars', wave: 'Wave', pulse: 'Pulse', ripple: 'Ripple', orbit: 'Orbit', spectrum: 'Spectrum' };

// ── Color section data ───────────────────────────────────────────────────
// Three groups: SOLID (flat, colorA === colorB), GRADIENT (static two-stop,
// colorA -> colorB), DYNAMIC (colorMode itself picks the color per-frame —
// colorA/colorB are unused by rendering for these, only kept for a sane
// swatch preview / migration fallback).
const SOLID_COLORS = [
  { id: 'orange', label: 'Orange', hex: '#FF6B35' },
  { id: 'teal', label: 'Teal', hex: '#14B8A6' },
  { id: 'gold', label: 'Gold', hex: '#FFD700' },
  { id: 'pink', label: 'Pink', hex: '#FF6EB4' },
  { id: 'blue', label: 'Blue', hex: '#3B82F6' },
  { id: 'cream', label: 'Cream', hex: '#F0E6D3' },
  { id: 'purple', label: 'Purple', hex: '#A855F7' },
  { id: 'red', label: 'Red', hex: '#EF4444' },
];

const GRADIENTS = [
  { id: 'sunset', label: 'Sunset', a: '#FF6B35', b: '#FF6EB4' },
  { id: 'ocean', label: 'Ocean', a: '#14B8A6', b: '#3B82F6' },
  { id: 'fire', label: 'Fire', a: '#FFD700', b: '#EF4444' },
  { id: 'candy', label: 'Candy', a: '#FF6EB4', b: '#A855F7' },
  { id: 'aurora', label: 'Aurora', a: '#00FF94', b: '#3B82F6' },
  { id: 'gold-gradient', label: 'Gold', a: '#FFD700', b: '#C05621' },
];

const DYNAMIC_COLORS = [
  { id: 'intensity', label: 'Intensity Shift', colorMode: 'intensity' },
  { id: 'rainbow', label: 'Rainbow Cycle', colorMode: 'rainbow' },
  { id: 'pulse-spectrum', label: 'Pulse Spectrum', colorMode: 'pulse-spectrum' },
];

// Swatch previews for the dynamic options, matching how each actually
// renders: Intensity Shift is the real orange/red/gold ramp it produces;
// Rainbow Cycle is a full conic wheel (loops continuously); Pulse Spectrum
// is a linear sweep (a range driven by intensity, not a full loop).
const DYNAMIC_SWATCH_BG = {
  intensity: 'conic-gradient(from 0deg, #FF6B35, #FF3B5C, #FFD700, #FF6B35)',
  rainbow: 'conic-gradient(from 0deg, hsl(0,75%,58%), hsl(60,75%,58%), hsl(120,75%,58%), hsl(180,75%,58%), hsl(240,75%,58%), hsl(300,75%,58%), hsl(360,75%,58%))',
  'pulse-spectrum': 'linear-gradient(135deg, hsl(0,80%,55%), hsl(150,80%,55%), hsl(300,80%,55%))',
};

// Maps the old 7-theme flat list (colorMode: 'fixed' | 'multicolor') to the
// new SOLID / GRADIENT / DYNAMIC shape, so a venue that saved a preference
// under the old system keeps working and lands on the closest equivalent —
// nothing resets to a default just because the categories were reorganised.
const LEGACY_THEME_MAP = {
  ember: { colorMode: 'solid', colorId: 'orange', colorA: '#FF6B35', colorB: '#FF6B35' },
  neon: { colorMode: 'gradient', colorId: 'aurora', colorA: '#00FF94', colorB: '#3B82F6' },
  gold: { colorMode: 'solid', colorId: 'gold', colorA: '#FFD700', colorB: '#FFD700' },
  candy: { colorMode: 'gradient', colorId: 'candy', colorA: '#FF6EB4', colorB: '#A855F7' },
  ice: { colorMode: 'solid', colorId: 'blue', colorA: '#3B82F6', colorB: '#3B82F6' },
  mono: { colorMode: 'solid', colorId: 'cream', colorA: '#F0E6D3', colorB: '#F0E6D3' },
  multicolor: { colorMode: 'intensity', colorId: 'intensity', colorA: '#FF6B35', colorB: '#FFD700' },
};

// Normalises a settings object that might still be in the old flat-theme
// shape (colorMode 'fixed'/'multicolor' + themeId) into the new shape. A
// settings object already in the new shape (colorMode is one of solid/
// gradient/intensity/rainbow/pulse-spectrum) passes through untouched.
function migrateColorSettings(raw) {
  if (!raw) return raw;
  if (raw.colorMode !== 'fixed' && raw.colorMode !== 'multicolor') return raw;
  const mapped = LEGACY_THEME_MAP[raw.themeId] ?? LEGACY_THEME_MAP.ember;
  const { themeId, ...rest } = raw; // eslint-disable-line no-unused-vars
  return { ...rest, ...mapped };
}

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

// Resamples one element's worth of a mic frequency array down to a single
// 0..1 value, for however many discrete elements (bars, dots) that style
// actually has. Two things a naive equal-width linear split gets wrong for
// real program material:
//  1. Most audible energy in a linear FFT sits in the first ~10-20% of
//     bins (bass/low-mid) — dividing the bins into equal-width chunks gives
//     every element the same *bin* budget but a wildly uneven *energy*
//     budget, so elements mapped to high-frequency bins read near-silent
//     almost all the time and look static even though there IS live signal.
//  2. Averaging a bucket dilutes short transients (hi-hats, sibilance) that
//     only hit one or two bins within it.
// Fixed by mapping bar index -> bin range on a squared (log-ish) curve, so
// low indices sample a narrow low-frequency slice and high indices sample a
// proportionally wider high-frequency slice, using the bucket's peak
// (not average) so transients survive, plus a gentle per-band gain curve
// that compensates for the natural energy roll-off toward high frequencies
// so every element — not just the bass-heavy left side — stays reactive.
function micBucket(freqData, index, count) {
  const n = freqData.length;
  const t0 = index / count;
  const t1 = (index + 1) / count;
  const start = Math.floor(t0 * t0 * n);
  const end = Math.min(n, Math.max(start + 1, Math.floor(t1 * t1 * n)));
  let peak = 0;
  for (let j = start; j < end; j++) {
    if (freqData[j] > peak) peak = freqData[j];
  }
  const gain = 1 + t0 * 1.8;
  return Math.min(1, (peak / 255) * gain);
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

// Rainbow Cycle: hue depends on time (phase) and each element's position
// (posT), so the whole visualizer sweeps continuously through the spectrum
// regardless of music intensity — a per-element offset keeps multi-element
// styles (bars, dots) visually rich rather than one flat color at a time.
function rainbowColor(phase, posT) {
  const hue = ((phase * 30) + posT * 360) % 360;
  return `hsl(${hue}, 75%, 58%)`;
}

// Pulse Spectrum: like Intensity Shift, but the intensity value sweeps a
// full hue range (red -> magenta) instead of the fixed orange/red/gold ramp
// — quiet moments sit near red, loud moments push toward magenta.
function pulseSpectrumColor(t) {
  const c = Math.max(0, Math.min(1, t));
  return `hsl(${c * 300}, 80%, 55%)`;
}

// Single dispatch point every draw function's element-coloring goes
// through. Dynamic modes compute their own color; solid and gradient both
// resolve through the same lerpColor(colorA, colorB, posT) — solid just has
// colorA === colorB, so the result is flat regardless of posT.
function pickColor(colorMode, colorA, colorB, posT, intensity, phase) {
  if (colorMode === 'intensity') return intensityColor(intensity);
  if (colorMode === 'rainbow') return rainbowColor(phase, posT);
  if (colorMode === 'pulse-spectrum') return pulseSpectrumColor(intensity);
  return lerpColor(colorA, colorB, posT);
}

function drawBars(ctx, w, h, phase, bars, colorA, colorB, glow, colorMode, micData) {
  ctx.clearRect(0, 0, w, h);
  const barW = w / bars * 0.7;
  const gap = w / bars * 0.3;
  for (let i = 0; i < bars; i++) {
    const t = (i / bars);
    const sim = Math.abs(Math.sin(phase * 2.3 + i * 0.4 + Math.sin(i * 0.7) * 0.5));
    const intensity = micData ? micBucket(micData, i, bars) : sim;
    const color = pickColor(colorMode, colorA, colorB, t, intensity, phase);
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
  const color = pickColor(colorMode, colorA, colorB, 0.5, intensity, phase);
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
  const color = pickColor(colorMode, colorA, colorB, 0.5, intensity, phase);
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
    const color = pickColor(colorMode, colorA, colorB, posT, intensity, phase);
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, r, 0, Math.PI * 2);
    // color is an rgb()/hsl() string, not hex — can't append a hex alpha
    // suffix to it (that produced an invalid CSS color, which canvas
    // silently ignores, leaving strokeStyle stuck on a stale value and
    // making rings invisible). globalAlpha works with any color format.
    ctx.strokeStyle = color;
    ctx.globalAlpha = alpha;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
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
    const color = pickColor(colorMode, colorA, colorB, posT, intensity, phase);
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
    const color = pickColor(colorMode, colorA, colorB, t, intensity, phase);
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
    colorMode: 'solid',
    colorId: 'orange',
    colorA: '#FF6B35',
    colorB: '#FF6B35',
    speed: 'medium',
    barCount: 48,
    bg: 'dark',
    glow: 'subtle',
    ...migrateColorSettings(externalSettings),
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
  useEffect(() => { if (externalSettings) setSettings(s => ({ ...s, ...migrateColorSettings(externalSettings) })); }, [JSON.stringify(externalSettings)]); // eslint-disable-line

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
          {!modalOpen && (
            <button onClick={() => setModalOpen(true)} style={ctrlBtnStyle}
              onMouseEnter={ctrlBtnHover} onMouseLeave={ctrlBtnLeave} title="Expand view">
              <Expand size={14} />
            </button>
          )}
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
            <div style={{ marginBottom: 16 }}>
              <div style={{ marginBottom: 14 }}>
                <SubLabel>Solid</SubLabel>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {SOLID_COLORS.map(c => (
                    <button key={c.id}
                      onClick={() => setSettings(p => ({ ...p, colorMode: 'solid', colorId: c.id, colorA: c.hex, colorB: c.hex }))}
                      title={c.label} style={{ width: 28, height: 28, borderRadius: '50%',
                        background: c.hex,
                        border: settings.colorId === c.id ? '2.5px solid #fff' : '2px solid transparent',
                        cursor: 'pointer' }} />
                  ))}
                </div>
              </div>

              <div style={{ marginBottom: 14 }}>
                <SubLabel>Gradient</SubLabel>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {GRADIENTS.map(g => (
                    <button key={g.id}
                      onClick={() => setSettings(p => ({ ...p, colorMode: 'gradient', colorId: g.id, colorA: g.a, colorB: g.b }))}
                      title={g.label} style={{ width: 28, height: 28, borderRadius: '50%',
                        background: `linear-gradient(135deg, ${g.a}, ${g.b})`,
                        border: settings.colorId === g.id ? '2.5px solid #fff' : '2px solid transparent',
                        cursor: 'pointer' }} />
                  ))}
                </div>
              </div>

              <div>
                <SubLabel>Dynamic</SubLabel>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {DYNAMIC_COLORS.map(d => (
                    <button key={d.id}
                      onClick={() => setSettings(p => ({ ...p, colorMode: d.colorMode, colorId: d.id, colorA: '#FF6B35', colorB: '#FFD700' }))}
                      title={d.label} style={{ width: 28, height: 28, borderRadius: '50%',
                        background: DYNAMIC_SWATCH_BG[d.id],
                        border: settings.colorId === d.id ? '2.5px solid #fff' : '2px solid transparent',
                        cursor: 'pointer' }} />
                  ))}
                </div>
              </div>
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

// Smaller sub-heading nested inside a SectionLabel'd block (e.g. the three
// color subgroups) — same muted uppercase treatment, no border so it reads
// as a level below the section label rather than a sibling section.
function SubLabel({ children }) {
  return (
    <div style={{ fontSize: 9, color: '#5A4535', fontWeight: 700, letterSpacing: 1.2,
      textTransform: 'uppercase', marginBottom: 8 }}>{children}</div>
  );
}
