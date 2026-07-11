import { createContext, useContext, useEffect, useState, useRef } from 'react';
import { supabase } from '../lib/supabase.js';
import { api } from '../lib/api.js';

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
        .select('id, email, phone_number, phone_verified, display_name, role, credits_balance, language')
        .eq('id', authUser.id)
        .maybeSingle();

      if (data) {
        setProfile(data);
        setLoading(false);
        loadingRef.current = false;
        return;
      }

      // Row missing — create it. Phone-based signups are created via the
      // backend (handle_new_user trigger fires on auth.users insert), so
      // this fallback mainly covers legacy/edge-case timing gaps.
      const meta = authUser.user_metadata ?? {};
      const newProfile = {
        id: authUser.id,
        email: authUser.email ?? '',
        display_name: meta.display_name ?? authUser.email?.split('@')[0] ?? null,
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

  // Sends a 6-digit SMS OTP via the backend (Twilio Verify). No session
  // exists yet at this point — this is just the "send code" step.
  async function sendOtp(phoneNumber) {
    await api.auth.otpStart({ phone_number: phoneNumber });
  }

  // Checks the code. If this succeeds while the caller is NOT already logged
  // in, the backend returns a real Supabase session (access_token +
  // refresh_token) which we hydrate here via setSession — from this point on
  // everything (RLS, realtime, API calls) behaves exactly as it does after
  // any other login. Returns { is_new_user } so the caller knows whether to
  // prompt for a display name.
  async function verifyOtp(phoneNumber, code, { role } = {}) {
    const result = await api.auth.otpVerify({ phone_number: phoneNumber, code, role });
    const { error } = await supabase.auth.setSession({
      access_token: result.access_token,
      refresh_token: result.refresh_token,
    });
    if (error) throw error;
    return result;
  }

  // Attaches a phone number to the CURRENTLY logged-in account (e.g. an old
  // email-only account linking a phone for the first time). Uses the
  // existing session's token, so the backend treats this as a link, not a
  // fresh signup — no new session is issued, the current one keeps working.
  async function linkPhone(phoneNumber, code) {
    await api.auth.otpVerify({ phone_number: phoneNumber, code }, token);
    await refreshProfile();
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  async function refreshProfile() {
    if (!session?.user) return;
    const { data } = await supabase
      .from('users')
      .select('id, email, phone_number, phone_verified, display_name, role, credits_balance, language')
      .eq('id', session.user.id)
      .maybeSingle();
    if (data) setProfile(data);
  }

  const token = session?.access_token ?? null;

  return (
    <AuthContext.Provider value={{
      session,
      user: session?.user ?? null,
      profile,
      token,
      loading,
      sendOtp, verifyOtp, linkPhone, signOut, refreshProfile,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
