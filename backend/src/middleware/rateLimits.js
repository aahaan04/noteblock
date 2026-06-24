import rateLimit from 'express-rate-limit';

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
