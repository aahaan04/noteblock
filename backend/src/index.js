import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';
import { globalLimiter } from './middleware/rateLimits.js';

import venuesRouter from './routes/venues.js';
import queueRouter from './routes/queue.js';
import youtubeRouter from './routes/youtube.js';
import usersRouter from './routes/users.js';
import creditsRouter from './routes/credits.js';
import authRouter from './routes/auth.js';
import { startVibeAggregationSchedule } from './jobs/vibeAggregation.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

// ── Security headers ──────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", 'https://www.youtube.com', 'https://s.ytimg.com'],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https://*.ytimg.com', 'https://img.youtube.com'],
      frameSrc: ['https://www.youtube.com', 'https://www.youtube-nocookie.com'],
      connectSrc: [
        "'self'",
        'https://*.supabase.co',
        'https://*.supabase.io',
        'wss://*.supabase.co',
        'wss://*.supabase.io',
      ],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
    },
  },
  // YouTube iframes require cross-origin embedding
  crossOriginEmbedderPolicy: false,
}));

// ── CORS — API routes only ────────────────────────────────────────────────────
// Static files must NOT go through CORS middleware: Vite's <script type="module"
// crossorigin> causes the browser to fetch the JS bundle in CORS mode. If the
// middleware blocks it (origin not in allowlist), the bundle never loads.
// The API uses Bearer token auth (not cookies), so same-origin enforcement is
// already provided by the JS same-origin policy on localStorage.
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',').map(s => s.trim()).filter(Boolean);

const corsMiddleware = cors({
  origin(origin, cb) {
    // No origin = navigation / server-to-server — allow
    if (!origin) return cb(null, true);
    // If ALLOWED_ORIGINS is configured, enforce it; otherwise allow all
    if (!allowedOrigins.length || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: ${origin} not allowed`));
  },
  credentials: true,
});

// ── Request body size limit ───────────────────────────────────────────────────
app.use(express.json({ limit: '64kb' }));

// ── Global rate limit ─────────────────────────────────────────────────────────
app.use('/api', globalLimiter);

// Health check
app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'noteblock-api' }));

// API routes — CORS applied here only, not to static files
app.use('/api/venues', corsMiddleware, venuesRouter);
app.use('/api/venues/:venueId/queue', corsMiddleware, queueRouter);
app.use('/api/youtube', corsMiddleware, youtubeRouter);
app.use('/api/users', corsMiddleware, usersRouter);
app.use('/api/credits', corsMiddleware, creditsRouter);
app.use('/api/auth', corsMiddleware, authRouter);

// ── Serve built frontend (production) ────────────────────────────────────────
const frontendDist = join(__dirname, '../../frontend/dist');
if (existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  app.get('*', (_req, res) => {
    res.sendFile(join(frontendDist, 'index.html'));
  });
} else {
  app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
}

// ── Global error handler — never send stack traces or DB details to clients ───
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.message?.startsWith('CORS:')) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  console.error('[error]', req.method, req.path, err.message);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`🎵 Noteblock running on http://localhost:${PORT}`);
  // Background-only: recomputes venue_vibe_data every 15 min for venues with
  // new activity. Never runs synchronously in the request path.
  startVibeAggregationSchedule();
});
