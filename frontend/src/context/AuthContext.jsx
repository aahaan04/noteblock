import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (data.session) loadProfile(data.session.user.id);
      else setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, sess) => {
      setSession(sess);
      if (sess) loadProfile(sess.user.id);
      else { setProfile(null); setLoading(false); }
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  // Load profile from public.users; create it if the DB trigger missed it
  async function loadProfile(userId) {
    try {
      // First attempt
      let { data } = await supabase
        .from('users')
        .select('*')
        .eq('id', userId)
        .single();

      if (!data) {
        // Trigger may not have fired — create the row ourselves
        const { data: { user } } = await supabase.auth.getUser();
        const meta = user?.user_metadata ?? {};
        const { data: created } = await supabase
          .from('users')
          .upsert({
            id: userId,
            email: user?.email ?? '',
            display_name: meta.display_name ?? user?.email?.split('@')[0] ?? 'User',
            role: meta.role ?? 'guest',
            credits_balance: 0,
            language: 'en',
          }, { onConflict: 'id' })
          .select()
          .single();
        data = created;
      }

      setProfile(data ?? null);
    } catch (e) {
      console.error('loadProfile error:', e);
      setProfile(null);
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
    if (!session?.user?.id) return;
    const { data } = await supabase
      .from('users')
      .select('*')
      .eq('id', session.user.id)
      .single();
    if (data) setProfile(data);
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
