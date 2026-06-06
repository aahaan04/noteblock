import { supabaseAdmin } from '../lib/supabase.js';

// Require valid Supabase JWT. Attaches req.user and req.token.
export async function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing token' });
  }
  const token = header.slice(7);
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) {
    return res.status(401).json({ error: 'Invalid token' });
  }
  req.user = data.user;
  req.token = token;
  next();
}

// Require host role
export async function requireHost(req, res, next) {
  await requireAuth(req, res, async () => {
    const { data } = await supabaseAdmin
      .from('users')
      .select('role')
      .eq('id', req.user.id)
      .single();
    if (data?.role !== 'host') {
      return res.status(403).json({ error: 'Host role required' });
    }
    next();
  });
}

// Optional auth — attaches req.user if token present, otherwise continues
export async function optionalAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return next();
  const token = header.slice(7);
  const { data } = await supabaseAdmin.auth.getUser(token);
  if (data?.user) {
    req.user = data.user;
    req.token = token;
  }
  next();
}
