import mongoose from 'mongoose';
import { Complaint, RootCauseAnalysis, FishboneCause, RootCause, CapaRecord, User, FISHBONE_CATEGORIES } from '../models/index.js';
import { STATUSES as S } from '../config/workflow.js';
import { PERMISSIONS as P } from '../auth/permissions.js';
import { AppError } from '../utils/AppError.js';
import { findVisible, getDetail } from './complaintService.js';
import { nextCapaNumber } from './sequenceService.js';
import * as workflow from './workflowService.js';
import * as audit from './auditService.js';

/*
 * D3: root cause analysis and CAPA.
 *
 * Who may edit: a user with complaint.d3.edit who is the complaint's current
 * FRP. Users who can see every complaint and also hold complaint.d3.edit
 * (administrators) may edit too, so work is never stuck if the FRP is away.
 * When: only while the analysis is in progress or returned for rework.
 * Submission, approval and rejection are in d3ReviewService.js.
 */
const EDITABLE = [S.D3_IN_PROGRESS, S.D3_REWORK];

export function canEdit(complaint, user, permissions) {
  if (!permissions.has(P.COMPLAINT_D3_EDIT)) return false;
  if (!EDITABLE.includes(complaint.status)) return false;
  const frpId = complaint.frp?._id ?? complaint.frp;
  return String(frpId) === String(user._id) || permissions.has(P.COMPLAINT_VIEW_ALL);
}

/** Load the complaint and its analysis, refusing anything but an allowed edit. */
async function editable(id, user, permissions) {
  const complaint = await findVisible(id, user, permissions);
  if (!permissions.has(P.COMPLAINT_D3_EDIT)) throw AppError.forbidden();
  if (!EDITABLE.includes(complaint.status)) {
    throw AppError.conflict(
      complaint.status === S.D2_COMPLETED
        ? 'Start the analysis before recording D3 information.'
        : complaint.status === S.D3_PENDING_APPROVAL
          ? 'The analysis is waiting for approval and cannot be changed.'
          : 'D3 information cannot be changed at this stage.',
    );
  }
  if (!canEdit(complaint, user, permissions)) {
    throw AppError.forbidden('Only the First Responsible Person for this complaint can record the analysis.');
  }
  const analysis = await RootCauseAnalysis.findOne({ complaint: complaint._id });
  if (!analysis) throw AppError.conflict('Start the analysis first.');
  return { complaint, analysis };
}

async function touch(complaintId) {
  await Complaint.updateOne({ _id: complaintId }, { $set: { lastActivityAt: new Date() } });
}

const record = (user, context, complaint, action, summary, extra = {}) =>
  audit.record({ actor: user, action, entityType: 'Complaint', entityId: complaint._id, complaint: complaint._id, summary, context, ...extra });

/* ---------------- Start ---------------- */

/** D2_COMPLETED → D3_IN_PROGRESS, creating the analysis record in the same transaction. */
export async function start(id, { idempotencyKey }, { user, permissions, context }) {
  const visible = await findVisible(id, user, permissions, { lean: true });
  if (permissions.has(P.COMPLAINT_D3_EDIT) && String(visible.frp) !== String(user._id) && !permissions.has(P.COMPLAINT_VIEW_ALL)) {
    throw AppError.forbidden('Only the First Responsible Person for this complaint can start the analysis.');
  }
  await mongoose.connection.transaction(async (session) => {
    const { complaint, replayed } = await workflow.perform(id, 'startD3', { actor: user, permissions, idempotencyKey, context, session });
    if (replayed) return;
    await RootCauseAnalysis.updateOne(
      { complaint: complaint._id },
      { $setOnInsert: { complaint: complaint._id, status: 'DRAFT', methods: [] } },
      { upsert: true, session },
    );
  });
  return getDetail(id, user, permissions);
}

/* ---------------- Read everything for the D3 tab ---------------- */

/** Causes as a tree per category, in display order. Used to draw the fishbone. */
export function buildTree(causes) {
  const tree = Object.fromEntries(FISHBONE_CATEGORIES.map((c) => [c, []]));
  const byId = new Map();
  const sorted = [...causes].sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);
  for (const c of sorted) if (!c.parent) {
    const node = { _id: c._id, text: c.text, category: c.category, children: [] };
    byId.set(String(c._id), node);
    tree[c.category].push(node);
  }
  for (const c of sorted) if (c.parent) byId.get(String(c.parent))?.children.push({ _id: c._id, text: c.text, category: c.category, parent: c.parent });
  return tree;
}

