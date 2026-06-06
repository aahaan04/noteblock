import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Get existing session on mount
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      if (s?.user) {
        loadProfile(s.user);
      } else {
        setLoading(false);
      }
    });

    // Listen for auth state changes (login, logout, signup)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (s?.user) {
        loadProfile(s.user);
      } else {
        setProfile(null);
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  async function loadProfile(authUser) {
    try {
      // Try to read existing row
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', authUser.id)
        .maybeSingle(); // returns null instead of error when not found

      if (data) {
        setProfile(data);
        setLoading(false);
        return;
      }

      // Row missing — create it from auth metadata
      const meta = authUser.user_metadata ?? {};
      const newProfile = {
        id: authUser.id,
        email: authUser.email ?? '',
        display_name: meta.display_name ?? authUser.email?.split('@')[0] ?? 'User',
        role: meta.role ?? 'guest',
        credits_balance: 0,
        language: 'en',
      };

      const { data: created, error: upsertError } = await supabase
        .from('users')
        .upsert(newProfile, { onConflict: 'id' })
        .select()
        .single();

      if (upsertError) {
        console.error('Profile upsert error:', upsertError);
        // Use in-memory profile so the app still works
        setProfile(newProfile);
      } else {
        setProfile(created);
      }
    } catch (e) {
      console.error('loadProfile unexpected error:', e);
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
    if (!session?.user) return;
    const { data } = await supabase
      .from('users')
      .select('*')
      .eq('id', session.user.id)
      .maybeSingle();
    if (data) setProfile(data);
  }

  return (
    <AuthContext.Provider value={{
      session,
      user: session?.user ?? null,
      profile,
      token: session?.access_token ?? null,
      loading,
      signUp, signIn, signInWithGoogle, signOut, refreshProfile,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
