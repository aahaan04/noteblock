import { Router } from 'express';
import crypto from 'crypto';
import { supabaseAdmin, supabasePublic } from '../lib/supabase.js';
import { optionalAuth } from '../middleware/auth.js';
import { body, schemas } from '../middleware/validate.js';
import { otpStartLimiter, otpVerifyLimiter } from '../middleware/rateLimits.js';
import { startSmsVerification, checkSmsVerification } from '../lib/twilio.js';

const router = Router();

const SEND_FAILED_MSG = "We couldn't send a code to this number. Please check the number and try again.";
const CHECK_FAILED_MSG = "We couldn't verify that code. Please request a new one.";
const WRONG_CODE_MSG = 'That code is incorrect or has expired. Please try again.';
const PHONE_TAKEN_MSG = 'This phone number is already linked to a different account.';

// POST /api/auth/otp/start — send a 6-digit code via SMS (Twilio Verify).
// Rate limited per phone number, on top of the global per-IP limiter
// already applied to all /api routes.
router.post('/otp/start', otpStartLimiter, body(schemas.otpStart), async (req, res) => {
  try {
    await startSmsVerification(req.body.phone_number);
    res.json({ success: true });
  } catch (err) {
    console.error('[auth/otp/start]', `code=${err.code}`, `status=${err.status}`, err.message, err.moreInfo ?? '');
    res.status(400).json({ error: SEND_FAILED_MSG });
  }
});

