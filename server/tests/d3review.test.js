import { describe, it, expect, beforeEach } from 'vitest';
import { useDatabase, makeUser, signIn, makeComplaint, models } from './helpers.js';
import { setMailer, memoryMailer } from '../src/mail/mailer.js';
import { processDue } from '../src/services/notificationService.js';

useDatabase();

const { Complaint, CapaRecord, ComplaintStageRecord, Notification, RootCauseAnalysis } = models;
let mail;
beforeEach(() => {
  mail = memoryMailer();
  setMailer(mail);
});

const tomorrow = () => new Date(Date.now() + 86400000).toISOString();

/** A complaint in D3 with a complete analysis: 2 root causes, 2 CAPA. */
async function readyToSubmit() {
  const qc = await makeUser({ roles: ['quality_coordinator'] });
  const frp = await makeUser({ roles: ['frp'], name: 'Ravi Kumar', email: 'ravi@example.test' });
  const reviewer = await makeUser({ roles: ['reviewer'], name: 'Meera Rao', email: 'meera@example.test' });
  const complaint = await makeComplaint(qc);
  await Complaint.updateOne({ _id: complaint._id }, { status: 'D2_COMPLETED', stage: 'D2', frp: frp._id });
  const agent = await signIn(frp);
  const base = `/api/complaints/${complaint._id}`;
  await agent.post(`${base}/start-d3`).send({}).expect(200);
  const v = (await agent.get(`${base}/d3`)).body.data.analysis.__v;
  await agent.patch(`${base}/d3/analysis`).send({ version: v, methods: ['FISHBONE'], problemStatement: 'Broken seals on batch RB2409' }).expect(200);
  await agent.post(`${base}/d3/causes`).send({ category: 'Machine', text: 'Sealer temperature drift' }).expect(200);
  await agent.post(`${base}/d3/root-causes`).send({ category: 'Machine', description: 'Sensor not recalibrated after maintenance' }).expect(200);
  let res = await agent.post(`${base}/d3/root-causes`).send({ category: 'Method', description: 'No seal integrity check at packing' });
  const [rc1, rc2] = res.body.data.rootCauses;
  await agent.post(`${base}/d3/root-causes/${rc1._id}/capa`).send({ capaRequired: true, category: 'Calibration', correctiveAction: 'Recalibrate the sensor', responsiblePerson: String(frp._id), targetDate: tomorrow() }).expect(200);
  res = await agent.post(`${base}/d3/root-causes/${rc2._id}/capa`).send({ capaRequired: true, category: 'Process control', correctiveAction: 'Hourly peel test', responsiblePerson: String(frp._id), targetDate: tomorrow() });
  return { qc, frp, reviewer, complaint, agent, base };
}

describe('readiness before submitting', () => {
  it('lists every gap in plain language', async () => {
    const qc = await makeUser({ roles: ['quality_coordinator'] });
    const frp = await makeUser({ roles: ['frp'] });
    const complaint = await makeComplaint(qc);
    await Complaint.updateOne({ _id: complaint._id }, { status: 'D2_COMPLETED', stage: 'D2', frp: frp._id });
    const agent = await signIn(frp);
    const base = `/api/complaints/${complaint._id}`;
    await agent.post(`${base}/start-d3`).send({}).expect(200);
    const v = (await agent.get(`${base}/d3`)).body.data.analysis.__v;
    await agent.patch(`${base}/d3/analysis`).send({ version: v, methods: ['WHY_WHY', 'FISHBONE'] }).expect(200);
    await agent.post(`${base}/d3/root-causes`).send({ category: 'Machine', description: 'Worn sealing head' }).expect(200);
    const res = await agent.get(`${base}/d3/readiness`);
    expect(res.body.data.issues).toEqual([
      'Enter the problem statement.',
      'Complete at least one Why-Why level with both the question and the answer.',
      'Add at least one cause to the fishbone diagram.',
      'Add a CAPA record (or record that CAPA is not required) for the root cause “Worn sealing head”.',
    ]);
  });

  it('refuses to submit to yourself or to someone who cannot review', async () => {
    const { agent, base, frp, qc } = await readyToSubmit();
    const self = await agent.post(`${base}/d3/submit`).send({ reviewerId: String(frp._id) });
    expect(self.body.error.details.map((d) => d.message)).toContain('You cannot review your own analysis. Choose another reviewer.');
    const notReviewer = await agent.post(`${base}/d3/submit`).send({ reviewerId: String(qc._id) });
    expect(notReviewer.status).toBe(422);
    expect((await Complaint.findOne({})).status).toBe('D3_IN_PROGRESS');
  });
});

