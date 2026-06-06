import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext.jsx';
import { LangProvider } from './context/LangContext.jsx';

import Landing from './pages/Landing.jsx';
import HostDashboard from './pages/HostDashboard.jsx';
import VenueControl from './pages/VenueControl.jsx';
import GuestJoin from './pages/GuestJoin.jsx';
import GuestRoom from './pages/GuestRoom.jsx';
import GuestHome from './pages/GuestHome.jsx';
import Settings from './pages/Settings.jsx';

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
    </LangProvider>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
