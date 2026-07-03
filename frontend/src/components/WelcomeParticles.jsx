import { useEffect, useRef } from 'react';

const SVG_NS = 'http://www.w3.org/2000/svg';
const NOTE_COLORS = ['#FF6B35', '#C89B6E'];
const PIXEL_COLORS = ['#8B5A2B', '#6B4226', '#FF6B35', '#C89B6E'];
const MAX_PARTICLES = 18; // hard cap so the DOM node count never grows unbounded

// All three glyphs below are built purely from circles + rectangles (no thin
// diagonal paths or curves) since that's what stayed crisp and readable at
// particle size (10-18px) with rotation applied — the earlier "beamed
// eighth notes" glyph used a connecting path that blurred into a blob at
// this scale, which is why it was replaced with the plain quarter note.
// These three keep that same constraint while giving some visual variety.

function svgBase(size) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'currentColor');
  return svg;
}
function circle(cx, cy, r) {
  const c = document.createElementNS(SVG_NS, 'circle');
  c.setAttribute('cx', cx); c.setAttribute('cy', cy); c.setAttribute('r', r);
  return c;
}
function rect(x, y, w, h) {
  const r = document.createElementNS(SVG_NS, 'rect');
  r.setAttribute('x', x); r.setAttribute('y', y); r.setAttribute('width', w); r.setAttribute('height', h);
  return r;
}
function triangle(x1, y1, x2, y2, x3, y3) {
  const p = document.createElementNS(SVG_NS, 'polygon');
  p.setAttribute('points', `${x1},${y1} ${x2},${y2} ${x3},${y3}`);
  return p;
}

// Quarter note ♩ — notehead + stem.
function buildQuarterNote(mirrored, size) {
  const svg = svgBase(size);
  const nx = mirrored ? 16 : 8;
  const sx = mirrored ? 18.3 : 10.3;
  svg.appendChild(circle(nx, 18, 4.5));
  svg.appendChild(rect(sx, 3, 2.4, 15.5));
  return svg;
}

// Eighth note ♪ — notehead + stem + a small filled flag.
function buildEighthNote(mirrored, size) {
  const svg = svgBase(size);
  const nx = mirrored ? 16 : 8;
  const sx = mirrored ? 18.3 : 10.3;
  const dir = mirrored ? -1 : 1;
  svg.appendChild(circle(nx, 18, 4.2));
  svg.appendChild(rect(sx, 3, 2.2, 15.5));
  svg.appendChild(triangle(sx + 2.2, 3, sx + 2.2 + dir * 6.5, 6.5, sx + 2.2, 10));
  return svg;
}

// Beamed pair ♫ — two noteheads joined by a straight beam bar (no diagonal path).
function buildBeamedPair(size) {
  const svg = svgBase(size);
  svg.appendChild(circle(5.5, 19, 3.6));
  svg.appendChild(circle(15.5, 19, 3.6));
  svg.appendChild(rect(7.6, 4, 2.1, 15));
  svg.appendChild(rect(17.6, 4, 2.1, 15));
  svg.appendChild(rect(7.6, 4, 12.1, 2.6));
  return svg;
}

const NOTE_BUILDERS = [
  size => buildQuarterNote(Math.random() > 0.5, size),
  size => buildEighthNote(Math.random() > 0.5, size),
  size => buildBeamedPair(size),
];

function buildRandomNote(size) {
  const builder = NOTE_BUILDERS[Math.floor(Math.random() * NOTE_BUILDERS.length)];
  return builder(size);
}

