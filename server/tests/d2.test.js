import { describe, it, expect, beforeEach } from 'vitest';
import { useDatabase, makeUser, signIn, makeComplaint, models } from './helpers.js';
import { setMailer, memoryMailer } from '../src/mail/mailer.js';
import { processDue } from '../src/services/notificationService.js';

useDatabase();

const { Complaint, ComplaintAssignment, Notification, LookupValue, AuditLog, ComplaintStageRecord } = models;
let mail;
beforeEach(async () => {
  mail = memoryMailer();
  setMailer(mail);
  await LookupValue.insertMany([
    { list: 'manufacturingLocation', value: 'Plant 1' },
    { list: 'manufacturingLocation', value: 'Plant 2' },
    { list: 'locationDetail', parent: 'Plant 1', value: 'Packing line' },
    { list: 'locationDetail', parent: 'Plant 2', value: 'Filling line' },
    { list: 'typeOfFailure', value: 'Packaging defect' },
    { list: 'typeOfFailure', value: 'Old failure type', active: false },
  ]);
});

/** A complaint already acknowledged and in D2, with a QC and an FRP. */
async function inD2() {
  const qc = await makeUser({ roles: ['quality_coordinator'], name: 'Priya QC', email: 'priya@example.test' });
  const frp = await makeUser({ roles: ['frp'], name: 'Ravi Kumar', email: 'ravi@example.test' });
  const complaint = await makeComplaint(qc);
  const agent = await signIn(qc);
  await agent.post(`/api/complaints/${complaint._id}/acknowledge`).send({}).expect(200);
  const started = await agent.post(`/api/complaints/${complaint._id}/start-d2`).send({});
  expect(started.status).toBe(200);
  return { qc, frp, complaint, agent, version: started.body.data.complaint.__v };
}

const fullD2 = {
  priority: 'High',
  verifiedProduct: { performanceRelated: false, productName: 'Rumicare Bolus', batchNumber: 'RB2409', sku: 'RB-10', invoiceQuantity: 120, remarks: '' },
  investigation: {
    occurrences: { value: 'First occurrence', score: 2 },
    affectedQuantity: { value: '3 bottles', score: 1 },
    severity: { value: 'Minor', score: 3 },
    rpn: 6,
    manufacturingLocation: 'Plant 1',
    locationDetail: 'Packing line',
    repeatComplaint: false,
    typeOfFailure: 'Packaging defect',
    slaHoursD3: 72,
    slaHoursD4: 120,
  },
};

describe('starting D2', () => {
  it('needs acknowledgement first and the D2 permission', async () => {
    const qc = await makeUser({ roles: ['quality_coordinator'] });
    const c = await makeComplaint(qc);
    const agent = await signIn(qc);
    expect((await agent.post(`/api/complaints/${c._id}/start-d2`).send({})).status).toBe(409);
    await agent.post(`/api/complaints/${c._id}/acknowledge`).send({}).expect(200);
    const reviewer = await signIn(await makeUser({ roles: ['reviewer'] }));
    expect((await reviewer.post(`/api/complaints/${c._id}/start-d2`).send({})).status).toBe(403);
    const res = await agent.post(`/api/complaints/${c._id}/start-d2`).send({});
    expect(res.body.data.complaint).toMatchObject({ status: 'D2_IN_PROGRESS', stage: 'D2' });
    expect(res.body.data.can).toMatchObject({ editD2: true, assignFrp: true });
  });
});

