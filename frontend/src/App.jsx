import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext.jsx';
import { LangProvider } from './context/LangContext.jsx';
import { ThemeProvider } from './context/ThemeContext.jsx';

// Landing is kept eager — it is always the first thing rendered and is tiny (~5 KB parsed).
import Landing from './pages/Landing.jsx';

// Everything else is code-split so the initial bundle stays small.
// Host flow (CrossfadePlayer, Visualizer, VenueControl etc.) is one chunk.
// Guest flow (GuestRoom, SongSearch, QueueDisplay etc.) is another.
const HostDashboard = lazy(() => import('./pages/HostDashboard.jsx'));
const VenueControl  = lazy(() => import('./pages/VenueControl.jsx'));
const GuestJoin     = lazy(() => import('./pages/GuestJoin.jsx'));
const GuestRoom     = lazy(() => import('./pages/GuestRoom.jsx'));
const GuestHome     = lazy(() => import('./pages/GuestHome.jsx'));
const Settings      = lazy(() => import('./pages/Settings.jsx'));

// Minimal full-screen blank that matches the theme background.
// Prevents a white flash while a chunk is downloading on first visit.
function PageLoader() {
  return <div style={{ minHeight: '100vh', background: 'var(--bg-app)' }} />;
}

function ProtectedHost({ children }) {
  const { profile, loading } = useAuth();
  if (loading) return null;
  if (!profile || profile.role !== 'host') return <Navigate to="/" replace />;
  return children;
}

function AppRoutes() {
  const { profile } = useAuth();
  const lang = profile?.language;

  return (
    <LangProvider initialLang={lang}>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/host/dashboard" element={<ProtectedHost><HostDashboard /></ProtectedHost>} />
          <Route path="/host/venue/:id" element={<ProtectedHost><VenueControl /></ProtectedHost>} />
          <Route path="/join/:roomCode" element={<GuestJoin />} />
          <Route path="/room/:roomCode" element={<GuestRoom />} />
          <Route path="/guest" element={<GuestHome />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </LangProvider>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </BrowserRouter>
    </ThemeProvider>
  );
}
