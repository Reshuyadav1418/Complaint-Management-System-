import { resolveSession, SESSION_COOKIE } from '../services/authService.js';

/** Require a valid session; attaches req.user and req.permissions. */
export async function authenticate(req, _res, next) {
  const { user, permissions } = await resolveSession(req.cookies?.[SESSION_COOKIE]);
  req.user = user;
  req.permissions = new Set(permissions);
  next();
}
