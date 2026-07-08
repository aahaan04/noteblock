import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
  {
    auth: {
      detectSessionInUrl: true,   // harmless no-op now (no more email-link redirects), left on
      persistSession: true,       // remembers the session across visits
      autoRefreshToken: true,
    },
  }
);
