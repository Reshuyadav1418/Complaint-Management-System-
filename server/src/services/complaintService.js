import mongoose from 'mongoose';
import { Complaint, ComplaintAssignment, ComplaintAttachment, AuditLog, RootCauseAnalysis } from '../models/index.js';
import { STATUSES as S, STATUS_LABELS } from '../config/workflow.js';
import { PERMISSIONS as P } from '../auth/permissions.js';
import { AppError } from '../utils/AppError.js';
import { escapeRegex, pageMeta } from '../utils/http.js';
import { nextComplaintNumber } from './sequenceService.js';
import * as workflow from './workflowService.js';
import * as audit from './auditService.js';

/* ------------------------------------------------------------------ */
/* Visibility                                                          */
/* ------------------------------------------------------------------ */

/**
 * The MongoDB filter for complaints this user may see.
 *   complaint.view.all       every complaint
 *   complaint.view.assigned  complaints where they are the current FRP or hold
 *                            any active assignment
 * Anyone else sees nothing. Applied to every read, so a guessed id returns
 * 404, never someone else's complaint (no insecure direct object references).
 */
export async function visibilityFilter(user, permissions) {
  if (permissions.has(P.COMPLAINT_VIEW_ALL)) return {};
  if (permissions.has(P.COMPLAINT_VIEW_ASSIGNED)) {
    const assigned = await ComplaintAssignment.distinct('complaint', { assignee: user._id, active: true });
    return { $or: [{ frp: user._id }, { _id: { $in: assigned } }] };
  }
  return { _id: { $in: [] } };
}

/** Load one complaint the user may see, or 404. */
export async function findVisible(id, user, permissions, { lean = false } = {}) {
  if (!mongoose.isValidObjectId(id)) throw AppError.notFound('Complaint');
  const scope = await visibilityFilter(user, permissions);
  const q = Complaint.findOne({ $and: [{ _id: id }, scope] });
  const doc = await (lean ? q.lean() : q);
  if (!doc) throw AppError.notFound('Complaint');
  return doc;
}

/* ------------------------------------------------------------------ */
/* Create                                                              */
/* ------------------------------------------------------------------ */

const D1_FIELDS = [
  'complaintDate',
  'requester',
  'sbu',
  'country',
  'headQuarter',
  'shortDescription',
  'additionalRemarks',
  'category',
  'customer',
  'reportedProduct',
];

function pickD1(input) {
  const out = {};
  for (const k of D1_FIELDS) if (input[k] !== undefined) out[k] = input[k];
  return out;
}

/**
 * Register a complaint. Number generation, the record, the "register"
 * transition (Submitted → Acknowledgement pending) and the audit entries
 * commit together or not at all. If the transaction is retried after a
 * transient error, the number may skip, but it is never reused.
 *
 * `actor` is null for complaints arriving from WhatsApp (Phase 9).
 */
export async function createComplaint(input, { actor, origin, context } = {}) {
  return mongoose.connection.transaction(async (session) => {
    const complaintDate = input.complaintDate || new Date();
    const complaintNumber = await nextComplaintNumber(complaintDate, session);
    const [complaint] = await Complaint.create(
      [
        {
          ...pickD1(input),
          complaintDate,
          complaintNumber,
          origin,
          status: S.SUBMITTED,
          stage: 'D1',
          createdBy: actor?._id,
        },
      ],
      { session },
    );
    await audit.record({
      actor,
      action: 'complaint.create',
      entityType: 'Complaint',
      entityId: complaint._id,
      complaint: complaint._id,
      summary: `Registered complaint ${complaintNumber} via ${origin}`,
      after: pickD1(complaint.toObject()),
      context,
      session,
    });
    const { complaint: registered } = await workflow.perform(complaint._id, 'register', { actor, context, session });
    return registered;
  });
}

/* ------------------------------------------------------------------ */
/* List                                                                */
/* ------------------------------------------------------------------ */

const SORTS = {
  number: 'complaintNumber',
  date: 'complaintDate',
  updated: 'lastActivityAt',
  status: 'status',
  sbu: 'sbu',
  country: 'country',
};