describe('the full review cycle', () => {
  it('submit → reject with remarks → rework → resubmit → approve, with emails and history', async () => {
    const { agent, base, reviewer, complaint, frp } = await readyToSubmit();

    // Submit
    let res = await agent.post(`${base}/d3/submit`).send({ reviewerId: String(reviewer._id), remarks: 'Calibration records attached.' });
    expect(res.status).toBe(200);
    expect(res.body.data.complaint.status).toBe('D3_PENDING_APPROVAL');
    expect(res.body.data.review).toMatchObject({ analysisStatus: 'PENDING_APPROVAL', version: 1, reviewer: { name: 'Meera Rao' } });
    expect(await CapaRecord.countDocuments({ reviewStatus: 'SUBMITTED', approvalStatus: 'PENDING' })).toBe(2);

    // Locked while pending
    expect((await agent.post(`${base}/d3/causes`).send({ category: 'Method', text: 'Late change' })).status).toBe(409);

    await processDue();
    const request = mail.sent.find((m) => m.to === 'meera@example.test');
    expect(request.subject).toBe(`D3 Approval Requested – ${complaint.complaintNumber}`);
    expect(request.text).toContain('- Submitted By: Ravi Kumar');
    expect(request.text).toContain('- CAPA Records: 2');

    // Reject: remarks are mandatory
    const reviewerAgent = await signIn(reviewer);
    expect((await reviewerAgent.post(`${base}/d3/reject`).send({})).status).toBe(422);
    res = await reviewerAgent.post(`${base}/d3/reject`).send({ remarks: 'Attach the sensor calibration certificate and add a preventive action for the checklist.' });
    expect(res.body.data.complaint.status).toBe('D3_REWORK');
    expect(await CapaRecord.countDocuments({ reviewStatus: 'REVIEWED', approvalStatus: 'REJECTED' })).toBe(2);

    // One "CAPA Rejected" email per CAPA, to the FRP, with every field from the brief
    await processDue();
    const rejections = mail.sent.filter((m) => m.subject.startsWith('CAPA Rejected'));
    expect(rejections.map((m) => m.subject)).toEqual([
      `CAPA Rejected – Action Required – ${complaint.complaintNumber}-CAPA-01`,
      `CAPA Rejected – Action Required – ${complaint.complaintNumber}-CAPA-02`,
    ]);
    const r1 = rejections[0];
    expect(r1.to).toBe('ravi@example.test');
    for (const line of [
      `- CAPA Number: ${complaint.complaintNumber}-CAPA-01`,
      `- Complaint Number: ${complaint.complaintNumber}`,
      '- Rejected By: Meera Rao',
      '- Rejected At Stage: D3 – RCA & CAPA',
      '- Root Cause Category: Machine',
      '- Root Cause Description: Sensor not recalibrated after maintenance',
      '- CAPA Category: Calibration',
      '- Current Review Status: Reviewed',
      '- Current Approval Status: Rejected',
      '- Rejection Remarks: Attach the sensor calibration certificate and add a preventive action for the checklist.',
      `View Complaint Record: http://localhost:5173/complaints/${complaint._id}`,
    ]) expect(r1.text).toContain(line);
    expect(r1.text).toContain('rejected and requires correction and resubmission');

    // Rework: the FRP can edit again
    res = await agent.get(`${base}/d3`);
    expect(res.body.data.canEdit).toBe(true);
    const capa = res.body.data.rootCauses[0].capas[0];
    await agent.patch(`${base}/d3/capa/${capa._id}`).send({ version: capa.__v, preventiveAction: 'Add recalibration to the maintenance checklist' }).expect(200);

    // Resubmit
    res = await agent.post(`${base}/d3/submit`).send({ reviewerId: String(reviewer._id) });
    expect(res.body.data.review.version).toBe(2);
    expect(await CapaRecord.countDocuments({ approvalStatus: 'PENDING' })).toBe(2);
    await processDue();
    expect(mail.sent.some((m) => m.subject === `D3 Approval Requested – ${complaint.complaintNumber} (resubmission 2)`)).toBe(true);

    // Approve
    res = await reviewerAgent.post(`${base}/d3/approve`).send({ remarks: 'Evidence is adequate.' });
    expect(res.body.data.complaint.status).toBe('D3_APPROVED');
    expect(res.body.data.review.analysisStatus).toBe('APPROVED');
    expect(await CapaRecord.countDocuments({ reviewStatus: 'REVIEWED', approvalStatus: 'APPROVED' })).toBe(2);
    expect((await reviewerAgent.post(`${base}/d3/approve`).send({})).status).toBe(409);

    // History: both versions and both decisions, with the rejected version preserved as submitted
    const history = (await agent.get(`${base}/d3/reviews`)).body.data;
    expect(history.map((h) => [h.kind, h.version])).toEqual([
      ['APPROVAL', 2], ['SUBMISSION', 2], ['REJECTION', 1], ['SUBMISSION', 1],
    ]);
    const v1 = history.find((h) => h.kind === 'SUBMISSION' && h.version === 1);
    expect(v1.snapshot.rootCauses[0].capas[0].preventiveAction).toBeUndefined(); // as it was when rejected
    const v2 = history.find((h) => h.kind === 'SUBMISSION' && h.version === 2);
    expect(v2.snapshot.rootCauses[0].capas[0].preventiveAction).toBe('Add recalibration to the maintenance checklist');
    expect(history.find((h) => h.kind === 'REJECTION').remarks).toMatch(/calibration certificate/);
    expect(String(frp._id)).toBeTruthy();
  });
});

