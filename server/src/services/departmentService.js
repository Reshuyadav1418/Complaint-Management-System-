import { Department, User } from '../models/index.js';
import { AppError } from '../utils/AppError.js';
import * as audit from './auditService.js';

function duplicate(err) {
  if (err?.code !== 11000) return err;
  const field = Object.keys(err.keyPattern || {})[0] || 'name';
  return AppError.validation([{ field, message: `A department with this ${field} already exists.` }]);
}

export async function listDepartments({ includeInactive } = {}) {
  const filter = includeInactive ? {} : { isActive: true };
  const [departments, counts] = await Promise.all([
    Department.find(filter).sort({ name: 1 }).lean(),
    User.aggregate([{ $match: { isActive: true } }, { $group: { _id: '$department', n: { $sum: 1 } } }]),
  ]);
  const byId = new Map(counts.map((c) => [String(c._id), c.n]));
  return departments.map((d) => ({ ...d, activeUsers: byId.get(String(d._id)) || 0 }));
}

export async function createDepartment(input, actor, context) {
  let dept;
  try {
    dept = await Department.create(input);
  } catch (err) {
    throw duplicate(err);
  }
  await audit.record({ actor, action: 'department.create', entityType: 'Department', entityId: dept._id, after: input, context });
  return dept.toJSON();
}

export async function updateDepartment(id, input, actor, context) {
  const dept = await Department.findById(id);
  if (!dept) throw AppError.notFound('Department');
  const before = { name: dept.name, code: dept.code, isActive: dept.isActive };
  Object.assign(dept, input);
  try {
    await dept.save();
  } catch (err) {
    throw duplicate(err);
  }
  const changes = audit.diff(before, { name: dept.name, code: dept.code, isActive: dept.isActive });
  await audit.record({ actor, action: 'department.update', entityType: 'Department', entityId: dept._id, ...changes, context });
  return dept.toJSON();
}
