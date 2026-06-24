import { createContext, useContext, useEffect, useState, useRef } from 'react';
import { supabase } from '../lib/supabase.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const loadingRef = useRef(false); // prevent concurrent loadProfile calls

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      if (s?.user) loadProfile(s.user);
      else setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (s?.user) {
        // Only reload profile on meaningful events, not every refresh
        if (['SIGNED_IN', 'TOKEN_REFRESHED', 'USER_UPDATED'].includes(event)) {
          loadProfile(s.user);
        }
      } else {
        setProfile(null);
        setLoading(false);
        loadingRef.current = false;
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  async function loadProfile(authUser) {
    if (loadingRef.current) return;
    loadingRef.current = true;

    try {
      const { data } = await supabase
        .from('users')
        .select('id, email, display_name, role, credits_balance, language')
        .eq('id', authUser.id)
        .maybeSingle();

      if (data) {
        setProfile(data);
        setLoading(false);
        loadingRef.current = false;
        return;
      }

      // Row missing — create it
      const meta = authUser.user_metadata ?? {};
      const newProfile = {
        id: authUser.id,
        email: authUser.email ?? '',
        display_name: meta.display_name ?? authUser.email?.split('@')[0] ?? 'User',
        role: meta.role ?? 'guest',
        credits_balance: 0,
        language: 'en',
      };

      const { data: created, error } = await supabase
        .from('users')
        .upsert(newProfile, { onConflict: 'id' })
        .select()
        .single();

      if (error) console.warn('Could not save profile to DB:', error.message);
      setProfile(created ?? newProfile);
    } catch (e) {
      console.error('loadProfile error:', e);
      setProfile(null);
    } finally {
      setLoading(false);
      loadingRef.current = false;
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

  async function sendMagicLink(email, redirectTo) {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo },
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
      .select('id, email, display_name, role, credits_balance, language')
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
      signUp, signIn, signOut, refreshProfile, sendMagicLink,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
