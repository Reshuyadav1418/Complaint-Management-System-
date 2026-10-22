import { LookupValue, LOOKUP_LISTS } from '../models/index.js';
import { AppError } from '../utils/AppError.js';
import * as audit from './auditService.js';

export async function all({ includeInactive = false } = {}) {
  const filter = includeInactive ? {} : { active: true };
  const rows = await LookupValue.find(filter).sort({ list: 1, parent: 1, order: 1, value: 1 }).lean();
  const lists = {};
  for (const key of Object.keys(LOOKUP_LISTS)) lists[key] = [];
  for (const r of rows) lists[r.list].push(r);
  return { definitions: LOOKUP_LISTS, lists };
}

function duplicate(err) {
  if (err?.code === 11000) return AppError.validation([{ field: 'value', message: 'This value already exists in the list.' }]);
  return err;
}

async function checkParent(list, parent) {
  const def = LOOKUP_LISTS[list];
  if (!def.parentList) return undefined;
  if (!parent) throw AppError.validation([{ field: 'parent', message: 'Choose the manufacturing location this detail belongs to.' }]);
  const ok = await LookupValue.exists({ list: def.parentList, value: parent });
  if (!ok) throw AppError.validation([{ field: 'parent', message: 'Unknown manufacturing location.' }]);
  return parent;
}

export async function create({ list, value, parent, order }, actor, context) {
  const p = await checkParent(list, parent);
  let row;
  try {
    row = await LookupValue.create({ list, value, parent: p, order });
  } catch (err) {
    throw duplicate(err);
  }
  await audit.record({ actor, action: 'lookup.create', entityType: 'LookupValue', entityId: row._id, summary: `Added "${value}" to ${LOOKUP_LISTS[list].label}`, context });
  return row.toJSON();
}

/**
 * Rename, reorder or (de)activate. Renaming a manufacturing location also
 * renames the parent of its details, so they stay attached.
 */
export async function update(id, input, actor, context) {
  const row = await LookupValue.findById(id);
  if (!row) throw AppError.notFound('List value');
  const before = { value: row.value, active: row.active, order: row.order, parent: row.parent };
  if (input.parent !== undefined) row.parent = await checkParent(row.list, input.parent);
  for (const k of ['value', 'order', 'active']) if (input[k] !== undefined) row[k] = input[k];
  try {
    await row.save();
  } catch (err) {
    throw duplicate(err);
  }
  if (row.list === 'manufacturingLocation' && before.value !== row.value) {
    await LookupValue.updateMany({ list: 'locationDetail', parent: before.value }, { $set: { parent: row.value } });
  }
  const changes = audit.diff(before, { value: row.value, active: row.active, order: row.order, parent: row.parent });
  await audit.record({ actor, action: 'lookup.update', entityType: 'LookupValue', entityId: row._id, summary: `Edited "${row.value}" in ${LOOKUP_LISTS[row.list].label}`, ...changes, context });
  return row.toJSON();
}

/**
 * Check D2 selections against active list values. A value that is already
 * saved on the complaint stays valid even if it was deactivated later, so
 * old complaints can still be edited without being forced to change it.
 */
export async function validateSelections({ manufacturingLocation, locationDetail, typeOfFailure }, current = {}) {
  const issues = [];
  const allowed = async (list, value, parent, currentValue) => {
    if (value === undefined || value === null || value === currentValue) return true;
    const q = { list, value, active: true };
    if (parent !== undefined) q.parent = parent;
    return Boolean(await LookupValue.exists(q).collation({ locale: 'en', strength: 2 }));
  };
  if (!(await allowed('manufacturingLocation', manufacturingLocation, undefined, current.manufacturingLocation))) {
    issues.push({ field: 'investigation.manufacturingLocation', message: 'Choose a manufacturing location from the list.' });
  }
  const location = manufacturingLocation === undefined ? current.manufacturingLocation : manufacturingLocation;
  const detailUnchanged = locationDetail === current.locationDetail && location === current.manufacturingLocation;
  if (locationDetail && !detailUnchanged) {
    if (!location) issues.push({ field: 'investigation.locationDetail', message: 'Choose the manufacturing location first.' });
    else if (!(await allowed('locationDetail', locationDetail, location, undefined))) {
      issues.push({ field: 'investigation.locationDetail', message: `Choose a location detail that belongs to ${location}.` });
    }
  }
  if (!(await allowed('typeOfFailure', typeOfFailure, undefined, current.typeOfFailure))) {
    issues.push({ field: 'investigation.typeOfFailure', message: 'Choose a type of failure from the list.' });
  }
  if (issues.length) throw AppError.validation(issues);
}
