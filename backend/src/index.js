import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';

import venuesRouter from './routes/venues.js';
import queueRouter from './routes/queue.js';
import youtubeRouter from './routes/youtube.js';
import usersRouter from './routes/users.js';
import creditsRouter from './routes/credits.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

// Health check
app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'noteblock-api' }));

// API routes
app.use('/api/venues', venuesRouter);
app.use('/api/venues/:venueId/queue', queueRouter);
app.use('/api/youtube', youtubeRouter);
app.use('/api/users', usersRouter);
app.use('/api/credits', creditsRouter);

// Serve built frontend (production)
const frontendDist = join(__dirname, '../../frontend/dist');
if (existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  // SPA fallback — all non-API routes return index.html
  app.get('*', (_req, res) => {
    res.sendFile(join(frontendDist, 'index.html'));
  });
} else {
  app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
}

app.listen(PORT, () => {
  console.log(`🎵 Noteblock running on http://localhost:${PORT}`);
});