describe('who may decide', () => {
  it('only the assigned reviewer, or an administrator; never the submitter or a coordinator', async () => {
    const { agent, base, reviewer } = await readyToSubmit();
    await agent.post(`${base}/d3/submit`).send({ reviewerId: String(reviewer._id) }).expect(200);

    const otherReviewer = await signIn(await makeUser({ roles: ['reviewer'] }));
    const r = await otherReviewer.post(`${base}/d3/approve`).send({});
    expect(r.status).toBe(403);
    expect(r.body.error.message).toMatch(/submitted to/);
    expect((await (await signIn(await makeUser({ roles: ['quality_coordinator'] }))).post(`${base}/d3/approve`).send({})).status).toBe(403);
    expect((await agent.post(`${base}/d3/approve`).send({})).status).toBe(403);

    const detail = await (await signIn(reviewer)).get(base);
    expect(detail.body.data.can.reviewD3).toBe(true);
    const admin = await signIn(await makeUser({ roles: ['admin'] }));
    expect((await admin.post(`${base}/d3/approve`).send({ remarks: 'Approved while reviewer on leave.' })).status).toBe(200);
  });

  it('an administrator acting as FRP still cannot approve their own submission', async () => {
    const qc = await makeUser({ roles: ['quality_coordinator'] });
    const admin = await makeUser({ roles: ['admin'] });
    const reviewer = await makeUser({ roles: ['reviewer'] });
    const complaint = await makeComplaint(qc);
    await Complaint.updateOne({ _id: complaint._id }, { status: 'D3_PENDING_APPROVAL', stage: 'D3', frp: admin._id });
    await RootCauseAnalysis.create({ complaint: complaint._id, status: 'PENDING_APPROVAL', lastSubmittedBy: admin._id, submissionCount: 1 });
    await models.ComplaintAssignment.create({ complaint: complaint._id, role: 'REVIEWER', assignee: reviewer._id, assignedBy: admin._id });
    const res = await (await signIn(admin)).post(`/api/complaints/${complaint._id}/d3/approve`).send({});
    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/someone else must review/);
  });
});

describe('repeat protection', () => {
  it('a retried submission with the same key is harmless; a second plain submit is refused', async () => {
    const { agent, base, reviewer } = await readyToSubmit();
    const body = { reviewerId: String(reviewer._id), idempotencyKey: 'submit-7c1e2b' };
    await agent.post(`${base}/d3/submit`).send(body).expect(200);
    await agent.post(`${base}/d3/submit`).send(body).expect(200);
    expect(await ComplaintStageRecord.countDocuments({ kind: 'SUBMISSION' })).toBe(1);
    expect(await Notification.countDocuments({ type: 'D3_APPROVAL_REQUEST' })).toBe(1);
    expect((await agent.post(`${base}/d3/submit`).send({ reviewerId: String(reviewer._id) })).status).toBe(409);
  });
});
