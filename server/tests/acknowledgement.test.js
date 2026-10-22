import { describe, it, expect, beforeEach } from 'vitest';
import { useDatabase, makeUser, signIn, makeComplaint, models } from './helpers.js';
import { setMailer, memoryMailer } from '../src/mail/mailer.js';
import { processDue } from '../src/services/notificationService.js';

useDatabase();

const { Complaint, Notification, ComplaintStageRecord, AuditLog } = models;
let mail;
beforeEach(() => {
  mail = memoryMailer();
  setMailer(mail);
});

async function setup(overrides) {
  const qc = await makeUser({ roles: ['quality_coordinator'], name: 'Priya QC' });
  const complaint = await makeComplaint(qc, overrides);
  return { qc, complaint, agent: await signIn(qc) };
}

const EXPECTED_TEXT = (n) => `Dear Sir/Madam,

Thank you for bringing this matter to our attention.

We have received your complaint ${n}, and our team is reviewing it.

We will update you on the progress shortly.

Best Regards,
Customer Relationship Management Team

Note: This is an automatically generated email. Please do not reply to this email.`;

describe('D1 acknowledgement', () => {
  it('records the approval, snapshots D1, queues exactly the email in the brief, and sends it', async () => {
    const { qc, complaint, agent } = await setup();
    const res = await agent.post(`/api/complaints/${complaint._id}/acknowledge`).send({ remarks: 'Details verified by phone.' });

    expect(res.status).toBe(200);
    const c = res.body.data.complaint;
    expect(c.status).toBe('D1_ACKNOWLEDGED');
    expect(c.acknowledgement).toMatchObject({ remarks: 'Details verified by phone.', approvedBy: { name: 'Priya QC' } });

    const record = await ComplaintStageRecord.findOne({ complaint: complaint._id, kind: 'ACKNOWLEDGEMENT' }).lean();
    expect(String(record.actor)).toBe(String(qc._id));
    expect(record.snapshot.shortDescription).toBe(complaint.shortDescription);

    const queued = await Notification.findOne({ complaint: complaint._id }).select('+bodyHtml').lean();
    expect(queued).toMatchObject({
      type: 'D1_ACKNOWLEDGEMENT',
      status: 'QUEUED',
      recipient: 'sunil@example.test',
      subject: `Complaint Acknowledgement for D1 Stage – ${complaint.complaintNumber}`,
    });
    expect(queued.bodyText).toBe(EXPECTED_TEXT(complaint.complaintNumber));
    expect(mail.sent).toHaveLength(0); // nothing leaves until the worker runs

    expect(await processDue()).toEqual({ sent: 1, retry: 0, failed: 0 });
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]).toMatchObject({ to: 'sunil@example.test', subject: queued.subject, text: queued.bodyText });
    expect(mail.sent[0].html).toContain(`<strong>${complaint.complaintNumber}</strong>`);

    const sent = await Notification.findById(queued._id).lean();
    expect(sent).toMatchObject({ status: 'SENT', attempts: 1, providerMessageId: '<test-1@sfa-cms.test>' });

    const actions = (await AuditLog.find({ complaint: complaint._id }).sort({ at: 1 }).lean()).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['complaint.status.acknowledge', 'complaint.d1.acknowledge', 'notification.sent']));
  });

  it('a second click is refused and no second email is ever queued', async () => {
    const { complaint, agent } = await setup();
    await agent.post(`/api/complaints/${complaint._id}/acknowledge`).send({}).expect(200);
    const again = await agent.post(`/api/complaints/${complaint._id}/acknowledge`).send({});
    expect(again.status).toBe(409);
    await processDue();
    expect(mail.sent).toHaveLength(1);
    expect(await Notification.countDocuments({ complaint: complaint._id })).toBe(1);
  });

  it('a retried request with the same idempotency key succeeds without repeating anything', async () => {
    const { complaint, agent } = await setup();
    const body = { idempotencyKey: 'ack-7f3c2a91' };
    const first = await agent.post(`/api/complaints/${complaint._id}/acknowledge`).send(body);
    const retry = await agent.post(`/api/complaints/${complaint._id}/acknowledge`).send(body);
    expect(first.status).toBe(200);
    expect(retry.status).toBe(200);
    expect(retry.body.data.complaint.status).toBe('D1_ACKNOWLEDGED');
    expect(await Notification.countDocuments({ complaint: complaint._id })).toBe(1);
    expect(await ComplaintStageRecord.countDocuments({ complaint: complaint._id })).toBe(1);
  });

  it('two coordinators clicking at the same moment produce one acknowledgement and one email', async () => {
    const { complaint, agent } = await setup();
    const other = await signIn(await makeUser({ roles: ['quality_coordinator'] }));
    const results = await Promise.all([
      agent.post(`/api/complaints/${complaint._id}/acknowledge`).send({}),
      other.post(`/api/complaints/${complaint._id}/acknowledge`).send({}),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await Notification.countDocuments({ complaint: complaint._id })).toBe(1);
  });

  it('opening or refreshing the complaint never sends anything', async () => {
    const { complaint, agent } = await setup();
    await agent.post(`/api/complaints/${complaint._id}/acknowledge`).send({}).expect(200);
    for (let i = 0; i < 3; i += 1) await agent.get(`/api/complaints/${complaint._id}`).expect(200);
    await processDue();
    await processDue();
    expect(mail.sent).toHaveLength(1);
  });

  it('is blocked without a requester email, and nothing is written', async () => {
    const { complaint, agent } = await setup({ requester: { name: 'Walk-in farmer' } });
    const res = await agent.post(`/api/complaints/${complaint._id}/acknowledge`).send({});
    expect(res.status).toBe(422);
    expect(res.body.error.details[0].message).toMatch(/email/);
    expect((await Complaint.findById(complaint._id)).status).toBe('D1_ACK_PENDING');
    expect(await Notification.countDocuments()).toBe(0);
  });

  it('is refused for roles without the permission, and for complaints the user cannot see', async () => {
    const { complaint } = await setup();
    const frpUser = await makeUser({ roles: ['frp'] });
    await Complaint.updateOne({ _id: complaint._id }, { frp: frpUser._id });
    expect((await (await signIn(frpUser)).post(`/api/complaints/${complaint._id}/acknowledge`).send({})).status).toBe(403);
    expect(await Notification.countDocuments()).toBe(0);
  });

  it('locks D1 editing afterwards', async () => {
    const { complaint, agent } = await setup();
    const res = await agent.post(`/api/complaints/${complaint._id}/acknowledge`).send({});
    const edit = await agent.patch(`/api/complaints/${complaint._id}/d1`).send({ version: res.body.data.complaint.__v, category: 'x' });
    expect(edit.status).toBe(409);
    expect(res.body.data.can.editD1).toBe(false);
  });

  it('preview shows the recipient and the exact message, and changes nothing', async () => {
    const { complaint, agent } = await setup();
    const res = await agent.get(`/api/complaints/${complaint._id}/acknowledgement-preview`);
    expect(res.body.data).toEqual({
      to: 'sunil@example.test',
      subject: `Complaint Acknowledgement for D1 Stage – ${complaint.complaintNumber}`,
      text: EXPECTED_TEXT(complaint.complaintNumber),
    });
    expect((await Complaint.findById(complaint._id)).status).toBe('D1_ACK_PENDING');
  });

  it('the complaint shows its own email log to anyone who can see it', async () => {
    const { complaint, agent } = await setup();
    await agent.post(`/api/complaints/${complaint._id}/acknowledge`).send({});
    await processDue();
    const res = await agent.get(`/api/complaints/${complaint._id}/notifications`);
    expect(res.body.data).toEqual([expect.objectContaining({ type: 'D1_ACKNOWLEDGEMENT', status: 'SENT', attempts: 1 })]);
    expect(res.body.data[0].bodyHtml).toBeUndefined();
  });
});
