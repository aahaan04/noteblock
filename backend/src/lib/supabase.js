import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.SUPABASE_ANON_KEY;

// Admin client — bypasses RLS, used for atomic server-side operations
export const supabaseAdmin = createClient(url, serviceKey, {
  auth: { persistSession: false },
});

// Creates a user-scoped client using their JWT (respects RLS)
export function supabaseForUser(jwt) {
  return createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false },
  });
}