// Ambient particle layer for the welcome screen. Spawns two layers of rising
// musical notes from behind the logo on a fixed interval — larger orange/tan
// notes less often, smaller brown/orange notes more frequently — each
// removing itself from the DOM once its CSS animation finishes so the
// particle count never grows unbounded.
export default function WelcomeParticles() {
  const layerRef = useRef(null);
  const countRef = useRef(0);

  useEffect(() => {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) return; // static screen — no spawning at all

    const layer = layerRef.current;
    if (!layer) return;

    function release(el) {
      el.remove();
      countRef.current = Math.max(0, countRef.current - 1);
    }

    function spawnNote() {
      if (countRef.current >= MAX_PARTICLES) return;
      const el = document.createElement('div');
      el.className = 'wp-note';
      el.appendChild(buildRandomNote(Math.random() > 0.5 ? 14 : 18));

      const xOffset = (Math.random() - 0.5) * 90;
      const drift = (Math.random() - 0.5) * 50;
      const duration = 3.5 + Math.random() * 2;
      el.style.left = `calc(50% + ${xOffset}px)`;
      el.style.setProperty('--drift', `${drift}px`);
      el.style.animationDuration = `${duration}s`;
      el.style.color = NOTE_COLORS[Math.floor(Math.random() * NOTE_COLORS.length)];

      layer.appendChild(el);
      countRef.current++;
      setTimeout(() => release(el), duration * 1000);
    }

    function spawnPixel() {
      if (countRef.current >= MAX_PARTICLES) return;
      const el = document.createElement('div');
      el.className = 'wp-pixel';
      // Kept at a size where the notehead/stem are still legible — going
      // much smaller (or shrinking via a CSS scale transform) just reads as
      // an indistinct blob, i.e. right back to looking like a plain pixel.
      const size = 10 + Math.random() * 4;
      el.appendChild(buildRandomNote(size));
      const xOffset = (Math.random() - 0.5) * 80;
      const drift = (Math.random() - 0.5) * 40;
      const duration = 2 + Math.random() * 1.5;
      el.style.left = `calc(50% + ${xOffset}px)`;
      el.style.setProperty('--drift', `${drift}px`);
      el.style.animationDuration = `${duration}s`;
      el.style.color = PIXEL_COLORS[Math.floor(Math.random() * PIXEL_COLORS.length)];

      layer.appendChild(el);
      countRef.current++;
      setTimeout(() => release(el), duration * 1000);
    }

    const noteInterval = setInterval(spawnNote, 550);
    const pixelInterval = setInterval(spawnPixel, 220);

    // Seed a few immediately so the screen doesn't look empty on first paint.
    const seedTimeouts = [
      ...Array.from({ length: 4 }, (_, i) => setTimeout(spawnNote, i * 200)),
      ...Array.from({ length: 8 }, (_, i) => setTimeout(spawnPixel, i * 80)),
    ];

    return () => {
      clearInterval(noteInterval);
      clearInterval(pixelInterval);
      seedTimeouts.forEach(clearTimeout);
      layer.replaceChildren(); // drop any still-animating particles on unmount
      countRef.current = 0;
    };
  }, []);

  return (
    <>
      <div ref={layerRef} className="wp-layer" />
      <style>{`
        .wp-layer {
          position: absolute; inset: 0;
          pointer-events: none;
          z-index: 1;
        }
        .wp-note {
          position: absolute;
          top: 55%;
          opacity: 0;
          animation: wp-note-float linear infinite;
        }
        @keyframes wp-note-float {
          0%   { transform: translateY(0) translateX(0) rotate(-6deg) scale(0.8); opacity: 0; }
          12%  { opacity: 0.9; }
          50%  { transform: translateY(-90px) translateX(var(--drift)) rotate(6deg) scale(1); }
          85%  { opacity: 0.5; }
          100% { transform: translateY(-170px) translateX(calc(var(--drift) * 1.6)) rotate(-4deg) scale(0.85); opacity: 0; }
        }
        .wp-pixel {
          position: absolute;
          top: 55%;
          opacity: 0;
          animation: wp-pixel-float linear infinite;
        }
        @keyframes wp-pixel-float {
          0%   { transform: translateY(0) translateX(0) rotate(-8deg); opacity: 0; }
          10%  { opacity: 1; }
          80%  { opacity: 0.7; }
          100% { transform: translateY(-120px) translateX(var(--drift)) rotate(8deg); opacity: 0; }
        }
        @media (prefers-reduced-motion: reduce) {
          .wp-note, .wp-pixel { display: none; }
        }
      `}</style>
    </>
  );
}
