import { describe, it, expect } from 'vitest';
import { useDatabase, makeUser, makeComplaint, models } from './helpers.js';
import { perform, availableActions, TRANSITIONS } from '../src/services/workflowService.js';
import { permissionsFor } from '../src/services/roleService.js';
import { STATUSES as S } from '../src/config/workflow.js';

useDatabase();

const { Complaint, ComplaintStatusHistory, AuditLog } = models;

async function actor(role) {
  const user = await makeUser({ roles: [role] });
  return { actor: user, permissions: new Set(await permissionsFor([role])) };
}

/** Put a complaint directly into a status, bypassing the workflow (test setup only). */
async function forceStatus(complaint, status, extra = {}) {
  await Complaint.updateOne({ _id: complaint._id }, { status, ...extra });
}

describe('transition table', () => {
  it('has no two transitions with the same action, and every target status exists', () => {
    const actions = TRANSITIONS.map((t) => t.action);
    expect(new Set(actions).size).toBe(actions.length);
    for (const t of TRANSITIONS) {
      expect(Object.values(S)).toContain(t.from);
      expect(Object.values(S)).toContain(t.to);
    }
  });

  it('every non-closed status has a way forward, and Closed has none', () => {
    for (const status of Object.values(S)) {
      const out = TRANSITIONS.filter((t) => t.from === status);
      if (status === S.CLOSED) expect(out).toHaveLength(0);
      else expect(out.length).toBeGreaterThan(0);
    }
  });
});

describe('perform', () => {
  it('registration moves a new complaint to acknowledgement pending and records it', async () => {
    const qc = await actor('quality_coordinator');
    const c = await makeComplaint(qc.actor);
    expect(c.status).toBe(S.D1_ACK_PENDING);
    const history = await ComplaintStatusHistory.find({ complaint: c._id }).lean();
    expect(history.map((h) => [h.fromStatus, h.toStatus])).toEqual([[S.SUBMITTED, S.D1_ACK_PENDING]]);
  });

  it('refuses a transition from the wrong status', async () => {
    const qc = await actor('quality_coordinator');
    const c = await makeComplaint(qc.actor);
    await expect(perform(c._id, 'startD2', qc)).rejects.toMatchObject({ status: 409 });
  });

  it('refuses a user without the permission, even if the status is right', async () => {
    const qc = await actor('quality_coordinator');
    const frp = await actor('frp');
    const c = await makeComplaint(qc.actor);
    await expect(perform(c._id, 'acknowledge', frp)).rejects.toMatchObject({ status: 403 });
  });

  it('refuses system-only steps when a user attempts them', async () => {
    const admin = await actor('admin');
    const c = await makeComplaint(admin.actor);
    await forceStatus(c, S.SUBMITTED);
    await expect(perform(c._id, 'register', admin)).rejects.toMatchObject({ status: 403 });
  });

  it('checks required data before moving on', async () => {
    const qc = await actor('quality_coordinator');
    const noEmail = await makeComplaint(qc.actor, { requester: { name: 'Walk-in customer' } });
    await expect(perform(noEmail._id, 'acknowledge', qc)).rejects.toMatchObject({ status: 422 });

    await forceStatus(noEmail, S.D2_IN_PROGRESS);
    await expect(perform(noEmail._id, 'completeD2', qc)).rejects.toMatchObject({
      status: 422,
      details: expect.arrayContaining([{ field: null, message: expect.stringMatching(/First Responsible Person/) }]),
    });
  });

  it('requires remarks to reject, and records them', async () => {
    const qc = await actor('quality_coordinator');
    const reviewer = await actor('reviewer');
    const c = await makeComplaint(qc.actor);
    await forceStatus(c, S.D3_PENDING_APPROVAL);

    await expect(perform(c._id, 'rejectD3', { ...reviewer, remarks: '   ' })).rejects.toMatchObject({ status: 422 });
    const { complaint } = await perform(c._id, 'rejectD3', { ...reviewer, remarks: 'Root cause not supported by evidence.' });
    expect(complaint.status).toBe(S.D3_REWORK);
    const h = await ComplaintStatusHistory.findOne({ complaint: c._id, toStatus: S.D3_REWORK }).lean();
    expect(h.remarks).toBe('Root cause not supported by evidence.');
    expect(String(h.actor)).toBe(String(reviewer.actor._id));
  });

  it('refuses steps whose business rules are pending', async () => {
    const admin = await actor('admin');
    const c = await makeComplaint(admin.actor);
    await forceStatus(c, S.D3_APPROVED);
    await expect(perform(c._id, 'startD4', admin)).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/not available yet/) });
  });

  it('a retried request with the same idempotency key changes nothing the second time', async () => {
    const qc = await actor('quality_coordinator');
    const c = await makeComplaint(qc.actor);
    const first = await perform(c._id, 'acknowledge', { ...qc, idempotencyKey: 'ack-1' });
    const second = await perform(c._id, 'acknowledge', { ...qc, idempotencyKey: 'ack-1' });
    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.complaint.status).toBe(S.D1_ACKNOWLEDGED);
    expect(await ComplaintStatusHistory.countDocuments({ complaint: c._id, toStatus: S.D1_ACKNOWLEDGED })).toBe(1);
    expect(await AuditLog.countDocuments({ complaint: c._id, action: 'complaint.status.acknowledge' })).toBe(1);
  });

  it('when two people press the same button at once, exactly one succeeds', async () => {
    const qc1 = await actor('quality_coordinator');
    const qc2 = await actor('quality_coordinator');
    const c = await makeComplaint(qc1.actor);
    const results = await Promise.allSettled([perform(c._id, 'acknowledge', qc1), perform(c._id, 'acknowledge', qc2)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((r) => r.status === 'rejected').reason.status).toBe(409);
    expect(await ComplaintStatusHistory.countDocuments({ complaint: c._id, toStatus: S.D1_ACKNOWLEDGED })).toBe(1);
  });

  it('keeps stage in step with status', async () => {
    const qc = await actor('quality_coordinator');
    const c = await makeComplaint(qc.actor);
    await perform(c._id, 'acknowledge', qc);
    const { complaint } = await perform(c._id, 'startD2', qc);
    expect(complaint.stage).toBe('D2');
  });
});

describe('availableActions', () => {
  it('explains why a step is blocked', async () => {
    const frp = await actor('frp');
    const qc = await actor('quality_coordinator');
    const c = await makeComplaint(qc.actor, { requester: { name: 'No Email' } });
    const [ack] = availableActions(c, frp.permissions);
    expect(ack.action).toBe('acknowledge');
    expect(ack.allowed).toBe(false);
    expect(ack.blockers).toEqual(['Your role cannot perform this step.', 'Requester email is needed to send the acknowledgement.']);
  });
});
