import { Role } from '../models/index.js';
import { DEFAULT_ROLES, ALL_PERMISSIONS } from '../auth/permissions.js';
import { AppError } from '../utils/AppError.js';
import * as audit from './auditService.js';

/**
 * Role permissions are read on every authenticated request, so they are
 * cached briefly in memory. Any change through this service clears the cache.
 * With several server instances, a change takes effect within CACHE_MS.
 */
const CACHE_MS = 30_000;
let cache = { at: 0, map: new Map() };

export function clearRoleCache() {
  cache = { at: 0, map: new Map() };
}

async function roleMap() {
  if (Date.now() - cache.at < CACHE_MS && cache.map.size) return cache.map;
  const roles = await Role.find({}, { key: 1, permissions: 1 }).lean();
  cache = { at: Date.now(), map: new Map(roles.map((r) => [r.key, r.permissions])) };
  return cache.map;
}

export async function permissionsFor(roleKeys = []) {
  const map = await roleMap();
  const set = new Set();
  for (const key of roleKeys) for (const p of map.get(key) || []) set.add(p);
  return [...set].sort();
}

export async function listRoles() {
  return Role.find().sort({ isSystem: -1, name: 1 }).lean();
}

export async function existingRoleKeys(keys) {
  const found = await Role.find({ key: { $in: keys } }, { key: 1 }).lean();
  return found.map((r) => r.key);
}

export async function updateRolePermissions(key, permissions, actor, context) {
  const role = await Role.findOne({ key });
  if (!role) throw AppError.notFound('Role');
  if (key === 'admin' && !permissions.includes('roles.manage')) {
    throw AppError.badRequest('The Administrator role must keep "Manage role permissions" so access can always be recovered.');
  }
  const before = { permissions: [...role.permissions] };
  role.permissions = [...new Set(permissions)];
  role.updatedBy = actor._id;
  await role.save();
  clearRoleCache();
  await audit.record({
    actor,
    action: 'role.permissions.update',
    entityType: 'Role',
    entityId: role._id,
    summary: `Changed permissions of the ${role.name} role`,
    before,
    after: { permissions: role.permissions },
    context,
  });
  return role.toJSON();
}

/**
 * Create any missing default roles. Never overwrites edited permissions,
 * except that the Administrator role always receives permissions added in
 * newer releases, so a new feature is never unreachable after an upgrade.
 */
export async function ensureDefaultRoles() {
  for (const def of DEFAULT_ROLES) {
    await Role.updateOne({ key: def.key }, { $setOnInsert: { ...def, isSystem: true } }, { upsert: true });
  }
  await Role.updateOne({ key: 'admin' }, { $addToSet: { permissions: { $each: [...ALL_PERMISSIONS] } } });
  clearRoleCache();
}
