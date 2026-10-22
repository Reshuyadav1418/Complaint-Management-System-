import { AppError } from '../utils/AppError.js';

/** Allow the request only if the user has every listed permission. */
export function requirePermission(...required) {
  return (req, _res, next) => {
    const missing = required.filter((p) => !req.permissions?.has(p));
    if (missing.length) return next(AppError.forbidden());
    return next();
  };
}

/** Allow the request if the user has at least one of the listed permissions. */
export function requireAnyPermission(...options) {
  return (req, _res, next) => {
    if (options.some((p) => req.permissions?.has(p))) return next();
    return next(AppError.forbidden());
  };
}

/**
 * Block everything except password change for users still on a temporary
 * password, so an admin-issued password cannot be used as a working login.
 */
export function requirePasswordChanged(req, _res, next) {
  if (req.user?.mustChangePassword) {
    return next(new AppError(403, 'PASSWORD_CHANGE_REQUIRED', 'Set a new password to continue.'));
  }
  return next();
}