describe('saving D2 information', () => {
  it('saves all fields and audits only what changed', async () => {
    const { complaint, agent, version } = await inD2();
    const res = await agent.patch(`/api/complaints/${complaint._id}/d2`).send({ version, ...fullD2 });
    expect(res.status).toBe(200);
    expect(res.body.data.complaint.d2.investigation).toMatchObject({ rpn: 6, manufacturingLocation: 'Plant 1', severity: { value: 'Minor', score: 3 } });
    expect(res.body.data.complaint.priority).toBe('High');

    const v2 = res.body.data.complaint.__v;
    await agent
      .patch(`/api/complaints/${complaint._id}/d2`)
      .send({ version: v2, ...fullD2, investigation: { ...fullD2.investigation, rpn: 8 } })
      .expect(200);
    const logs = await AuditLog.find({ complaint: complaint._id, action: 'complaint.d2.update' }).sort({ at: 1 }).lean();
    expect(logs[1].after).toEqual({ 'investigation.rpn': 8 });
    expect(logs[1].before).toEqual({ 'investigation.rpn': 6 });
  });

  it('accepts only values from the admin lists, with location detail tied to its location', async () => {
    const { complaint, agent, version } = await inD2();
    const send = (investigation) => agent.patch(`/api/complaints/${complaint._id}/d2`).send({ version, investigation });

    const bad = await send({ manufacturingLocation: 'Plant 9', typeOfFailure: 'Made up' });
    expect(bad.status).toBe(422);
    expect(bad.body.error.details.map((d) => d.field)).toEqual(['investigation.manufacturingLocation', 'investigation.typeOfFailure']);

    const mismatched = await send({ manufacturingLocation: 'Plant 1', locationDetail: 'Filling line' });
    expect(mismatched.body.error.details[0].message).toMatch(/belongs to Plant 1/);

    expect((await send({ typeOfFailure: 'Old failure type' })).status).toBe(422); // deactivated
    expect((await send({ manufacturingLocation: 'plant 1', locationDetail: 'Packing line' })).status).toBe(200); // case-insensitive
  });

  it('rejects bad numbers with field messages', async () => {
    const { complaint, agent, version } = await inD2();
    const res = await agent.patch(`/api/complaints/${complaint._id}/d2`).send({
      version,
      verifiedProduct: { invoiceQuantity: -4 },
      investigation: { severity: { score: 'high' }, slaHoursD3: 'soon' },
    });
    expect(res.status).toBe(422);
    expect(res.body.error.details.map((d) => d.field).sort()).toEqual(['investigation.severity.score', 'investigation.slaHoursD3', 'verifiedProduct.invoiceQuantity']);
  });

  it('refuses stale saves, roles without D2 permission, and edits after completion', async () => {
    const { complaint, agent, version, frp } = await inD2();
    await agent.patch(`/api/complaints/${complaint._id}/d2`).send({ version, priority: 'Low' }).expect(200);
    expect((await agent.patch(`/api/complaints/${complaint._id}/d2`).send({ version, priority: 'High' })).status).toBe(409);

    await Complaint.updateOne({ _id: complaint._id }, { frp: frp._id });
    const frpAgent = await signIn(frp);
    expect((await frpAgent.patch(`/api/complaints/${complaint._id}/d2`).send({ version: 99, priority: 'Low' })).status).toBe(403);
  });
});