export async function getD3(id, user, permissions) {
  const complaint = await findVisible(id, user, permissions, { lean: true });
  const analysis = await RootCauseAnalysis.findOne({ complaint: complaint._id }).populate('updatedBy', 'name').lean();
  if (!analysis) {
    return { analysis: null, categories: FISHBONE_CATEGORIES, fishbone: buildTree([]), rootCauses: [], canEdit: false };
  }
  const [causes, rootCauses, capas] = await Promise.all([
    FishboneCause.find({ analysis: analysis._id, deletedAt: null }).lean(),
    RootCause.find({ analysis: analysis._id, deletedAt: null }).sort({ createdAt: 1 }).lean(),
    CapaRecord.find({ complaint: complaint._id, deletedAt: null }).sort({ createdAt: 1 }).populate('responsiblePerson', 'name email').lean(),
  ]);
  return {
    analysis,
    categories: FISHBONE_CATEGORIES,
    fishbone: buildTree(causes),
    rootCauses: rootCauses.map((r) => ({ ...r, capas: capas.filter((c) => String(c.rootCause) === String(r._id)) })),
    canEdit: canEdit(complaint, user, permissions),
  };
}

/* ---------------- Analysis: methods, problem statement, Why-Why ---------------- */

export async function updateAnalysis(id, { version, methods, problemStatement, whyWhy }, { user, permissions, context }) {
  const { complaint, analysis } = await editable(id, user, permissions);
  if (analysis.__v !== version) {
    throw AppError.conflict('The analysis was changed by someone else after you opened it. Reload to see the latest version.');
  }
  const before = { methods: analysis.methods, problemStatement: analysis.problemStatement, whyWhy: analysis.whyWhy.map((w) => ({ level: w.level, why: w.why, because: w.because })) };
  if (methods) analysis.methods = methods;
  if (problemStatement !== undefined) analysis.problemStatement = problemStatement;
  if (whyWhy) analysis.whyWhy = whyWhy.map((w, i) => ({ level: i + 1, why: w.why, because: w.because }));
  analysis.updatedBy = user._id;
  await analysis.save();
  await touch(complaint._id);

  const after = { methods: analysis.methods, problemStatement: analysis.problemStatement, whyWhy: analysis.whyWhy.map((w) => ({ level: w.level, why: w.why, because: w.because })) };
  const changes = audit.diff(before, after);
  if (Object.keys(changes.after).length || Object.keys(changes.before).length) {
    // The full before/after is kept, so every earlier Why-Why version can be read back.
    await record(user, context, complaint, 'complaint.d3.analysis.update', 'Edited the analysis', changes);
  }
  return getD3(id, user, permissions);
}

/* ---------------- Fishbone causes ---------------- */

export async function addCause(id, { category, text, parent }, { user, permissions, context }) {
  const { complaint, analysis } = await editable(id, user, permissions);
  let cat = category;
  if (parent) {
    const p = await FishboneCause.findOne({ _id: parent, analysis: analysis._id, deletedAt: null }).lean();
    if (!p) throw AppError.validation([{ field: 'parent', message: 'The cause this belongs to no longer exists.' }]);
    if (p.parent) throw AppError.validation([{ field: 'parent', message: 'Sub-causes can be added only to a main cause, not to another sub-cause.' }]);
    cat = p.category; // a sub-cause always sits on its parent's branch
  }
  if (!cat) throw AppError.validation([{ field: 'category', message: 'Choose a category.' }]);
  const order = await FishboneCause.countDocuments({ analysis: analysis._id, category: cat, parent: parent || null });
  const cause = await FishboneCause.create({ complaint: complaint._id, analysis: analysis._id, category: cat, text, parent: parent || undefined, order, createdBy: user._id });
  await touch(complaint._id);
  await record(user, context, complaint, 'complaint.d3.cause.add', `Added ${parent ? 'sub-cause' : 'cause'} under ${cat}: ${text}`, { after: { category: cat, text } });
  return getD3(id, user, permissions);
}

