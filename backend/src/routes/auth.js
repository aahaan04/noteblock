import { Router } from 'express';
import crypto from 'crypto';
import { supabaseAdmin, supabasePublic } from '../lib/supabase.js';
import { optionalAuth } from '../middleware/auth.js';
import { body, schemas } from '../middleware/validate.js';
import { otpStartLimiter, otpStartIpLimiter, otpVerifyLimiter } from '../middleware/rateLimits.js';
import { startSmsVerification, checkSmsVerification } from '../lib/twilio.js';

const router = Router();

const SEND_FAILED_MSG = "We couldn't send a code to this number. Please check the number and try again.";
const CHECK_FAILED_MSG = "We couldn't verify that code. Please request a new one.";
const WRONG_CODE_MSG = 'That code is incorrect or has expired. Please try again.';
const PHONE_TAKEN_MSG = 'This phone number is already linked to a different account.';

// ── TEMP TEST BYPASS ─────────────────────────────────────────────────────
// Any number ending in these digits skips Twilio/OTP entirely and logs
// straight into one fixed, reusable guest account, so the guest flow can be
// exercised repeatedly without a real phone. Guest-only by construction —
// issueSessionForPhone below is always called with role 'guest' for this
// path, so it can never produce a host session no matter where the number
// is typed. No env-var gate: this is live as soon as it's deployed. Remove
// this whole block (and its call site further down) once real-device
// testing is done.
const BYPASS_SUFFIX = '9999999999';
const BYPASS_PHONE = '+919999999999'; // fixed canonical identity — same account every time, regardless of which country was actually selected
const BYPASS_DISPLAY_NAME = 'Guest #9999';

// Finds-or-creates a user for phone_number and issues a real Supabase
// session for them — the fresh-login/signup half of what used to be inlined
// into /otp/verify, pulled out so the test bypass above can reuse the exact
// same account/session logic instead of a second hand-written copy of it.
// Returns { access_token, refresh_token, is_new_user, userId } on success,
// or { errorStatus, errorBody } on failure — callers translate that into
// the actual HTTP response themselves.
async function issueSessionForPhone(phone_number, role) {
  const { data: existing } = await supabaseAdmin
    .from('users').select('id, display_name').eq('phone_number', phone_number).maybeSingle();

  let userId = existing?.id;
  let isNewUser = !existing?.display_name;

  if (!userId) {
    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      phone: phone_number,
      phone_confirm: true,
      user_metadata: { role: role === 'host' ? 'host' : 'guest' },
    });
    if (createErr || !created?.user) {
      console.error('[auth/issueSession create]', `code=${createErr?.code}`, `status=${createErr?.status}`, createErr?.message);
      if (createErr?.code === 'phone_exists' || createErr?.status === 422) {
        return { errorStatus: 409, errorBody: { error: PHONE_TAKEN_MSG } };
      }
      return { errorStatus: 500, errorBody: { error: 'Internal server error' } };
    }
    userId = created.user.id;
    isNewUser = true;

    const { error: updateErr } = await supabaseAdmin
      .from('users')
      .update({ phone_number, phone_verified: true })
      .eq('id', userId);
    if (updateErr) {
      console.error('[auth/issueSession create-link]', `code=${updateErr.code}`, updateErr.message, updateErr.details ?? '');
      await supabaseAdmin.auth.admin.deleteUser(userId).catch(() => {});
      if (updateErr.code === '23505') return { errorStatus: 409, errorBody: { error: PHONE_TAKEN_MSG } };
      return { errorStatus: 500, errorBody: { error: 'Internal server error' } };
    }
  } else {
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
    console.error('[auth/issueSession password]', `code=${pwErr.code}`, `status=${pwErr.status}`, pwErr.message);
    if (isNewUser) await supabaseAdmin.auth.admin.deleteUser(userId).catch(() => {});
    return { errorStatus: 500, errorBody: { error: 'Internal server error' } };
  }
  const { data: signInData, error: signInErr } = await supabasePublic.auth.signInWithPassword({
    phone: phone_number,
    password: tempPassword,
  });
  if (signInErr || !signInData?.session) {
    console.error('[auth/issueSession signin]', `code=${signInErr?.code}`, `status=${signInErr?.status}`, signInErr?.message);
    if (isNewUser) await supabaseAdmin.auth.admin.deleteUser(userId).catch(() => {});
    return { errorStatus: 500, errorBody: { error: 'Internal server error' } };
  }

  return {
    access_token: signInData.session.access_token,
    refresh_token: signInData.session.refresh_token,
    is_new_user: isNewUser,
    userId,
  };
}

// POST /api/auth/otp/start — send a 6-digit code via SMS (Twilio Verify).
// Rate limited per phone number AND per IP (otpStartIpLimiter catches one IP
// spraying codes across many different numbers, which the phone-keyed limiter
// alone can't see), on top of the global per-IP limiter applied to all /api
// routes.
router.post('/otp/start', otpStartIpLimiter, otpStartLimiter, body(schemas.otpStart), async (req, res) => {
  if (req.body.phone_number.endsWith(BYPASS_SUFFIX)) {
    const result = await issueSessionForPhone(BYPASS_PHONE, 'guest');
    if (result.errorStatus) return res.status(result.errorStatus).json(result.errorBody);
    // Force the display name on every login (not just first creation) so
    // this fixed test identity stays predictable regardless of whether the
    // normal "pick a display name" flow ever ran for it.
    await supabaseAdmin.from('users').update({ display_name: BYPASS_DISPLAY_NAME }).eq('id', result.userId);
    return res.json({
      bypass: true,
      access_token: result.access_token,
      refresh_token: result.refresh_token,
      is_new_user: false, // name is always pre-set above — never prompt for one
    });
  }
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
  const result = await issueSessionForPhone(phone_number, role);
  if (result.errorStatus) return res.status(result.errorStatus).json(result.errorBody);

  res.json({
    access_token: result.access_token,
    refresh_token: result.refresh_token,
    is_new_user: result.is_new_user,
  });
});

export default router;
