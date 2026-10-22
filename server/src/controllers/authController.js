import * as authService from '../services/authService.js';
import { ok } from '../utils/http.js';
import { requestContext } from '../utils/http.js';

const { SESSION_COOKIE, sessionCookieOptions } = authService;

export async function login(req, res) {
  const { user, permissions, token } = await authService.login(req.body, requestContext(req));
  res.cookie(SESSION_COOKIE, token, sessionCookieOptions());
  return ok(res, authService.sessionPayload(user, permissions));
}

export async function me(req, res) {
  return ok(res, authService.sessionPayload(req.user, [...req.permissions].sort()));
}

export async function logout(_req, res) {
  const { maxAge, ...opts } = sessionCookieOptions();
  res.clearCookie(SESSION_COOKIE, opts);
  return res.status(204).end();
}

export async function logoutAll(req, res) {
  await authService.signOutEverywhere(req.user, requestContext(req));
  const { maxAge, ...opts } = sessionCookieOptions();
  res.clearCookie(SESSION_COOKIE, opts);
  return res.status(204).end();
}

export async function changePassword(req, res) {
  const { user, token } = await authService.changePassword(req.user._id, req.body, requestContext(req));
  res.cookie(SESSION_COOKIE, token, sessionCookieOptions());
  await user.populate('department', 'name code');
  return ok(res, authService.sessionPayload(user, [...req.permissions].sort()));
}
