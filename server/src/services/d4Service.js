import mongoose from 'mongoose';
import { Complaint, CapaRecord, User, RootCause } from '../models/index.js';
import { STATUSES as S, STAGES } from '../config/workflow.js';
import { AppError } from '../utils/AppError.js';
import { findVisible, getDetail } from './complaintService.js';
import * as inApp from './inAppNotificationService.js';
import * as notifications from './notificationService.js';
import {
  capaImplementationAssignment,
  movedToD4Stage,
  complaintSuccessfullyClosed,
} from '../mail/templates.js';

/**
 * D4 & CAPA Lifecycle Service implementing business rules from the Process Manual:
 * - Multi-tier CAPA implementation approvals (FRP, Handler, QA)
 * - Cost of Poor Quality (COPQ in INR)
 * - Effectiveness Responsible Person (ERP) assignment & review
 * - Final Complaint closure
 */

export async function updateCopq(complaintId, { logisticsCost = 0, testingCost = 0, reprocessingCost = 0 }, { user, permissions }) {
  const complaint = await findVisible(complaintId, user, permissions);
  const totalCost = Number(logisticsCost || 0) + Number(testingCost || 0) + Number(reprocessingCost || 0);
  complaint.set('d4.copq', {
    logisticsCost: Number(logisticsCost || 0),
    testingCost: Number(testingCost || 0),
    reprocessingCost: Number(reprocessingCost || 0),
    totalCost,
  });
  complaint.lastActivityAt = new Date();
  await complaint.save();
  return getDetail(complaintId, user, permissions);
}

export async function updateCapaImplementation(capaId, { actionImplemented, forwardForReview }, { user, permissions }) {
  const capa = await CapaRecord.findById(capaId);
  if (!capa) throw AppError.notFound('CAPA record not found.');
  const complaint = await Complaint.findById(capa.complaint);

  capa.actionImplemented = actionImplemented;
  capa.forwardForReview = Boolean(forwardForReview);
  if (forwardForReview) {
    capa.actionStatus = 'IN_PROGRESS';
    const isFrpSameAsRp = complaint.frp && String(complaint.frp) === String(capa.responsiblePerson || user._id);
    const now = new Date();

    if (isFrpSameAsRp) {
      // Case 1: FRP == Responsible Person -> Auto-accepted
      capa.frpImplementationApproval = {
        status: 'APPROVED',
        comments: 'Auto-accepted (FRP is Responsible Person)',
        approver: user._id,
        date: now,
      };
      capa.approvalHistory.push({
        step: 'FRP CAPA Implementation Approval',
        status: 'Approved',
        assignedTo: user.name,
        actualApprover: user.name,
        date: now,
        comments: 'Auto-accepted',
      });
      capa.handlerImplementationApproval = { status: 'PENDING' };

      // Notify Complaint Handler
      const handlers = await User.find({ roles: { $in: ['admin', 'quality_coordinator'] } }, { _id: 1, email: 1, name: 1 }).lean();
      for (const h of handlers) {
        await inApp.createNotification({
          recipient: h._id,
          complaint: complaint._id,
          title: 'CAPA Review Required (Handler)',
          message: `The CAPA implementation has been completed by ${user.name} and requires your review as Complaint Handler for ${capa.capaNumber}.`,
          link: `/complaints/${complaint._id}?tab=D3`,
        });
      }
    } else {
      // Case 2: FRP != Responsible Person -> Manual FRP Approval required
      capa.frpImplementationApproval = { status: 'PENDING' };
      if (complaint.frp) {
        const frp = await User.findById(complaint.frp).lean();
        if (frp) {
          await inApp.createNotification({
            recipient: frp._id,
            complaint: complaint._id,
            title: 'CAPA Review Required - FRP',
            message: `The CAPA implementation has been completed by ${user.name} and requires your review as FRP for ${capa.capaNumber}.`,
            link: `/complaints/${complaint._id}?tab=D3`,
          });
        }
      }
    }
  }

  await capa.save();
  return capa;
}

