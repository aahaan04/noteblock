import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

const msg = { error: 'Too many requests, please try again later' };

// 1000 req / 15 min per IP — protects all API routes from basic flooding
export const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: msg,
});

// 5 song requests / min per IP — prevents request spam
export const queueLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: msg,
});

// 10 credit operations / min per IP
export const creditLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: msg,
});

// 30 YouTube requests / min per IP — guards API quota
export const youtubeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many search requests, please slow down' },
});

// Phone-number-keyed limiters for the SMS OTP flow — separate from the
// IP-based limiters above since the abuse vector here is "many codes to one
// number," not "many requests from one IP." Falls back to IP only if the
// body hasn't been parsed/validated yet (defensive; body() runs after these
// in the route chain so req.body.phone_number is normally already present).
const otpMsg = { error: 'Too many verification code requests for this number. Please try again later.' };
export const otpStartLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.body?.phone_number || ipKeyGenerator(req.ip),
  message: otpMsg,
});

// A little more headroom than the send limiter — legitimate users mistype
// codes — but still bounded well below what it'd take to brute-force a
// 6-digit code (Twilio Verify also locks out a verification after repeated
// wrong checks on its own side).
export const otpVerifyLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.body?.phone_number || ipKeyGenerator(req.ip),
  message: otpMsg,
});
