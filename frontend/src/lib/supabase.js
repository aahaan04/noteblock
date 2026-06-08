import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
  {
    auth: {
      detectSessionInUrl: true,   // picks up magic link token from URL automatically
      persistSession: true,       // remembers the session across visits
      autoRefreshToken: true,
    },
  }
);