describe('FRP assignment', () => {
  it('assigns, queues the brief’s email with link and urgency, and gives the FRP access', async () => {
    const { complaint, agent, version, frp } = await inD2();
    await agent.patch(`/api/complaints/${complaint._id}/d2`).send({ version, ...fullD2 }).expect(200);

    const frpAgent = await signIn(frp);
    expect((await frpAgent.get(`/api/complaints/${complaint._id}`)).status).toBe(404);

    const res = await agent.post(`/api/complaints/${complaint._id}/frp`).send({ assigneeId: String(frp._id) });
    expect(res.status).toBe(200);
    expect(res.body.data.complaint.frp.name).toBe('Ravi Kumar');
    expect((await frpAgent.get(`/api/complaints/${complaint._id}`)).status).toBe(200);

    await processDue();
    expect(mail.sent).toHaveLength(2); // acknowledgement + assignment
    const email = mail.sent.find((m) => m.to === 'ravi@example.test');
    expect(email.subject).toBe(`First Responsible Person Assigned – ${complaint.complaintNumber}`);
    expect(email.text).toContain('Dear Ravi Kumar,');
    expect(email.text).toContain('- Type of Failure: Packaging defect');
    expect(email.text).toContain('- Manufacturing Location: Plant 1');
    expect(email.text).toContain('- Batch Number: RB2409');
    expect(email.text).toContain(`View Complaint Record: http://localhost:5173/complaints/${complaint._id}`);
    expect(email.text).toContain('marked High priority');
  });

  it('no urgency line for normal priority', async () => {
    const { complaint, agent, frp } = await inD2();
    await agent.post(`/api/complaints/${complaint._id}/frp`).send({ assigneeId: String(frp._id) }).expect(200);
    await processDue();
    expect(mail.sent.find((m) => m.to === 'ravi@example.test').text).not.toContain('priority');
  });

  it('assigning the same person again changes nothing and sends nothing', async () => {
    const { complaint, agent, frp } = await inD2();
    await agent.post(`/api/complaints/${complaint._id}/frp`).send({ assigneeId: String(frp._id) }).expect(200);
    const again = await agent.post(`/api/complaints/${complaint._id}/frp`).send({ assigneeId: String(frp._id) });
    expect(again.body.data.unchanged).toBe(true);
    expect(await ComplaintAssignment.countDocuments({ complaint: complaint._id })).toBe(1);
    expect(await Notification.countDocuments({ type: 'D2_FRP_ASSIGNED' })).toBe(1);
  });

  it('reassignment needs a reason, keeps history, and moves access to the new FRP', async () => {
    const { complaint, agent, frp } = await inD2();
    const frp2 = await makeUser({ roles: ['frp'], name: 'Anita Singh', email: 'anita@example.test' });
    await agent.post(`/api/complaints/${complaint._id}/frp`).send({ assigneeId: String(frp._id) }).expect(200);

    const noReason = await agent.post(`/api/complaints/${complaint._id}/frp`).send({ assigneeId: String(frp2._id) });
    expect(noReason.status).toBe(422);
    expect(noReason.body.error.details[0].field).toBe('reason');

    await agent.post(`/api/complaints/${complaint._id}/frp`).send({ assigneeId: String(frp2._id), reason: 'Ravi is on leave.' }).expect(200);
    const history = (await agent.get(`/api/complaints/${complaint._id}/assignments`)).body.data;
    expect(history.map((a) => [a.assignee.name, a.active])).toEqual([['Anita Singh', true], ['Ravi Kumar', false]]);
    expect(history[0].reason).toBe('Ravi is on leave.');
    expect(history[1].endedBy.name).toBe('Priya QC');

    expect((await (await signIn(frp)).get(`/api/complaints/${complaint._id}`)).status).toBe(404);
    expect((await (await signIn(frp2)).get(`/api/complaints/${complaint._id}`)).status).toBe(200);
    const log = await AuditLog.findOne({ action: 'complaint.frp.reassign' }).lean();
    expect(log.summary).toBe('Reassigned the FRP from Ravi Kumar to Anita Singh');
  });

  it('only investigators who are active can be assigned, and only by users who may assign', async () => {
    const { complaint, agent } = await inD2();
    const employee = await makeUser({ roles: ['employee'] });
    const gone = await makeUser({ roles: ['frp'], isActive: false });
    for (const u of [employee, gone]) {
      const res = await agent.post(`/api/complaints/${complaint._id}/frp`).send({ assigneeId: String(u._id) });
      expect(res.status).toBe(422);
    }
    const reviewer = await signIn(await makeUser({ roles: ['reviewer'] }));
    expect((await reviewer.post(`/api/complaints/${complaint._id}/frp`).send({ assigneeId: String(employee._id) })).status).toBe(403);
  });

  it('two coordinators assigning different people at once: one wins, never two active FRPs', async () => {
    const { complaint, agent, frp } = await inD2();
    const frp2 = await makeUser({ roles: ['frp'] });
    const other = await signIn(await makeUser({ roles: ['quality_coordinator'] }));
    const results = await Promise.all([
      agent.post(`/api/complaints/${complaint._id}/frp`).send({ assigneeId: String(frp._id) }),
      other.post(`/api/complaints/${complaint._id}/frp`).send({ assigneeId: String(frp2._id) }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await ComplaintAssignment.countDocuments({ complaint: complaint._id, active: true })).toBe(1);
    expect(await Notification.countDocuments({ type: 'D2_FRP_ASSIGNED' })).toBe(1);
  });

  it('candidate list shows only active investigators with their open workload', async () => {
    const { complaint, agent, frp } = await inD2();
    await makeUser({ roles: ['employee'], name: 'Not An FRP' });
    await agent.post(`/api/complaints/${complaint._id}/frp`).send({ assigneeId: String(frp._id) }).expect(200);
    const res = await agent.get('/api/complaints/frp-candidates');
    expect(res.body.data.map((u) => [u.name, u.openComplaints])).toEqual([['Ravi Kumar', 1]]);
  });
});

describe('completing D2', () => {
  it('lists exactly what is missing, then completes and notifies the FRP', async () => {
    const { complaint, agent, version, frp } = await inD2();
    const early = await agent.post(`/api/complaints/${complaint._id}/complete-d2`).send({});
    expect(early.status).toBe(422);
    expect(early.body.error.details.map((d) => d.message)).toEqual([
      'Assign a First Responsible Person before completing D2.',
      'Complete the D2 fields before finishing D2: verified batch number, manufacturing location, type of failure, severity score.',
    ]);

    await agent.patch(`/api/complaints/${complaint._id}/d2`).send({ version, ...fullD2 }).expect(200);
    await agent.post(`/api/complaints/${complaint._id}/frp`).send({ assigneeId: String(frp._id) }).expect(200);
    const res = await agent.post(`/api/complaints/${complaint._id}/complete-d2`).send({ remarks: 'Ready for RCA.' });
    expect(res.status).toBe(200);
    expect(res.body.data.complaint).toMatchObject({ status: 'D2_COMPLETED', d2: { completedBy: { name: 'Priya QC' } } });
    expect(res.body.data.can.editD2).toBe(false);

    const record = await ComplaintStageRecord.findOne({ complaint: complaint._id, kind: 'COMPLETION' }).lean();
    expect(record.snapshot.d2.investigation.rpn).toBe(6);

    await processDue();
    const done = mail.sent.find((m) => m.subject.startsWith('D2 Completed'));
    expect(done.to).toBe('ravi@example.test');
    expect(done.subject).toBe(`D2 Completed – Process Mapping & Assignment – ${complaint.complaintNumber}`);
    expect(done.text).toContain('- First Responsible Person: Ravi Kumar');

    expect((await agent.post(`/api/complaints/${complaint._id}/complete-d2`).send({})).status).toBe(409);
    expect(await Notification.countDocuments({ type: 'D2_COMPLETED' })).toBe(1);
  });
});

describe('dropdown lists', () => {
  it('everyone reads active values; only settings managers edit; renaming a location keeps its details', async () => {
    const qc = await signIn(await makeUser({ roles: ['quality_coordinator'] }));
    const lists = (await qc.get('/api/lookups')).body.data.lists;
    expect(lists.typeOfFailure.map((v) => v.value)).toEqual(['Packaging defect']);
    expect((await qc.post('/api/lookups').send({ list: 'typeOfFailure', value: 'Leak' })).status).toBe(403);

    const admin = await signIn(await makeUser({ roles: ['admin'] }));
    expect((await admin.post('/api/lookups').send({ list: 'typeOfFailure', value: 'packaging DEFECT' })).status).toBe(422);
    expect((await admin.post('/api/lookups').send({ list: 'locationDetail', value: 'Orphan' })).status).toBe(422);
    const plant1 = lists.manufacturingLocation.find((v) => v.value === 'Plant 1');
    await admin.patch(`/api/lookups/${plant1._id}`).send({ value: 'Plant 1 North' }).expect(200);
    const detail = await LookupValue.findOne({ value: 'Packing line' }).lean();
    expect(detail.parent).toBe('Plant 1 North');
  });
});
