const BASE = import.meta.env.VITE_API_URL ?? '';

async function request(path, options = {}, token = null) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers ?? {}) };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error ?? 'Request failed'), { status: res.status, data });
  return data;
}

const get  = (path, token) => request(path, { method: 'GET' }, token);
const post = (path, body, token) => request(path, { method: 'POST', body: JSON.stringify(body) }, token);
const put  = (path, body, token) => request(path, { method: 'PUT', body: JSON.stringify(body) }, token);
const del  = (path, token) => request(path, { method: 'DELETE' }, token);
const patch = (path, body, token) => request(path, { method: 'PATCH', body: JSON.stringify(body) }, token);

// ── Venues ──────────────────────────────────────────────────────────────────
export const api = {
  venues: {
    list: (t) => get('/api/venues', t),
    get: (id, t) => get(`/api/venues/${id}`, t),
    getByCode: (code) => get(`/api/venues/room/${code}`),
    create: (body, t) => post('/api/venues', body, t),
    update: (id, body, t) => put(`/api/venues/${id}`, body, t),
    stats: (id, t) => get(`/api/venues/${id}/stats`, t),
    banned: {
      list: (venueId) => get(`/api/venues/${venueId}/banned`),
      add: (venueId, body, t) => post(`/api/venues/${venueId}/banned`, body, t),
      remove: (venueId, songId, t) => del(`/api/venues/${venueId}/banned/${songId}`, t),
    },
    gift: (venueId, body, t) => post(`/api/venues/${venueId}/gift`, body, t),
    users: (venueId, t) => get(`/api/venues/${venueId}/users`, t),
    removeUser: (venueId, name, t) => del(`/api/venues/${venueId}/users/${encodeURIComponent(name)}`, t),
    banUser: (venueId, body, t) => post(`/api/venues/${venueId}/banned-users`, body, t),
    unbanUser: (venueId, bannedUserId, t) => del(`/api/venues/${venueId}/banned-users/${bannedUserId}`, t),
    vibeData: (venueId, t) => get(`/api/venues/${venueId}/vibe-data`, t),
    uploadVibeFile: (venueId, body, t) => post(`/api/venues/${venueId}/vibe-file/upload`, body, t),
    removeVibeFile: (venueId, t) => del(`/api/venues/${venueId}/vibe-file`, t),
  },

  queue: {
    list: (venueId) => get(`/api/venues/${venueId}/queue`),
    price: (venueId) => get(`/api/venues/${venueId}/queue/price`),
    add: (venueId, body, t) => post(`/api/venues/${venueId}/queue`, body, t),
    updateStatus: (venueId, itemId, status, t) =>
      patch(`/api/venues/${venueId}/queue/${itemId}`, { status }, t),
    remove: (venueId, itemId, t) => del(`/api/venues/${venueId}/queue/${itemId}`, t),
  },

  youtube: {
    search: (q) => get(`/api/youtube/search?q=${encodeURIComponent(q)}`),
    suggestions: (vibe) => get(`/api/youtube/suggestions?vibe=${encodeURIComponent(vibe)}`),
    vibe: (description, limit = 50) =>
      get(`/api/youtube/vibe?description=${encodeURIComponent(description)}&limit=${limit}`),
    playlist: (playlistId) => get(`/api/youtube/playlist?playlistId=${playlistId}`),
  },

  users: {
    profile: (t) => get('/api/users/profile', t),
    updateProfile: (body, t) => put('/api/users/profile', body, t),
    savedRooms: (t) => get('/api/users/saved-rooms', t),
    welcome: (venueId, t) => post(`/api/users/welcome/${venueId}`, {}, t),
  },

  credits: {
    packages: () => get('/api/credits/packages'),
    purchaseIntent: (body, t) => post('/api/credits/purchase-intent', body, t),
    verify: (body, t) => post('/api/credits/verify', body, t),
  },
};
