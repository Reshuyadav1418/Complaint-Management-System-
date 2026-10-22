import mongoose from 'mongoose';
import { Complaint, ComplaintStatusHistory } from '../models/index.js';
import { STATUSES as S, STATUS_STAGE, STATUS_LABELS } from '../config/workflow.js';
import { PERMISSIONS as P } from '../auth/permissions.js';
import { AppError } from '../utils/AppError.js';
import * as audit from './auditService.js';

/**
 * Every allowed status change, in one table.
 *
 *   permission  what the actor needs (null = system only, e.g. registration)
 *   requires    checks on the complaint; each returns an error message or null
 *   remarks     'required' when the actor must explain (rejections)
 *   pending     the business rule is not confirmed; the transition is refused
 *   phase       the build phase that exposes this action in the UI/API
 *
 * Nothing else in the codebase may write complaint.status. Stage endpoints in
 * later phases call perform() with their action name.
 */
/**
 * D2 fields that must be filled before D2 can be completed. A placeholder
 * set until the business confirms the mandatory list (OPEN_QUESTIONS Q6c).
 */
export const D2_REQUIRED = Object.freeze([
  ['d2.verifiedProduct.batchNumber', 'verified batch number'],
  ['d2.investigation.manufacturingLocation', 'manufacturing location'],
  ['d2.investigation.typeOfFailure', 'type of failure'],
  ['d2.investigation.severity.score', 'severity score'],
]);

const get = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

function missingD2(c) {
  const missing = D2_REQUIRED.filter(([path]) => {
    const v = get(c, path);
    return v === undefined || v === null || v === '';
  }).map(([, label]) => label);
  return missing.length ? `Complete the D2 fields before finishing D2: ${missing.join(', ')}.` : null;
}

export const TRANSITIONS = Object.freeze([
  { action: 'register', label: 'Register', from: S.SUBMITTED, to: S.D1_ACK_PENDING, permission: null, phase: 3 },
  {
    action: 'acknowledge',
    label: 'Approve acknowledgement',
    from: S.D1_ACK_PENDING,
    to: S.D1_ACKNOWLEDGED,
    permission: P.COMPLAINT_D1_ACKNOWLEDGE,
    requires: [(c) => (c.requester?.email ? null : 'Requester email is needed to send the acknowledgement.')],
    phase: 4,
  },
  { action: 'startD2', label: 'Start D2', from: S.D1_ACKNOWLEDGED, to: S.D2_IN_PROGRESS, permission: P.COMPLAINT_D2_EDIT, phase: 5 },
  {
    action: 'completeD2',
    label: 'Complete D2',
    from: S.D2_IN_PROGRESS,
    to: S.D2_COMPLETED,
    permission: P.COMPLAINT_D2_EDIT,
    requires: [(c) => (c.frp ? null : 'Assign a First Responsible Person before completing D2.'), missingD2],
    phase: 5,
  },
  { action: 'startD3', label: 'Start analysis', from: S.D2_COMPLETED, to: S.D3_IN_PROGRESS, permission: P.COMPLAINT_D3_EDIT, phase: 6 },
  { action: 'submitD3', label: 'Submit for approval', from: S.D3_IN_PROGRESS, to: S.D3_PENDING_APPROVAL, permission: P.COMPLAINT_D3_EDIT, phase: 7 },
  { action: 'resubmitD3', label: 'Resubmit for approval', from: S.D3_REWORK, to: S.D3_PENDING_APPROVAL, permission: P.COMPLAINT_D3_EDIT, phase: 7 },
  { action: 'approveD3', label: 'Approve analysis', from: S.D3_PENDING_APPROVAL, to: S.D3_APPROVED, permission: P.COMPLAINT_D3_REVIEW, phase: 7 },
  {
    action: 'rejectD3',
    label: 'Reject and return for rework',
    from: S.D3_PENDING_APPROVAL,
    to: S.D3_REWORK,
    permission: P.COMPLAINT_D3_REVIEW,
    remarks: 'required',
    phase: 7,
  },
  { action: 'startD4', label: 'Start D4', from: S.D3_APPROVED, to: S.D4_IN_PROGRESS, permission: P.COMPLAINT_D4_EDIT, pending: true, phase: 8 },
  { action: 'close', label: 'Close complaint', from: S.D4_IN_PROGRESS, to: S.CLOSED, permission: P.COMPLAINT_CLOSE, pending: true, phase: 8 },
]);

const byAction = new Map(TRANSITIONS.map((t) => [t.action, t]));

function unmet(transition, complaint) {
  return (transition.requires || []).map((check) => check(complaint)).filter(Boolean);
}