export async function decideImplementationApproval(capaId, { tier, decision, comments }, { user, permissions }) {
  const capa = await CapaRecord.findById(capaId);
  if (!capa) throw AppError.notFound('CAPA record not found.');
  const complaint = await Complaint.findById(capa.complaint);
  const now = new Date();
  const isApproved = decision === 'APPROVED';

  if (tier === 'FRP') {
    capa.frpImplementationApproval = { status: isApproved ? 'APPROVED' : 'REJECTED', comments, approver: user._id, date: now };
    capa.approvalHistory.push({
      step: 'FRP CAPA Implementation Approval',
      status: isApproved ? 'Approved' : 'Rejected',
      assignedTo: user.name,
      actualApprover: user.name,
      date: now,
      comments,
    });
    if (isApproved) {
      capa.handlerImplementationApproval = { status: 'PENDING' };
    }
  } else if (tier === 'HANDLER') {
    capa.handlerImplementationApproval = { status: isApproved ? 'APPROVED' : 'REJECTED', comments, approver: user._id, date: now };
    capa.approvalHistory.push({
      step: 'Handler CAPA Implementation Approval',
      status: isApproved ? 'Approved' : 'Rejected',
      assignedTo: user.name,
      actualApprover: user.name,
      date: now,
      comments,
    });
    if (isApproved) {
      capa.qaImplementationApproval = { status: 'PENDING' };
    }
  } else if (tier === 'QA') {
    capa.qaImplementationApproval = { status: isApproved ? 'APPROVED' : 'REJECTED', comments, approver: user._id, date: now };
    capa.approvalHistory.push({
      step: 'QA CAPA Implementation Approval',
      status: isApproved ? 'Approved' : 'Rejected',
      assignedTo: user.name,
      actualApprover: user.name,
      date: now,
      comments,
    });
    if (isApproved) {
      capa.actionStatus = 'COMPLETED';
    }
  }

  await capa.save();

  // If approved at QA, check if all CAPAs are approved -> Move to D4 Stage
  if (tier === 'QA' && isApproved) {
    const allCapas = await CapaRecord.find({ complaint: complaint._id, deletedAt: null });
    const allApproved = allCapas.every((c) => c.qaImplementationApproval?.status === 'APPROVED');
    if (allApproved && allCapas.length > 0) {
      complaint.stage = STAGES.D4;
      complaint.status = S.D4_IN_PROGRESS;
      complaint.lastActivityAt = new Date();
      await complaint.save();

      // Dispatch 2 emails for moving to D4: Complaint Handler & FRP
      const frp = complaint.frp ? await User.findById(complaint.frp).lean() : null;
      const handlers = await User.find({ roles: { $in: ['admin', 'quality_coordinator'] } }).lean();

      for (const h of handlers) {
        await notifications.enqueue({
          type: 'D4_NOTICE',
          complaint: complaint._id,
          recipient: h.email,
          recipientUser: h._id,
          dedupeKey: `D4_NOTICE_HANDLER:${complaint._id}:${h.email}`,
          message: movedToD4Stage(complaint, { recipientName: h.name }),
        });
        await inApp.createNotification({
          recipient: h._id,
          complaint: complaint._id,
          title: 'Complaint Moved to D4 Stage',
          message: `Complaint ${complaint.complaintNumber} has completed CAPA Implementation and moved to D4 Stage.`,
          link: `/complaints/${complaint._id}?tab=D4`,
        });
      }

      if (frp) {
        await notifications.enqueue({
          type: 'D4_NOTICE',
          complaint: complaint._id,
          recipient: frp.email,
          recipientUser: frp._id,
          dedupeKey: `D4_NOTICE_FRP:${complaint._id}:${frp.email}`,
          message: movedToD4Stage(complaint, { recipientName: frp.name }),
        });
        await inApp.createNotification({
          recipient: frp._id,
          complaint: complaint._id,
          title: 'CAPA Implementation Completed',
          message: `CAPA Implementation for ${complaint.complaintNumber} is complete. Complaint is now in D4 stage.`,
          link: `/complaints/${complaint._id}?tab=D4`,
        });
      }
      notifications.nudge();
    }
  }

  return capa;
}

