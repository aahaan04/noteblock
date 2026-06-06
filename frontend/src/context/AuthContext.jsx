import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { api } from '../lib/api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (data.session) loadProfile(data.session.access_token);
      else setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, sess) => {
      setSession(sess);
      if (sess) loadProfile(sess.access_token);
      else { setProfile(null); setLoading(false); }
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  async function loadProfile(token) {
    try {
      const p = await api.users.profile(token);
      setProfile(p);
    } catch {
      // profile may not exist yet (trigger handles creation)
    } finally {
      setLoading(false);
    }
  }

  async function signUp(email, password, displayName, role) {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { display_name: displayName, role } },
    });
    if (error) throw error;
    return data;
  }

  async function signIn(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  }

  async function signInWithGoogle() {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    });
    if (error) throw error;
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  async function refreshProfile() {
    if (!session?.access_token) return;
    await loadProfile(session.access_token);
  }

  const token = session?.access_token ?? null;
  const user = session?.user ?? null;

  return (
    <AuthContext.Provider value={{
      session, user, profile, token, loading,
      signUp, signIn, signInWithGoogle, signOut, refreshProfile,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
