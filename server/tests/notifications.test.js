import { describe, it, expect, beforeEach } from 'vitest';
import { useDatabase, makeUser, signIn, makeComplaint, models } from './helpers.js';
import { setMailer, memoryMailer } from '../src/mail/mailer.js';
import { enqueue, processDue, backoff } from '../src/services/notificationService.js';
import { escapeHtml } from '../src/mail/templates.js';

useDatabase();

const { Notification, AuditLog } = models;
let mail;
beforeEach(() => {
  mail = memoryMailer();
  setMailer(mail);
});

const msg = { subject: 'Test', text: 'Hello', html: '<p>Hello</p>' };
const makeDue = (id) => Notification.updateOne({ _id: id }, { nextAttemptAt: new Date(Date.now() - 1000) });

describe('notification queue', () => {
  it('the same business event queues only one message', async () => {
    const a = await enqueue({ type: 'D1_ACKNOWLEDGEMENT', recipient: 'a@example.test', dedupeKey: 'D1_ACK:x', message: msg });
    const b = await enqueue({ type: 'D1_ACKNOWLEDGEMENT', recipient: 'a@example.test', dedupeKey: 'D1_ACK:x', message: msg });
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(String(b.notification._id)).toBe(String(a.notification._id));
    expect(await Notification.countDocuments()).toBe(1);
  });

  it('a failed send is retried later with increasing delays, not immediately', async () => {
    const { notification } = await enqueue({ type: 'D1_ACKNOWLEDGEMENT', recipient: 'a@example.test', dedupeKey: 'k1', message: msg });
    mail.failNext(1, 'Connection timed out');

    expect(await processDue()).toEqual({ sent: 0, retry: 1, failed: 0 });
    let n = await Notification.findById(notification._id).lean();
    expect(n).toMatchObject({ status: 'QUEUED', attempts: 1, lastError: 'Connection timed out' });
    expect(n.nextAttemptAt.getTime()).toBeGreaterThan(Date.now() + 50_000);

    expect(await processDue()).toEqual({ sent: 0, retry: 0, failed: 0 }); // not due yet
    await makeDue(notification._id);
    expect(await processDue()).toEqual({ sent: 1, retry: 0, failed: 0 });
    n = await Notification.findById(notification._id).lean();
    expect(n).toMatchObject({ status: 'SENT', attempts: 2, lastError: null });
    expect(mail.sent).toHaveLength(1);
    expect(backoff(1)).toBeLessThan(backoff(2));
  });

  it('gives up after the maximum attempts, records why, and an authorised user can retry it', async () => {
    const complaint = await makeComplaint(await makeUser({ roles: ['quality_coordinator'] }));
    const { notification } = await enqueue({ type: 'D1_ACKNOWLEDGEMENT', complaint: complaint._id, recipient: 'a@example.test', dedupeKey: 'k2', message: msg });
    mail.failNext(99, '550 Mailbox unavailable');
    for (let i = 0; i < 5; i += 1) {
      await makeDue(notification._id);
      await processDue();
    }
    let n = await Notification.findById(notification._id).lean();
    expect(n).toMatchObject({ status: 'FAILED', attempts: 5, lastError: '550 Mailbox unavailable' });
    const failedLog = await AuditLog.findOne({ action: 'notification.failed', complaint: complaint._id }).lean();
    expect(failedLog.summary).toMatch(/after 5 attempts/);

    await makeDue(notification._id);
    expect(await processDue()).toEqual({ sent: 0, retry: 0, failed: 0 }); // FAILED is never picked up automatically

    const qc = await signIn(await makeUser({ roles: ['quality_coordinator'] }));
    expect((await qc.post(`/api/notifications/${notification._id}/retry`)).status).toBe(403);

    const admin = await signIn(await makeUser({ roles: ['admin'] }));
    const retried = await admin.post(`/api/notifications/${notification._id}/retry`);
    expect(retried.status).toBe(200);
    expect(retried.body.data).toMatchObject({ status: 'QUEUED', attempts: 0 });

    mail.failNext(0);
    await processDue();
    n = await Notification.findById(notification._id).lean();
    expect(n.status).toBe('SENT');
    expect((await admin.post(`/api/notifications/${notification._id}/retry`)).status).toBe(409); // never resend a sent email
  });

  it('parallel workers never send the same message twice', async () => {
    for (let i = 0; i < 10; i += 1) {
      await enqueue({ type: 'D1_ACKNOWLEDGEMENT', recipient: `r${i}@example.test`, dedupeKey: `p${i}`, message: msg });
    }
    const results = await Promise.all([processDue(), processDue(), processDue()]);
    expect(results.reduce((n, r) => n + r.sent, 0)).toBe(10);
    expect(mail.sent).toHaveLength(10);
    expect(new Set(mail.sent.map((m) => m.to)).size).toBe(10);
  });

  it('a message whose sender crashed mid-send is picked up again after the lock expires', async () => {
    const { notification } = await enqueue({ type: 'D1_ACKNOWLEDGEMENT', recipient: 'a@example.test', dedupeKey: 'k3', message: msg });
    await Notification.updateOne({ _id: notification._id }, { lockedUntil: new Date(Date.now() + 60_000), attempts: 1 });
    expect((await processDue()).sent).toBe(0);
    await Notification.updateOne({ _id: notification._id }, { lockedUntil: new Date(Date.now() - 1) });
    expect((await processDue()).sent).toBe(1);
  });
});

describe('notification log API', () => {
  it('lists with filters for users who may view it, and hides it from others', async () => {
    const complaint = await makeComplaint(await makeUser({ roles: ['quality_coordinator'] }));
    await enqueue({ type: 'D1_ACKNOWLEDGEMENT', complaint: complaint._id, recipient: 'one@example.test', dedupeKey: 'l1', message: msg });
    await enqueue({ type: 'D1_ACKNOWLEDGEMENT', recipient: 'two@example.test', dedupeKey: 'l2', message: msg });
    mail.failNext(0);
    await processDue({ limit: 1 });

    const admin = await signIn(await makeUser({ roles: ['admin'] }));
    const all = await admin.get('/api/notifications');
    expect(all.body.meta.total).toBe(2);
    expect(all.body.data[0].dedupeKey).toBeUndefined();
    expect((await admin.get('/api/notifications?status=SENT')).body.meta.total).toBe(1);
    const byNumber = await admin.get(`/api/notifications?search=${complaint.complaintNumber}`);
    expect(byNumber.body.data.map((n) => n.recipient)).toEqual(['one@example.test']);

    const one = await admin.get(`/api/notifications/${all.body.data[0]._id}`);
    expect(one.body.data.bodyHtml).toBe('<p>Hello</p>');

    const frp = await signIn(await makeUser({ roles: ['frp'] }));
    expect((await frp.get('/api/notifications')).status).toBe(403);
  });
});

describe('email safety', () => {
  it('escapes markup from complaint data', () => {
    expect(escapeHtml('<img src=x onerror=alert(1)> & "q"')).toBe('&lt;img src=x onerror=alert(1)&gt; &amp; &quot;q&quot;');
  });
});
