import { AuditLog } from '../models/index.js';
import logger from '../config/logger.js';

const SENSITIVE_KEYS = new Set(['password', 'passwordHash', 'currentPassword', 'newPassword', 'tokenVersion']);

/** Remove secrets and Mongoose internals from before/after values. */
export function sanitize(value) {
  if (value == null || typeof value !== 'object') return value;
  if (value instanceof Date) return value;
  if (typeof value.toHexString === 'function') return value.toHexString();
  const plain = typeof value.toObject === 'function' ? value.toObject({ depopulate: true }) : value;
  if (Array.isArray(plain)) return plain.map(sanitize);
  const out = {};
  for (const [k, v] of Object.entries(plain)) {
    if (SENSITIVE_KEYS.has(k) || k === '__v') continue;
    out[k] = sanitize(v);
  }
  return out;
}

/**
 * Canonical form for comparison: null, undefined and '' all mean "empty",
 * empty objects disappear, and object keys are sorted. Without this, a form
 * that sends `mobile: null` for a field that was never set would be logged
 * as a change.
 */
function canonical(value) {
  if (value === null || value === undefined || value === '') return undefined;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value).sort()) {
      const v = canonical(value[k]);
      if (v !== undefined) out[k] = v;
    }
    return Object.keys(out).length ? out : undefined;
  }
  return value;
}

/** Return only the keys whose values really differ between before and after. */
export function diff(before = {}, after = {}) {
  const b = sanitize(before) || {};
  const a = sanitize(after) || {};
  const changedBefore = {};
  const changedAfter = {};
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (JSON.stringify(canonical(b[key])) !== JSON.stringify(canonical(a[key]))) {
      changedBefore[key] = b[key];
      changedAfter[key] = a[key];
    }
  }
  return { before: changedBefore, after: changedAfter };
}

/**
 * Write one audit entry. Audit writes must never break the business action
 * that triggered them, but a failure is logged at error level so it is seen.
 */
export async function record({ actor, action, entityType, entityId, complaint, summary, before, after, context, session }) {
  try {
    const [entry] = await AuditLog.create(
      [
        {
          actor: actor?._id ?? actor ?? undefined,
          actorName: actor?.name,
          actorType: actor ? 'user' : 'system',
          action,
          entityType,
          entityId,
          complaint,
          summary,
          before: sanitize(before),
          after: sanitize(after),
          ip: context?.ip,
          userAgent: context?.userAgent,
        },
      ],
      session ? { session } : undefined,
    );
    return entry;
  } catch (err) {
    logger.error({ err, action, entityType, entityId }, 'Failed to write audit log');
    if (session) throw err; // inside a transaction the caller must roll back
    return null;
  }
}
