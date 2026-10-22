import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { User } from '../models/index.js';
import env from '../config/env.js';
import { AppError } from '../utils/AppError.js';
import { permissionsFor } from './roleService.js';
import * as audit from './auditService.js';

// With HTTPS the __Host- prefix makes browsers refuse the cookie unless it is
// Secure, host-only and path=/, so a subdomain cannot overwrite the session.
export const SESSION_COOKIE = env.COOKIE_SECURE ? '__Host-sfa_session' : 'sfa_session';

// Compared against when the email is unknown, so response time does not
// reveal which emails have accounts. bcrypt hash of a random string.
const DUMMY_HASH = '$2b$12$Nve71FonH3HhfhLMNNME8O5AkT275MECjegUAm0lT3u5X43jEa9aG';

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'lax',
    path: '/',
    maxAge: env.SESSION_TTL_HOURS * 60 * 60 * 1000,
  };
}

export function issueSessionToken(user) {
  return jwt.sign({ sub: String(user._id), tv: user.tokenVersion ?? 0 }, env.JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: `${env.SESSION_TTL_HOURS}h`,
    issuer: 'sfa-cms',
  });
}

/**
 * Resolve a session token to an active user with permissions, or throw 401.
 * The token version check means a password change, deactivation or
 * "sign out everywhere" ends existing sessions immediately.
 */
export async function resolveSession(token) {
  if (!token) throw AppError.unauthenticated();
  let payload;
  try {
    payload = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'], issuer: 'sfa-cms' });
  } catch {
    throw AppError.unauthenticated('Your session has ended. Sign in again.');
  }
  const user = await User.findById(payload.sub).select('+tokenVersion').populate('department', 'name code');
  if (!user || !user.isActive || user.tokenVersion !== payload.tv) {
    throw AppError.unauthenticated('Your session has ended. Sign in again.');
  }
  const permissions = await permissionsFor(user.roles);
  return { user, permissions };
}

export async function login({ email, password }, context) {
  const user = await User.findOne({ email: email.toLowerCase() }).select(
    '+passwordHash +failedLoginAttempts +lockUntil +tokenVersion',
  );

  if (!user) {
    await bcrypt.compare(password, DUMMY_HASH);
    throw AppError.unauthenticated('Email or password is incorrect.');
  }

  if (user.isLocked()) {
    const minutes = Math.ceil((user.lockUntil - Date.now()) / 60000);
    throw AppError.locked(`Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}, or ask an administrator to reset your password.`);
  }

  const valid = await user.verifyPassword(password);

  if (!valid || !user.isActive) {
    if (valid && !user.isActive) {
      // Correct password on a deactivated account: say so plainly.
      throw AppError.forbidden('This account is deactivated. Contact an administrator.');
    }
    user.failedLoginAttempts = (user.failedLoginAttempts || 0) + 1;
    let lockedNow = false;
    if (user.failedLoginAttempts >= env.LOGIN_MAX_ATTEMPTS) {
      user.lockUntil = new Date(Date.now() + env.LOGIN_LOCK_MINUTES * 60000);
      user.failedLoginAttempts = 0;
      lockedNow = true;
    }
    await user.save();
    await audit.record({
      actor: user,
      action: lockedNow ? 'auth.lockout' : 'auth.login.failed',
      entityType: 'User',
      entityId: user._id,
      context,
    });
    throw AppError.unauthenticated('Email or password is incorrect.');
  }

  user.failedLoginAttempts = 0;
  user.lockUntil = undefined;
  user.lastLoginAt = new Date();
  await user.save();
  await audit.record({ actor: user, action: 'auth.login', entityType: 'User', entityId: user._id, context });
  await user.populate('department', 'name code');

  const permissions = await permissionsFor(user.roles);
  return { user, permissions, token: issueSessionToken(user) };
}

export async function changePassword(userId, { currentPassword, newPassword }, context) {
  const user = await User.findById(userId).select('+passwordHash +tokenVersion');
  if (!user) throw AppError.unauthenticated();
  if (!(await user.verifyPassword(currentPassword))) {
    throw AppError.validation([{ field: 'currentPassword', message: 'Current password is incorrect.' }]);
  }
  if (await user.verifyPassword(newPassword)) {
    throw AppError.validation([{ field: 'newPassword', message: 'Choose a password different from the current one.' }]);
  }
  await user.setPassword(newPassword);
  user.mustChangePassword = false;
  user.tokenVersion += 1; // signs out other sessions
  await user.save();
  await audit.record({ actor: user, action: 'auth.password.change', entityType: 'User', entityId: user._id, context });
  return { user, token: issueSessionToken(user) };
}

export async function signOutEverywhere(user, context) {
  await User.updateOne({ _id: user._id }, { $inc: { tokenVersion: 1 } });
  await audit.record({ actor: user, action: 'auth.logout.all', entityType: 'User', entityId: user._id, context });
}

export function sessionPayload(user, permissions) {
  return {
    user: user.toJSON(),
    permissions,
  };
}