// POST /api/auth/otp/verify — check the code, then:
//  - if a valid session is already attached (optionalAuth found one): link
//    this phone to that existing account, no new session issued.
//  - else if the phone matches an existing user: log into that account.
//  - else: create a brand-new account for it.
// For the two non-linking cases, issues a real Supabase session using a
// server-generated one-time password (see the comment below) so every
// existing RLS policy, realtime subscription, and API call keeps working
// exactly as it does for an email/password session — the client never sees
// or sets a password.
router.post('/otp/verify', optionalAuth, otpVerifyLimiter, body(schemas.otpVerify), async (req, res) => {
  const { phone_number, code, role } = req.body;

  let approved;
  try {
    approved = await checkSmsVerification(phone_number, code);
  } catch (err) {
    console.error('[auth/otp/verify check]', err.message);
    return res.status(400).json({ error: CHECK_FAILED_MSG });
  }
  if (!approved) {
    return res.status(400).json({ error: WRONG_CODE_MSG });
  }

  // ── Linking: caller already has a valid session (e.g. an old email
  // account) and is attaching a phone number to it. ──
  if (req.user) {
    const { data: conflict } = await supabaseAdmin
      .from('users').select('id').eq('phone_number', phone_number).neq('id', req.user.id).maybeSingle();
    if (conflict) return res.status(409).json({ error: PHONE_TAKEN_MSG });

    const { error: linkAuthErr } = await supabaseAdmin.auth.admin.updateUserById(req.user.id, { phone: phone_number, phone_confirm: true });
    if (linkAuthErr) {
      console.error('[auth/otp/verify link-auth]', `code=${linkAuthErr.code}`, `status=${linkAuthErr.status}`, linkAuthErr.message);
      return res.status(500).json({ error: 'Internal server error' });
    }
    const { data, error } = await supabaseAdmin
      .from('users')
      .update({ phone_number, phone_verified: true })
      .eq('id', req.user.id)
      .select()
      .single();
    if (error) {
      console.error('[auth/otp/verify link]', `code=${error.code}`, error.message, error.details ?? '');
      if (error.code === '23505') return res.status(409).json({ error: PHONE_TAKEN_MSG });
      return res.status(500).json({ error: 'Internal server error' });
    }
    return res.json({ linked: true, profile: data });
  }

  // ── Fresh login or signup ──
  const { data: existing } = await supabaseAdmin
    .from('users').select('id, display_name').eq('phone_number', phone_number).maybeSingle();

  let userId = existing?.id;
  // Whether to send this login through the display-name prompt. Driven by
  // "does this account actually have a name yet," not "did we just create
  // the row this request" — an account whose creation partially succeeded
  // on an earlier attempt (e.g. phone_number got set but the flow then
  // failed on a later step before ever reaching the name prompt) would
  // otherwise be misclassified as "existing" forever and never get asked.
  let isNewUser = !existing?.display_name;

  if (!userId) {
    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      phone: phone_number,
      phone_confirm: true,
      user_metadata: { role: role === 'host' ? 'host' : 'guest' },
    });
    if (createErr || !created?.user) {
      console.error('[auth/otp/verify create]', `code=${createErr?.code}`, `status=${createErr?.status}`, createErr?.message);
      // Twilio's own account had already verified this code once before if
      // a prior attempt got this far but failed on a later step (see the
      // cleanup below) — but if that compensating delete itself ever failed,
      // this is the resulting symptom: every retry hits "phone already
      // registered" forever. Surface that distinctly so it's diagnosable
      // from the client error alone, not just server logs.
      if (createErr?.code === 'phone_exists' || createErr?.status === 422) {
        return res.status(409).json({ error: PHONE_TAKEN_MSG });
      }
      return res.status(500).json({ error: 'Internal server error' });
    }
    userId = created.user.id;
    isNewUser = true;

    const { error: updateErr } = await supabaseAdmin
      .from('users')
      .update({ phone_number, phone_verified: true })
      .eq('id', userId);
    if (updateErr) {
      console.error('[auth/otp/verify create-link]', `code=${updateErr.code}`, updateErr.message, updateErr.details ?? '');
      // Compensate: don't leave an orphaned auth user behind holding this
      // phone number hostage — every retry would otherwise fail forever
      // with "phone already registered" since createUser above can never
      // succeed again for the same number.
      await supabaseAdmin.auth.admin.deleteUser(userId).catch(() => {});
      if (updateErr.code === '23505') return res.status(409).json({ error: PHONE_TAKEN_MSG });
      return res.status(500).json({ error: 'Internal server error' });
    }
  } else {
    // Existing phone-native user re-verifying — keep auth.users.phone in
    // sync defensively (it should already match, this is a no-op safety net).
    await supabaseAdmin.auth.admin.updateUserById(userId, { phone: phone_number, phone_confirm: true });
    await supabaseAdmin.from('users').update({ phone_verified: true }).eq('id', userId);
  }

  // Set a fresh, random, one-time password server-side and immediately sign
  // in with it via the anon-key client. This is the standard way to obtain a
  // genuine GoTrue-issued (auto-refreshing) session for a user verified
  // through a third-party OTP provider instead of Supabase's own OTP —
  // Supabase's admin API has no direct "issue a session for this user" call.
  // The password is never returned to the client, never logged, and is
  // regenerated on every login — functionally invisible to the user.
  const tempPassword = crypto.randomBytes(32).toString('hex');
  const { error: pwErr } = await supabaseAdmin.auth.admin.updateUserById(userId, { password: tempPassword });
  if (pwErr) {
    console.error('[auth/otp/verify password]', `code=${pwErr.code}`, `status=${pwErr.status}`, pwErr.message);
    // Same compensation as above — only for accounts we just created this
    // request. An existing account that transiently fails here should stay
    // intact; the user just retries and re-enters this same branch again.
    if (isNewUser) await supabaseAdmin.auth.admin.deleteUser(userId).catch(() => {});
    return res.status(500).json({ error: 'Internal server error' });
  }
  const { data: signInData, error: signInErr } = await supabasePublic.auth.signInWithPassword({
    phone: phone_number,
    password: tempPassword,
  });
  if (signInErr || !signInData?.session) {
    console.error('[auth/otp/verify signin]', `code=${signInErr?.code}`, `status=${signInErr?.status}`, signInErr?.message);
    if (isNewUser) await supabaseAdmin.auth.admin.deleteUser(userId).catch(() => {});
    return res.status(500).json({ error: 'Internal server error' });
  }

  res.json({
    access_token: signInData.session.access_token,
    refresh_token: signInData.session.refresh_token,
    is_new_user: isNewUser,
  });
});

export default router;