/**
 * Actions the user could take on this complaint now, with the reason any of
 * them is blocked. Used by the detail page to show "what happens next".
 */
export function availableActions(complaint, permissions) {
  return TRANSITIONS.filter((t) => t.from === complaint.status && t.permission).map((t) => {
    const blockers = [];
    if (t.pending) blockers.push('The business rules for this step are not confirmed yet.');
    if (!permissions.has(t.permission)) blockers.push('Your role cannot perform this step.');
    blockers.push(...unmet(t, complaint));
    return { action: t.action, label: t.label, to: t.to, toLabel: STATUS_LABELS[t.to], phase: t.phase, remarks: t.remarks || 'optional', allowed: blockers.length === 0, blockers };
  });
}

/** True if a transition with this idempotency key was already recorded. */
export async function alreadyDone(complaintId, idempotencyKey) {
  if (!idempotencyKey) return false;
  return Boolean(await ComplaintStatusHistory.exists({ complaint: complaintId, idempotencyKey }));
}

/**
 * Perform a transition atomically.
 *
 * The status update is conditional on the current status, so two people
 * pressing the same button at once cannot both succeed. The history row
 * and audit entry are written in the same transaction as the update.
 *
 * If idempotencyKey was already used for this complaint, the earlier result
 * is returned and nothing is written; a retried request is harmless.
 *
 * Pass `session` to join a caller's transaction (e.g. complaint creation).
 */
export async function perform(complaintId, action, { actor, permissions, remarks, idempotencyKey, context, session } = {}) {
  const t = byAction.get(action);
  if (!t) throw AppError.badRequest(`Unknown workflow action "${action}".`);

  if (t.permission === null && actor && permissions) {
    throw AppError.forbidden('This step is performed by the system.');
  }
  if (t.permission && !permissions?.has(t.permission)) throw AppError.forbidden();
  if (t.pending) {
    throw AppError.conflict('This step is not available yet: its business rules are still to be confirmed.');
  }
  const note = remarks?.trim() || undefined;
  if (t.remarks === 'required' && !note) {
    throw AppError.validation([{ field: 'remarks', message: 'Enter remarks explaining this decision.' }]);
  }

  const run = async (s) => {
    if (idempotencyKey) {
      const previous = await ComplaintStatusHistory.findOne({ complaint: complaintId, idempotencyKey }).session(s);
      if (previous) {
        return { complaint: await Complaint.findById(complaintId).session(s), replayed: true };
      }
    }

    const current = await Complaint.findById(complaintId).session(s);
    if (!current) throw AppError.notFound('Complaint');
    if (current.status !== t.from) {
      throw AppError.conflict(
        `This complaint is now "${STATUS_LABELS[current.status]}", so "${t.label}" is no longer possible. Reload to see the latest state.`,
      );
    }
    const problems = unmet(t, current);
    if (problems.length) throw AppError.validation(problems.map((message) => ({ field: null, message })));

    const now = new Date();
    const updated = await Complaint.findOneAndUpdate(
      { _id: complaintId, status: t.from },
      {
        $set: {
          status: t.to,
          stage: STATUS_STAGE[t.to],
          lastActivityAt: now,
          ...(t.to === S.CLOSED ? { closedAt: now } : {}),
        },
        $inc: { __v: 1 },
      },
      { returnDocument: 'after', session: s },
    );
    if (!updated) throw AppError.conflict('Someone else changed this complaint at the same moment. Reload and try again.');

    await ComplaintStatusHistory.create(
      [{ complaint: complaintId, fromStatus: t.from, toStatus: t.to, actor: actor?._id, at: now, remarks: note, idempotencyKey }],
      { session: s },
    );
    await audit.record({
      actor,
      action: `complaint.status.${t.action}`,
      entityType: 'Complaint',
      entityId: updated._id,
      complaint: updated._id,
      summary: `${STATUS_LABELS[t.from]} → ${STATUS_LABELS[t.to]}`,
      before: { status: t.from },
      after: { status: t.to, ...(note ? { remarks: note } : {}) },
      context,
      session: s,
    });
    return { complaint: updated, replayed: false };
  };

  try {
    if (session) return await run(session);
    return await mongoose.connection.transaction(run);
  } catch (err) {
    // Two identical retries racing: the unique (complaint, idempotencyKey)
    // index rejects the second one. Treat it as the replay it is.
    if (err?.code === 11000 && idempotencyKey && !session) {
      return { complaint: await Complaint.findById(complaintId), replayed: true };
    }
    throw err;
  }
}