export async function assignErp(capaId, { erpId, scheduleType, scheduleTimeline, scheduleFrequency }, { user }) {
  const capa = await CapaRecord.findById(capaId);
  if (!capa) throw AppError.notFound('CAPA record not found.');
  const complaint = await Complaint.findById(capa.complaint);

  capa.erp = erpId;
  capa.scheduleType = scheduleType;
  if (scheduleType === 'Timeline') {
    capa.scheduleTimeline = scheduleTimeline ? new Date(scheduleTimeline) : undefined;
    capa.scheduleFrequency = undefined;
  } else {
    capa.scheduleFrequency = scheduleFrequency;
    capa.scheduleTimeline = undefined;
  }
  await capa.save();

  if (erpId) {
    const erpUser = await User.findById(erpId).lean();
    if (erpUser) {
      await inApp.createNotification({
        recipient: erpUser._id,
        complaint: complaint._id,
        title: 'Effectiveness Review Assigned to You',
        message: `You have been assigned as Effectiveness Responsible Person for CAPA: ${capa.capaNumber} on complaint: ${complaint.complaintNumber}. Please review and action accordingly.`,
        link: `/complaints/${complaint._id}?tab=D4`,
      });
    }
  }
  return capa;
}

export async function closeCapa(capaId, { effectivenessReview, isClosed }, { user }) {
  const capa = await CapaRecord.findById(capaId);
  if (!capa) throw AppError.notFound('CAPA record not found.');
  const complaint = await Complaint.findById(capa.complaint);

  capa.effectivenessReview = effectivenessReview;
  capa.isClosed = Boolean(isClosed);
  if (isClosed) {
    capa.closedAt = new Date();
    capa.actionStatus = 'VERIFIED';
  }
  await capa.save();

  // Notify Complaint Handler
  const handlers = await User.find({ roles: { $in: ['admin', 'quality_coordinator'] } }).lean();
  for (const h of handlers) {
    await inApp.createNotification({
      recipient: h._id,
      complaint: complaint._id,
      title: 'CAPA Process Completed',
      message: `CAPA ${capa.capaNumber} for complaint ${complaint.complaintNumber} has been marked closed by ERP.`,
      link: `/complaints/${complaint._id}?tab=D4`,
    });
  }

  // Check if ALL CAPAs for this complaint are now closed
  const allCapas = await CapaRecord.find({ complaint: complaint._id, deletedAt: null });
  const allClosed = allCapas.every((c) => c.isClosed);

  if (allClosed && allCapas.length > 0) {
    complaint.stage = STAGES.CLOSED;
    complaint.status = S.CLOSED;
    complaint.closedAt = new Date();
    complaint.set('d4.completedBy', user._id);
    complaint.set('d4.completedAt', new Date());
    await complaint.save();

    // 2 emails: Requester and Handler
    if (complaint.requester?.email) {
      await notifications.enqueue({
        type: 'CLOSURE',
        complaint: complaint._id,
        recipient: complaint.requester.email,
        dedupeKey: `CLOSURE_REQUESTER:${complaint._id}`,
        message: complaintSuccessfullyClosed(complaint, { recipientName: complaint.requester.name, isRequester: true }),
      });
    }
    for (const h of handlers) {
      await notifications.enqueue({
        type: 'CLOSURE',
        complaint: complaint._id,
        recipient: h.email,
        recipientUser: h._id,
        dedupeKey: `CLOSURE_HANDLER:${complaint._id}:${h.email}`,
        message: complaintSuccessfullyClosed(complaint, { recipientName: h.name, isRequester: false }),
      });
      await inApp.createNotification({
        recipient: h._id,
        complaint: complaint._id,
        title: 'Complaint Successfully Closed',
        message: `All CAPAs are closed. Complaint ${complaint.complaintNumber} has moved to Closed stage.`,
        link: `/complaints/${complaint._id}?tab=D4`,
      });
    }
    notifications.nudge();
  }

  return capa;
}
