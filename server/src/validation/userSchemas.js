import { z } from 'zod';
import { ALL_PERMISSIONS } from '../auth/permissions.js';
import { objectId, optionalText, pageQuery, password } from './common.js';

const roleKey = z.string().regex(/^[a-z][a-z0-9_]{1,39}$/, 'Invalid role.');
const phone = z
  .string()
  .trim()
  .regex(/^\+?[0-9 ()-]{7,20}$/, 'Enter a valid phone number.')
  .optional()
  .or(z.literal('').transform(() => undefined));

const base = {
  name: z.string().trim().min(2, 'Enter the full name.').max(120),
  email: z.email('Enter a valid email address.').max(254).transform((v) => v.toLowerCase()),
  employeeId: optionalText(40),
  phone,
  designation: optionalText(120),
  department: objectId.optional().or(z.literal('').transform(() => undefined)),
  roles: z.array(roleKey).min(1, 'Select at least one role.').max(10),
};

export const createUserBody = z.object({
  ...base,
  // Optional: if omitted, a temporary password is generated and shown once.
  password: password.optional(),
});

export const updateUserBody = z
  .object({ ...base, isActive: z.boolean() })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update.');

export const listUsersQuery = z.object({
  ...pageQuery,
  search: z.string().trim().max(100).optional(),
  role: roleKey.optional(),
  department: objectId.optional(),
  status: z.enum(['active', 'inactive', 'all']).optional(),
});

export const directoryQuery = z.object({
  role: roleKey.optional(),
  search: z.string().trim().max(100).optional(),
});

export const updateRoleBody = z.object({
  permissions: z.array(z.enum(ALL_PERMISSIONS, 'Unknown permission.')).max(100),
});

export const roleParams = z.object({ key: roleKey });

export const departmentBody = z.object({
  name: z.string().trim().min(2).max(100),
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{2,20}$/, 'Use 2–20 letters, digits, - or _.'),
});

export const updateDepartmentBody = departmentBody
  .extend({ isActive: z.boolean() })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update.');
