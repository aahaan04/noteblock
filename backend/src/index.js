import 'dotenv/config';
import express from 'express';
import cors from 'cors';

import venuesRouter from './routes/venues.js';
import queueRouter from './routes/queue.js';
import youtubeRouter from './routes/youtube.js';
import usersRouter from './routes/users.js';
import creditsRouter from './routes/credits.js';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

// Health check
app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'noteblock-api' }));

// Routes
app.use('/api/venues', venuesRouter);
app.use('/api/venues/:venueId/queue', queueRouter);
app.use('/api/youtube', youtubeRouter);
app.use('/api/users', usersRouter);
app.use('/api/credits', creditsRouter);

// 404 catch-all
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

app.listen(PORT, () => {
  console.log(`🎵 Noteblock API running on http://localhost:${PORT}`);
});
