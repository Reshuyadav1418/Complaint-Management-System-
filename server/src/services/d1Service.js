import mongoose from 'mongoose';
import { Complaint, ComplaintStageRecord } from '../models/index.js';
import { PERMISSIONS as P } from '../auth/permissions.js';
import { AppError } from '../utils/AppError.js';
import { d1Acknowledgement } from '../mail/templates.js';
import { findVisible, getDetail } from './complaintService.js';
import * as workflow from './workflowService.js';
import * as notifications from './notificationService.js';
import * as audit from './auditService.js';

const SNAPSHOT_FIELDS =
  'complaintNumber complaintDate origin requester sbu country headQuarter shortDescription additionalRemarks category customer reportedProduct';

/** What the requester will receive; shown in the confirmation dialog. */
export async function acknowledgementPreview(id, user, permissions) {
  const complaint = await findVisible(id, user, permissions, { lean: true });
  if (!permissions.has(P.COMPLAINT_D1_ACKNOWLEDGE)) throw AppError.forbidden();
  const { subject, text } = d1Acknowledgement(complaint);
  return { to: complaint.requester?.email || null, subject, text };
}

/**
 * Approve D1 acknowledgement.
 *
 * In one transaction:
 *   - status D1_ACK_PENDING → D1_ACKNOWLEDGED (checked by the workflow service:
 *     permission, current status, requester email present)
 *   - acknowledgement.approvedBy / approvedAt / remarks
 *   - a stage record with a snapshot of the D1 data that was acknowledged
 *   - the acknowledgement email, queued with dedupeKey D1_ACK:<id>
 *   - an audit entry
 *
 * Safe against repeats: a second click gets 409 from the workflow; a retried
 * request with the same idempotencyKey returns the result without writing;
 * and the dedupeKey makes a second email impossible either way.
 */
export async function acknowledge(id, { remarks, idempotencyKey }, { user, permissions, context }) {
  await findVisible(id, user, permissions, { lean: true });
  let queued = null;

  await mongoose.connection.transaction(async (session) => {
    queued = null;
    const { complaint, replayed } = await workflow.perform(id, 'acknowledge', {
      actor: user,
      permissions,
      remarks,
      idempotencyKey,
      context,
      session,
    });
    if (replayed) return;

    const now = new Date();
    const note = remarks?.trim() || undefined;
    await Complaint.updateOne(
      { _id: complaint._id },
      { $set: { acknowledgement: { approvedBy: user._id, approvedAt: now, remarks: note } } },
      { session },
    );

    const snapshot = await Complaint.findById(complaint._id).select(SNAPSHOT_FIELDS).session(session).lean();
    await ComplaintStageRecord.create(
      [{ complaint: complaint._id, stage: 'D1', kind: 'ACKNOWLEDGEMENT', actor: user._id, at: now, remarks: note, snapshot }],
      { session },
    );

    const { notification, created } = await notifications.enqueue({
      type: 'D1_ACKNOWLEDGEMENT',
      complaint: complaint._id,
      recipient: complaint.requester.email,
      dedupeKey: `D1_ACK:${complaint._id}`,
      message: d1Acknowledgement(complaint),
      session,
    });
    queued = created ? notification : null;

    // WhatsApp complaints also get a short status message on WhatsApp.
    // Outside WhatsApp's 24-hour reply window Meta requires an approved
    // template; see docs/WHATSAPP.md.
    const waId = complaint.origin === 'WhatsApp' && complaint.requester?.mobile?.replace(/\D/g, '');
    if (waId) {
      await notifications.enqueue({
        type: 'WHATSAPP_STATUS_UPDATE',
        channel: 'whatsapp',
        complaint: complaint._id,
        recipient: waId,
        dedupeKey: `WA_ACK:${complaint._id}`,
        message: {
          subject: `Complaint ${complaint.complaintNumber} acknowledged`,
          text: `Update on complaint *${complaint.complaintNumber}*: our team has acknowledged it and started reviewing it. We have sent the details to ${complaint.requester.email}.`,
        },
        session,
      });
    }

    await audit.record({
      actor: user,
      action: 'complaint.d1.acknowledge',
      entityType: 'Complaint',
      entityId: complaint._id,
      complaint: complaint._id,
      summary: created
        ? `Approved acknowledgement; email queued to ${complaint.requester.email}`
        : 'Approved acknowledgement; acknowledgement email had already been queued',
      after: { remarks: note },
      context,
      session,
    });
  });

  if (queued) notifications.nudge();
  return getDetail(id, user, permissions);
}