export async function listComplaints(query, user, permissions, page) {
  const scope = await visibilityFilter(user, permissions);
  const and = [scope];

  if (query.mine) {
    // "My assigned complaints": always narrowed to the user, even for admins.
    const assigned = await ComplaintAssignment.distinct('complaint', { assignee: user._id, active: true });
    and.push({ $or: [{ frp: user._id }, { _id: { $in: assigned } }] });
  }
  if (query.search) {
    const rx = new RegExp(escapeRegex(query.search.trim()), 'i');
    and.push({
      $or: [
        { complaintNumber: rx },
        { 'requester.name': rx },
        { shortDescription: rx },
        { 'customer.name': rx },
        { 'reportedProduct.name': rx },
        { 'reportedProduct.batchNumber': rx },
        { 'd2.verifiedProduct.batchNumber': rx },
      ],
    });
  }
  if (query.status?.length) and.push({ status: { $in: query.status } });
  if (query.stage) and.push({ stage: query.stage });
  if (query.sbu) and.push({ sbu: query.sbu });
  if (query.country) and.push({ country: query.country });
  if (query.origin) and.push({ origin: query.origin });
  if (query.frp) and.push({ frp: query.frp });
  if (query.open) and.push({ status: { $ne: S.CLOSED } });
  if (query.overdue) and.push({ stageDueAt: { $lt: new Date() }, status: { $ne: S.CLOSED } });
  if (query.from || query.to) {
    const range = {};
    if (query.from) range.$gte = query.from;
    if (query.to) range.$lte = query.to;
    and.push({ complaintDate: range });
  }

  const filter = { $and: and };
  const field = SORTS[query.sort] || 'lastActivityAt';
  const dir = query.order === 'asc' ? 1 : -1;

  const [items, total] = await Promise.all([
    Complaint.find(filter)
      .sort({ [field]: dir, _id: dir })
      .skip(page.skip)
      .limit(page.limit)
      .select(
        'complaintNumber complaintDate requester.name sbu country reportedProduct.name d2.verifiedProduct.productName shortDescription stage status priority frp origin lastActivityAt stageDueAt',
      )
      .populate('frp', 'name')
      .lean(),
    Complaint.countDocuments(filter),
  ]);

  return {
    items: items.map((c) => ({ ...c, statusLabel: STATUS_LABELS[c.status] })),
    meta: pageMeta(page, total),
  };
}

/** Values for the list's filter dropdowns, limited to what the user can see. */
export async function filterOptions(user, permissions) {
  const scope = await visibilityFilter(user, permissions);
  const [sbus, countries] = await Promise.all([Complaint.distinct('sbu', scope), Complaint.distinct('country', scope)]);
  return { sbus: sbus.sort(), countries: countries.sort() };
}

/* ------------------------------------------------------------------ */
/* Detail                                                              */
/* ------------------------------------------------------------------ */

export async function getDetail(id, user, permissions) {
  const complaint = await findVisible(id, user, permissions);
  await complaint.populate([
    { path: 'frp', select: 'name email designation' },
    { path: 'd2.completedBy', select: 'name' },
    { path: 'createdBy', select: 'name' },
    { path: 'acknowledgement.approvedBy', select: 'name' },
  ]);
  const attachmentCount = await ComplaintAttachment.countDocuments({ complaint: complaint._id, deletedAt: null });
  const canEditD1 =
    [S.SUBMITTED, S.D1_ACK_PENDING].includes(complaint.status) &&
    (permissions.has(P.COMPLAINT_D1_ACKNOWLEDGE) || permissions.has(P.COMPLAINT_CREATE_MANUAL));

  // D3 review state: who is reviewing, which version, and whether this user may decide.
  let review = null;
  let mayReview = false;
  if ([S.D3_IN_PROGRESS, S.D3_PENDING_APPROVAL, S.D3_REWORK, S.D3_APPROVED, S.D4_IN_PROGRESS, S.CLOSED].includes(complaint.status)) {
    const [analysis, assignment] = await Promise.all([
      RootCauseAnalysis.findOne({ complaint: complaint._id }, { status: 1, submissionCount: 1, lastSubmittedBy: 1, lastSubmittedAt: 1, reviewedAt: 1 })
        .populate('lastSubmittedBy', 'name')
        .lean(),
      ComplaintAssignment.findOne({ complaint: complaint._id, role: 'REVIEWER', active: true }).populate('assignee', 'name email').lean(),
    ]);
    if (analysis) {
      review = {
        analysisStatus: analysis.status,
        version: analysis.submissionCount,
        submittedBy: analysis.lastSubmittedBy,
        submittedAt: analysis.lastSubmittedAt,
        reviewer: assignment?.assignee || null,
      };
      mayReview =
        complaint.status === S.D3_PENDING_APPROVAL &&
        permissions.has(P.COMPLAINT_D3_REVIEW) &&
        String(analysis.lastSubmittedBy?._id) !== String(user._id) &&
        (String(assignment?.assignee?._id) === String(user._id) || permissions.has(P.USERS_MANAGE));
    }
  }

  const assignable = [S.D2_IN_PROGRESS, S.D2_COMPLETED, S.D3_IN_PROGRESS, S.D3_PENDING_APPROVAL, S.D3_REWORK, S.D3_APPROVED, S.D4_IN_PROGRESS];
  return {
    complaint: { ...complaint.toJSON(), statusLabel: STATUS_LABELS[complaint.status] },
    nextActions: workflow.availableActions(complaint, permissions),
    review,
    attachmentCount,
    can: {
      editD1: canEditD1,
      upload: permissions.has(P.ATTACHMENT_UPLOAD),
      editD2: complaint.status === S.D2_IN_PROGRESS && permissions.has(P.COMPLAINT_D2_EDIT),
      assignFrp: assignable.includes(complaint.status) && permissions.has(P.COMPLAINT_ASSIGN),
      // Same rule as d3Service.canEdit: the current FRP, or a see-everything user, while D3 is open.
      editD3:
        [S.D3_IN_PROGRESS, S.D3_REWORK].includes(complaint.status) &&
        permissions.has(P.COMPLAINT_D3_EDIT) &&
        (String(complaint.frp?._id ?? complaint.frp) === String(user._id) || permissions.has(P.COMPLAINT_VIEW_ALL)),
      reviewD3: mayReview,
    },
  };
}