export async function updateCause(id, causeId, { text, category }, { user, permissions, context }) {
  const { complaint, analysis } = await editable(id, user, permissions);
  const cause = await FishboneCause.findOne({ _id: causeId, analysis: analysis._id, deletedAt: null });
  if (!cause) throw AppError.notFound('Cause');
  const before = { text: cause.text, category: cause.category };
  if (text !== undefined) cause.text = text;
  if (category && category !== cause.category) {
    if (cause.parent) throw AppError.validation([{ field: 'category', message: 'A sub-cause stays in its main cause’s category. Move the main cause instead.' }]);
    cause.category = category;
    // Sub-causes move with their main cause.
    await FishboneCause.updateMany({ parent: cause._id }, { $set: { category } });
  }
  cause.updatedBy = user._id;
  await cause.save();
  await touch(complaint._id);
  await record(user, context, complaint, 'complaint.d3.cause.update', `Edited cause: ${cause.text}`, audit.diff(before, { text: cause.text, category: cause.category }));
  return getD3(id, user, permissions);
}

/** Soft delete: the cause and its sub-causes disappear from the diagram but stay auditable. */
export async function deleteCause(id, causeId, { user, permissions, context }) {
  const { complaint, analysis } = await editable(id, user, permissions);
  const cause = await FishboneCause.findOne({ _id: causeId, analysis: analysis._id, deletedAt: null });
  if (!cause) throw AppError.notFound('Cause');
  const now = new Date();
  const subs = await FishboneCause.updateMany({ parent: cause._id, deletedAt: null }, { $set: { deletedAt: now, updatedBy: user._id } });
  cause.deletedAt = now;
  cause.updatedBy = user._id;
  await cause.save();
  await touch(complaint._id);
  await record(
    user,
    context,
    complaint,
    'complaint.d3.cause.remove',
    `Removed cause under ${cause.category}: ${cause.text}${subs.modifiedCount ? ` (and ${subs.modifiedCount} sub-cause${subs.modifiedCount > 1 ? 's' : ''})` : ''}`,
    { before: { category: cause.category, text: cause.text } },
  );
  return getD3(id, user, permissions);
}

/* ---------------- Root causes ---------------- */

export async function addRootCause(id, { category, description, sourceCause }, { user, permissions, context }) {
  const { complaint, analysis } = await editable(id, user, permissions);
  if (sourceCause && !(await FishboneCause.exists({ _id: sourceCause, analysis: analysis._id, deletedAt: null }))) {
    throw AppError.validation([{ field: 'sourceCause', message: 'The linked fishbone cause no longer exists.' }]);
  }
  await RootCause.create({ complaint: complaint._id, analysis: analysis._id, category, description, sourceCause, createdBy: user._id });
  await touch(complaint._id);
  await record(user, context, complaint, 'complaint.d3.rootcause.add', `Recorded root cause (${category}): ${description}`, { after: { category, description } });
  return getD3(id, user, permissions);
}

export async function updateRootCause(id, rootCauseId, input, { user, permissions, context }) {
  const { complaint, analysis } = await editable(id, user, permissions);
  const rc = await RootCause.findOne({ _id: rootCauseId, analysis: analysis._id, deletedAt: null });
  if (!rc) throw AppError.notFound('Root cause');
  const before = { category: rc.category, description: rc.description };
  for (const k of ['category', 'description']) if (input[k] !== undefined) rc[k] = input[k];
  rc.updatedBy = user._id;
  await rc.save();
  await touch(complaint._id);
  await record(user, context, complaint, 'complaint.d3.rootcause.update', `Edited root cause: ${rc.description}`, audit.diff(before, { category: rc.category, description: rc.description }));
  return getD3(id, user, permissions);
}

/** Removing a root cause also removes its CAPA records; both stay in the audit trail. */
export async function deleteRootCause(id, rootCauseId, { user, permissions, context }) {
  const { complaint, analysis } = await editable(id, user, permissions);
  const rc = await RootCause.findOne({ _id: rootCauseId, analysis: analysis._id, deletedAt: null });
  if (!rc) throw AppError.notFound('Root cause');
  const now = new Date();
  const capas = await CapaRecord.updateMany({ rootCause: rc._id, deletedAt: null }, { $set: { deletedAt: now, updatedBy: user._id } });
  rc.deletedAt = now;
  rc.updatedBy = user._id;
  await rc.save();
  await touch(complaint._id);
  await record(user, context, complaint, 'complaint.d3.rootcause.remove', `Removed root cause: ${rc.description}${capas.modifiedCount ? ` and its ${capas.modifiedCount} CAPA record${capas.modifiedCount > 1 ? 's' : ''}` : ''}`, { before: { category: rc.category, description: rc.description } });
  return getD3(id, user, permissions);
}

