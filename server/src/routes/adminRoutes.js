import { Router } from 'express';
import * as c from '../controllers/adminController.js';
import * as d2 from '../controllers/d2Controller.js';
import { z } from 'zod';
import { LOOKUP_LISTS } from '../models/index.js';
import { requirePermission, requireAnyPermission } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import { PERMISSIONS as P } from '../auth/permissions.js';
import { idParams } from '../validation/common.js';
import { roleParams, updateRoleBody, departmentBody, updateDepartmentBody } from '../validation/userSchemas.js';

const r = Router();

r.get('/meta', c.meta);

r.get('/roles', requireAnyPermission(P.ROLES_MANAGE, P.USERS_MANAGE), c.listRoles);
r.put('/roles/:key/permissions', requirePermission(P.ROLES_MANAGE), validate({ params: roleParams, body: updateRoleBody }), c.updateRole);

// Any signed-in user may read active departments (needed for forms).
r.get('/departments', c.listDepartments);
r.post('/departments', requirePermission(P.DEPARTMENTS_MANAGE), validate({ body: departmentBody }), c.createDepartment);
r.patch(
  '/departments/:id',
  requirePermission(P.DEPARTMENTS_MANAGE),
  validate({ params: idParams, body: updateDepartmentBody }),
  c.updateDepartment,
);

// Dropdown lists: any signed-in user reads them; settings.manage edits them.
const lookupBody = z.object({
  list: z.enum(Object.keys(LOOKUP_LISTS)),
  value: z.string().trim().min(1, 'Enter a value.').max(120),
  parent: z.string().trim().max(120).optional(),
  order: z.number().int().min(0).max(10_000).optional(),
});
const lookupPatch = z
  .object({ value: z.string().trim().min(1).max(120), parent: z.string().trim().max(120), order: z.number().int().min(0).max(10_000), active: z.boolean() })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update.');
r.get('/lookups', d2.listLookups);
r.post('/lookups', requirePermission(P.SETTINGS_MANAGE), validate({ body: lookupBody }), d2.createLookup);
r.patch('/lookups/:id', requirePermission(P.SETTINGS_MANAGE), validate({ params: idParams, body: lookupPatch }), d2.updateLookup);

r.get('/audit-logs', requirePermission(P.AUDIT_VIEW), c.listAudit);

export default r;
