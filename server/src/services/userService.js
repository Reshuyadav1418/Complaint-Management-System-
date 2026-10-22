import crypto from 'node:crypto';
import { User, Department } from '../models/index.js';
import { AppError } from '../utils/AppError.js';
import { escapeRegex, pageMeta } from '../utils/http.js';
import { existingRoleKeys } from './roleService.js';
import * as audit from './auditService.js';

const AUDITED_FIELDS = ['name', 'email', 'employeeId', 'phone', 'designation', 'department', 'roles', 'isActive'];

function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (obj?.[k] !== undefined) out[k] = obj[k];
  return out;
}

async function assertRolesExist(roles) {
  if (!roles) return;
  const found = await existingRoleKeys(roles);
  const missing = roles.filter((r) => !found.includes(r));
  if (missing.length) {
    throw AppError.validation([{ field: 'roles', message: `Unknown role: ${missing.join(', ')}` }]);
  }
}

async function assertDepartmentExists(id) {
  if (!id) return;
  const ok = await Department.exists({ _id: id, isActive: true });
  if (!ok) throw AppError.validation([{ field: 'department', message: 'Select an active department.' }]);
}

/** Refuse changes that would leave the system with no active administrator. */
async function assertAdminRemains(userId, nextRoles, nextActive) {
  const losesAdmin = !nextRoles.includes('admin') || nextActive === false;
  if (!losesAdmin) return;
  const otherAdmins = await User.countDocuments({ _id: { $ne: userId }, roles: 'admin', isActive: true });
  if (otherAdmins === 0) {
    throw AppError.conflict('At least one active administrator is required. Make someone else an administrator first.');
  }
}

function duplicateKeyToValidation(err) {
  if (err?.code !== 11000) return err;
  const field = Object.keys(err.keyPattern || err.keyValue || {})[0] || 'field';
  const label = field === 'employeeId' ? 'employee ID' : field;
  return AppError.validation([{ field, message: `Another user already has this ${label}.` }]);
}

/** Readable temporary password: 4 groups of 4, mixed case and digits. */
export function generateTemporaryPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(16);
  let out = '';
  for (let i = 0; i < 16; i += 1) {
    out += alphabet[bytes[i] % alphabet.length];
    if (i % 4 === 3 && i < 15) out += '-';
  }
  // Guarantee the password policy (letter + digit) regardless of randomness.
  return `${out}-7a`;
}

export async function listUsers({ search, role, department, status }, page) {
  const filter = {};
  if (search) {
    const rx = new RegExp(escapeRegex(search.trim()), 'i');
    filter.$or = [{ name: rx }, { email: rx }, { employeeId: rx }];
  }
  if (role) filter.roles = role;
  if (department) filter.department = department;
  if (status === 'active') filter.isActive = true;
  if (status === 'inactive') filter.isActive = false;

  const [items, total] = await Promise.all([
    User.find(filter)
      .sort({ isActive: -1, name: 1 })
      .skip(page.skip)
      .limit(page.limit)
      .populate('department', 'name code'),
    User.countDocuments(filter),
  ]);
  return { items: items.map((u) => u.toJSON()), meta: pageMeta(page, total) };
}

export async function getUser(id) {
  const user = await User.findById(id).populate('department', 'name code');
  if (!user) throw AppError.notFound('User');
  return user.toJSON();
}

/** Lightweight active-user lookup for assignment pickers. */
export async function directory({ role, search }) {
  const filter = { isActive: true };
  if (role) filter.roles = role;
  if (search) filter.name = new RegExp(escapeRegex(search.trim()), 'i');
  const users = await User.find(filter, { name: 1, email: 1, designation: 1, department: 1, roles: 1 })
    .sort({ name: 1 })
    .limit(50)
    .populate('department', 'name')
    .lean();
  return users;
}

export async function createUser(input, actor, context) {
  await assertRolesExist(input.roles);
  await assertDepartmentExists(input.department);

  const temporaryPassword = input.password ? null : generateTemporaryPassword();
  const user = new User({
    ...pick(input, ['name', 'email', 'employeeId', 'phone', 'designation', 'department', 'roles']),
    mustChangePassword: true,
    createdBy: actor._id,
    updatedBy: actor._id,
  });
  await user.setPassword(input.password || temporaryPassword);

  try {
    await user.save();
  } catch (err) {
    throw duplicateKeyToValidation(err);
  }

  await audit.record({
    actor,
    action: 'user.create',
    entityType: 'User',
    entityId: user._id,
    summary: `Added user ${user.name}`,
    after: pick(user.toObject(), AUDITED_FIELDS),
    context,
  });

  await user.populate('department', 'name code');
  // The temporary password is returned once, to the admin, and never stored in plain text.
  return { user: user.toJSON(), temporaryPassword };
}

export async function updateUser(id, input, actor, context) {
  const user = await User.findById(id).select('+tokenVersion');
  if (!user) throw AppError.notFound('User');

  if (input.roles) await assertRolesExist(input.roles);
  if (input.department) await assertDepartmentExists(input.department);

  const nextRoles = input.roles ?? user.roles;
  const nextActive = input.isActive ?? user.isActive;

  if (String(user._id) === String(actor._id)) {
    if (nextActive === false) throw AppError.conflict('You cannot deactivate your own account.');
    if (user.roles.includes('admin') && !nextRoles.includes('admin')) {
      throw AppError.conflict('You cannot remove your own administrator role.');
    }
  }
  if (user.roles.includes('admin') && user.isActive) await assertAdminRemains(user._id, nextRoles, nextActive);

  const before = pick(user.toObject(), AUDITED_FIELDS);
  const editable = ['name', 'email', 'employeeId', 'phone', 'designation', 'department', 'roles', 'isActive'];
  for (const key of editable) if (input[key] !== undefined) user[key] = input[key];

  // Deactivation and role changes end the user's current sessions.
  const rolesChanged = input.roles && JSON.stringify([...before.roles].sort()) !== JSON.stringify([...nextRoles].sort());
  if (input.isActive === false || rolesChanged) user.tokenVersion += 1;
  user.updatedBy = actor._id;

  try {
    await user.save();
  } catch (err) {
    throw duplicateKeyToValidation(err);
  }

  const changes = audit.diff(before, pick(user.toObject(), AUDITED_FIELDS));
  if (Object.keys(changes.after).length) {
    let action = 'user.update';
    if (before.isActive && !user.isActive) action = 'user.deactivate';
    else if (!before.isActive && user.isActive) action = 'user.reactivate';
    await audit.record({
      actor,
      action,
      entityType: 'User',
      entityId: user._id,
      summary: {
        'user.deactivate': `Deactivated ${user.name}`,
        'user.reactivate': `Reactivated ${user.name}`,
      }[action] || `Edited user ${user.name}`,
      ...changes,
      context,
    });
  }

  await user.populate('department', 'name code');
  return user.toJSON();
}

export async function resetPassword(id, actor, context) {
  const user = await User.findById(id).select('+tokenVersion +failedLoginAttempts +lockUntil');
  if (!user) throw AppError.notFound('User');
  const temporaryPassword = generateTemporaryPassword();
  await user.setPassword(temporaryPassword);
  user.mustChangePassword = true;
  user.failedLoginAttempts = 0;
  user.lockUntil = undefined;
  user.tokenVersion += 1;
  user.updatedBy = actor._id;
  await user.save();
  await audit.record({
    actor,
    action: 'user.password.reset',
    entityType: 'User',
    entityId: user._id,
    summary: `Reset the password of ${user.name}`,
    context,
  });
  return { temporaryPassword };
}