/* ------------------------------------------------------------------ */
/* D1 edit                                                             */
/* ------------------------------------------------------------------ */

/**
 * Correct D1 information before acknowledgement. `version` must be the __v
 * the user loaded; if someone saved in between, the edit is refused with 409
 * instead of overwriting their change.
 */
export async function updateD1(id, { version, ...input }, { user, permissions, context }) {
  if (!permissions.has(P.COMPLAINT_D1_ACKNOWLEDGE) && !permissions.has(P.COMPLAINT_CREATE_MANUAL)) {
    throw AppError.forbidden();
  }
  const complaint = await findVisible(id, user, permissions);
  if (![S.SUBMITTED, S.D1_ACK_PENDING].includes(complaint.status)) {
    throw AppError.conflict('D1 details are locked once the complaint has been acknowledged.');
  }
  if (complaint.__v !== version) {
    throw AppError.conflict('Someone else changed this complaint after you opened it. Reload to see their changes, then edit again.');
  }

  const before = pickD1(complaint.toObject());
  const changes = pickD1(input);
  // Set each group separately: a nested group (requester, customer, product)
  // is replaced as a whole, so a sub-field the user emptied is cleared.
  for (const [key, value] of Object.entries(changes)) complaint.set(key, value);
  complaint.lastActivityAt = new Date();
  await complaint.save();

  const diff = audit.diff(before, pickD1(complaint.toObject()));
  if (Object.keys(diff.after).length) {
    await audit.record({
      actor: user,
      action: 'complaint.d1.update',
      entityType: 'Complaint',
      entityId: complaint._id,
      complaint: complaint._id,
      summary: 'Edited D1 details',
      ...diff,
      context,
    });
  }
  return getDetail(id, user, permissions);
}

/* ------------------------------------------------------------------ */
/* History                                                             */
/* ------------------------------------------------------------------ */

export async function history(id, user, permissions) {
  const complaint = await findVisible(id, user, permissions, { lean: true });
  return AuditLog.find({ complaint: complaint._id })
    .sort({ at: -1, _id: -1 })
    .limit(500)
    .select('at actorName actorType action summary before after')
    .lean();
}

/* ------------------------------------------------------------------ */
/* Dashboard                                                           */
/* ------------------------------------------------------------------ */

/**
 * Counts for the dashboard, from live data, within the user's visibility.
 * Each count maps to a list filter so the number is clickable.
 */
export async function dashboardSummary(user, permissions) {
  const scope = await visibilityFilter(user, permissions);
  const now = new Date();

  // One indexed count per status is much cheaper than grouping every document.
  const statusKeys = Object.values(S);
  const [statusCounts, total, newToday, overdue, assignedToMe] = await Promise.all([
    Promise.all(statusKeys.map((status) => Complaint.countDocuments({ $and: [scope, { status }] }))),
    Complaint.countDocuments(scope),
    Complaint.countDocuments({ $and: [scope, { createdAt: { $gte: new Date(now - 24 * 3600 * 1000) } }] }),
    Complaint.countDocuments({ $and: [scope, { stageDueAt: { $type: 'date', $lt: now } }, { status: { $ne: S.CLOSED } }] }),
    Complaint.countDocuments({ $and: [scope, { frp: user._id, status: { $ne: S.CLOSED } }] }),
  ]);
  const byStatus = statusKeys.map((key, i) => ({ _id: key, n: statusCounts[i] }));

  const count = Object.fromEntries(byStatus.map((r) => [r._id, r.n]));
  const sum = (...keys) => keys.reduce((n, k) => n + (count[k] || 0), 0);

  return {
    total,
    newLast24h: newToday,
    awaitingAcknowledgement: sum(S.SUBMITTED, S.D1_ACK_PENDING),
    awaitingAssignment: sum(S.D1_ACKNOWLEDGED, S.D2_IN_PROGRESS),
    inInvestigation: sum(S.D2_COMPLETED, S.D3_IN_PROGRESS),
    pendingApproval: sum(S.D3_PENDING_APPROVAL),
    rework: sum(S.D3_REWORK),
    inD4: sum(S.D3_APPROVED, S.D4_IN_PROGRESS),
    closed: sum(S.CLOSED),
    overdue,
    assignedToMe,
    // Overdue needs SLA rules (OPEN_QUESTIONS Q6a); until then it is always 0.
    slaConfigured: false,
    byStatus: Object.values(S).map((key) => ({ key, label: STATUS_LABELS[key], count: count[key] || 0 })),
  };
}
