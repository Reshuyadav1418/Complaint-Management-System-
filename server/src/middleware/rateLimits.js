import { rateLimit } from 'express-rate-limit';
import env from '../config/env.js';

const handler = (_req, res) =>
  res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many requests. Wait a moment and try again.' } });

export const apiLimiter = rateLimit({
  windowMs: 60_000,
  limit: env.isTest ? 10_000 : env.RATE_LIMIT_PER_MINUTE,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler,
});

// Per-IP limit on sign-in attempts, on top of per-account lockout.
export const loginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: env.isTest ? 10_000 : 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  handler,
});

// Meta sends bursts; this only stops floods of forged requests.
export const webhookLimiter = rateLimit({
  windowMs: 60_000,
  limit: env.isTest ? 10_000 : 600,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler,
});
