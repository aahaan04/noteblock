# 🎵 Noteblock

A digital jukebox platform for the Indian market. Guests scan a QR code, request songs with credits, and the host's browser plays them — no hardware needed.

---

## Quick Start

### 1. Supabase Schema

1. Open your Supabase project → **SQL Editor** → **New query**
2. Paste the entire contents of `supabase/schema.sql`
3. Click **Run**

### 2. Get your Service Role Key

1. Supabase Dashboard → **Settings** → **API**
2. Copy the **service_role** key (below the anon key)
3. Add it to `backend/.env` as `SUPABASE_SERVICE_ROLE_KEY`

### 3. Backend

```bash
cd backend
npm install
# Edit .env — fill in SUPABASE_SERVICE_ROLE_KEY
npm run dev        # starts on http://localhost:3001
```

### 4. Frontend

```bash
cd frontend
npm install
npm run dev        # starts on http://localhost:5173
```

Open http://localhost:5173

---

## Environment Variables

### `backend/.env`

```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...   ← get this from Supabase Settings → API
YOUTUBE_API_KEY=...
PORT=3001
```

### `frontend/.env`

```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=...
VITE_API_URL=http://localhost:3001
```

---

## How to get a YouTube Data API v3 Key

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create or select a project
3. **APIs & Services** → **Library** → search "YouTube Data API v3" → **Enable**
4. **APIs & Services** → **Credentials** → **+ Create Credentials** → **API key**
5. (Recommended) Restrict the key to "YouTube Data API v3"
6. Copy the key into both `.env` files

---

## Razorpay (Payments — not yet active)

Stubs are in `backend/src/routes/credits.js`. To activate:

1. Create account at [razorpay.com](https://razorpay.com)
2. Dashboard → **Settings** → **API Keys** → **Generate Test Key**
3. Add to `backend/.env`:
   ```
   RAZORPAY_KEY_ID=rzp_test_...
   RAZORPAY_KEY_SECRET=...
   ```
4. `npm install razorpay` in the backend
5. Uncomment the Razorpay code in `credits.js`

---

## Project Structure

```
noteblock/
├── backend/          Express API (Node.js)
│   └── src/
│       ├── routes/   venues, queue, youtube, users, credits
│       └── middleware/auth.js
├── frontend/         React + Vite
│   └── src/
│       ├── pages/    Landing, HostDashboard, VenueControl, GuestJoin, GuestRoom
│       ├── components/ CrossfadePlayer, QueueDisplay, SongSearch, NowPlaying, …
│       ├── context/  AuthContext, LangContext
│       └── locales/  en.js, hi.js
└── supabase/
    └── schema.sql
```

---

## Deploy

### Frontend → Vercel

```bash
cd frontend
npm run build
# Push to GitHub → import at vercel.com
# Set environment variables in Vercel dashboard
```

Set `VITE_API_URL` to your backend URL (e.g. `https://noteblock-api.up.railway.app`).

### Backend → Railway / Render

**Railway:**
1. New project → Deploy from GitHub → select `backend/` folder
2. Add environment variables
3. It auto-detects Node.js and runs `npm start`

**Render:**
1. New Web Service → connect repo → root dir = `backend`
2. Build command: `npm install`
3. Start command: `npm start`

---

## How It Works

- **Host** creates a venue → gets a permanent QR code → opens the room
- The host's browser IS the player (YouTube IFrame API + crossfade)
- **Guests** scan the QR → pick songs → pay with credits
- Everything syncs in real-time via Supabase subscriptions
- No app install needed — pure browser

## Credit System

| Action | Credits |
|--------|---------|
| Welcome gift (first join) | 10 (host-configured) |
| Normal Play | 2 |
| Quick Play (0–2 songs in queue) | 3 |
| Quick Play (3–5 songs) | 5 |
| Quick Play (6–9 songs) | 7 |
| Quick Play (10+ songs) | 10 |
