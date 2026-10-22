import env from '../config/env.js';
import { AppError } from '../utils/AppError.js';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defence for cookie sessions. SameSite=Lax already blocks most
 * cross-site POSTs; this also rejects state-changing requests whose Origin
 * (or Referer) is not the web app. Requests with neither header (server to
 * server, tests, curl) are allowed because browsers always send Origin on
 * cross-site POST/PUT/PATCH/DELETE.
 *
 * Webhooks (e.g. WhatsApp) are mounted before this middleware and
 * authenticate with signatures instead.
 */
export function originCheck(req, _res, next) {
  if (SAFE.has(req.method)) return next();
  let origin = req.get('origin') || null;
  if (!origin && req.get('referer')) {
    try {
      origin = new URL(req.get('referer')).origin;
    } catch {
      return next(AppError.forbidden('Request origin not allowed.'));
    }
  }
  if (!origin || origin === env.CLIENT_ORIGIN) return next();
  return next(AppError.forbidden('Request origin not allowed.'));
}