/* ---------------- CAPA ---------------- */

/**
 * CAPA rules:
 *   CAPA required  → corrective action, responsible person and target date are mandatory
 *   CAPA not required → action status is "Not required" and a justification is mandatory
 * Recording a CAPA never marks it completed; that is a separate status change.
 */
async function checkCapa(input, { isNew }) {
  const issues = [];
  if (input.capaRequired) {
    if (!input.correctiveAction) issues.push({ field: 'correctiveAction', message: 'Describe the corrective action.' });
    if (!input.responsiblePerson) issues.push({ field: 'responsiblePerson', message: 'Choose who is responsible.' });
    if (!input.targetDate) issues.push({ field: 'targetDate', message: 'Set a target completion date.' });
    else if (isNew && input.targetDate < new Date(new Date().toDateString())) {
      issues.push({ field: 'targetDate', message: 'The target date cannot be in the past.' });
    }
    if (input.actionStatus === 'NOT_REQUIRED') issues.push({ field: 'actionStatus', message: '“Not required” is only for records where CAPA is not required.' });
  } else if (!input.description) {
    issues.push({ field: 'description', message: 'Explain why no corrective action is needed.' });
  }
  if (input.responsiblePerson && !(await User.exists({ _id: input.responsiblePerson, isActive: true }))) {
    issues.push({ field: 'responsiblePerson', message: 'Choose an active employee.' });
  }
  if (issues.length) throw AppError.validation(issues);
}

const CAPA_FIELDS = ['capaRequired', 'category', 'description', 'correctiveAction', 'preventiveAction', 'responsiblePerson', 'targetDate', 'actionStatus'];
const pick = (o) => Object.fromEntries(CAPA_FIELDS.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));

export async function addCapa(id, rootCauseId, input, { user, permissions, context }) {
  const { complaint, analysis } = await editable(id, user, permissions);
  const rc = await RootCause.findOne({ _id: rootCauseId, analysis: analysis._id, deletedAt: null }).lean();
  if (!rc) throw AppError.notFound('Root cause');
  const data = { ...pick(input) };
  if (!data.capaRequired) data.actionStatus = 'NOT_REQUIRED';
  await checkCapa(data, { isNew: true });
  const capaNumber = await nextCapaNumber(complaint.complaintNumber);
  await CapaRecord.create({ ...data, capaNumber, complaint: complaint._id, rootCause: rc._id, createdBy: user._id });
  await touch(complaint._id);
  await record(user, context, complaint, 'complaint.d3.capa.add', `Created ${capaNumber}${data.capaRequired ? '' : ' (CAPA not required)'}`, { after: { capaNumber, ...data } });
  return getD3(id, user, permissions);
}

export async function updateCapa(id, capaId, input, { user, permissions, context }) {
  const { complaint } = await editable(id, user, permissions);
  const capa = await CapaRecord.findOne({ _id: capaId, complaint: complaint._id, deletedAt: null });
  if (!capa) throw AppError.notFound('CAPA record');
  if (input.version !== undefined && capa.__v !== input.version) {
    throw AppError.conflict('This CAPA record was changed by someone else. Reload to see the latest version.');
  }
  const before = pick(capa.toObject());
  const next = { ...before, ...pick(input) };
  if (!next.capaRequired) next.actionStatus = 'NOT_REQUIRED';
  else if (next.actionStatus === 'NOT_REQUIRED') next.actionStatus = 'NOT_STARTED';
  await checkCapa(next, { isNew: false });
  capa.set(next);
  capa.updatedBy = user._id;
  await capa.save();
  await touch(complaint._id);
  await record(user, context, complaint, 'complaint.d3.capa.update', `Edited ${capa.capaNumber}`, audit.diff(before, pick(capa.toObject())));
  return getD3(id, user, permissions);
}

export async function deleteCapa(id, capaId, { user, permissions, context }) {
  const { complaint } = await editable(id, user, permissions);
  const capa = await CapaRecord.findOne({ _id: capaId, complaint: complaint._id, deletedAt: null });
  if (!capa) throw AppError.notFound('CAPA record');
  capa.deletedAt = new Date();
  capa.updatedBy = user._id;
  await capa.save();
  await touch(complaint._id);
  await record(user, context, complaint, 'complaint.d3.capa.remove', `Removed ${capa.capaNumber}`, { before: pick(capa.toObject()) });
  return getD3(id, user, permissions);
}
