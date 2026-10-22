import * as roleService from '../services/roleService.js';
import * as departmentService from '../services/departmentService.js';
import { PERMISSION_LABELS } from '../auth/permissions.js';
import { STATUSES, STATUS_LABELS, STATUS_STAGE, STAGES, ORIGINS, REPORTER_TYPES } from '../config/workflow.js';
import { FISHBONE_CATEGORIES } from '../models/index.js';
import { AuditLog } from '../models/index.js';
import { ok, created, pagination, pageMeta, requestContext } from '../utils/http.js';

export async function listRoles(_req, res) {
  return ok(res, await roleService.listRoles(), { permissionLabels: PERMISSION_LABELS });
}

export async function updateRole(req, res) {
  return ok(res, await roleService.updateRolePermissions(req.params.key, req.body.permissions, req.user, requestContext(req)));
}

export async function listDepartments(req, res) {
  const includeInactive = req.query.includeInactive === 'true';
  return ok(res, await departmentService.listDepartments({ includeInactive }));
}

export async function createDepartment(req, res) {
  return created(res, await departmentService.createDepartment(req.body, req.user, requestContext(req)));
}

export async function updateDepartment(req, res) {
  return ok(res, await departmentService.updateDepartment(req.params.id, req.body, req.user, requestContext(req)));
}

/** System-wide audit log (non-complaint entities in Phase 2). */
export async function listAudit(req, res) {
  const page = pagination(req.query, { defaultLimit: 50 });
  const filter = {};
  if (req.query.entityType) filter.entityType = String(req.query.entityType);
  if (req.query.action) filter.action = String(req.query.action);
  const [items, total] = await Promise.all([
    AuditLog.find(filter).sort({ at: -1 }).skip(page.skip).limit(page.limit).lean(),
    AuditLog.countDocuments(filter),
  ]);
  return ok(res, items, pageMeta(page, total));
}

/** Reference data the UI needs: workflow vocabulary and option lists. */
export async function meta(_req, res) {
  return ok(res, {
    stages: Object.values(STAGES),
    statuses: Object.values(STATUSES).map((key) => ({ key, label: STATUS_LABELS[key], stage: STATUS_STAGE[key] })),
    origins: ORIGINS,
    reporterTypes: REPORTER_TYPES,
    fishboneCategories: FISHBONE_CATEGORIES,
  });
}
