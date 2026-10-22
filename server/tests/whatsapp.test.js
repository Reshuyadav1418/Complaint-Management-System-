import crypto from 'node:crypto';
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { useDatabase, app, makeUser, signIn, models } from './helpers.js';
import { setWhatsapp, mockAdapter } from '../src/whatsapp/adapters.js';
import { setMailer, memoryMailer } from '../src/mail/mailer.js';
import { processDue } from '../src/services/notificationService.js';

useDatabase();

const { Complaint, ComplaintAttachment, Notification, WhatsappMessage, WhatsappSession } = models;
const WA = '919812345678';
let wa;
let seq = 0;
beforeEach(() => {
  wa = mockAdapter();
  setWhatsapp(wa);
  setMailer(memoryMailer());
});

const sign = (raw) => `sha256=${crypto.createHmac('sha256', 'test-app-secret').update(raw).digest('hex')}`;

function payload(message, from = WA) {
  return {
    object: 'whatsapp_business_account',
    entry: [{ id: 'x', changes: [{ field: 'messages', value: { contacts: [{ wa_id: from, profile: { name: 'Sunil' } }], messages: [{ from, id: message.id || `wamid.t${(seq += 1)}`, ...message }] } }] }],
  };
}

async function post(body, { signature } = {}) {
  const raw = JSON.stringify(body);
  return request(app).post('/api/webhooks/whatsapp').set('Content-Type', 'application/json').set('X-Hub-Signature-256', signature ?? sign(raw)).send(raw);
}
const text = (t, from) => post(payload({ type: 'text', text: { body: t } }, from));
const tap = (id, title, from) => post(payload({ type: 'interactive', interactive: { type: 'button_reply', button_reply: { id, title } } }, from));
const last = (from = WA) => wa.messagesFor(from).at(-1);

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

/** Walk the whole conversation up to the confirmation summary. */
async function converse(from = WA) {
  await text('Hi', from);
  await text('Sunil Verma', from);
  await text('sunil@example.test', from);
  await tap('type:Retailer', 'Retailer', from);
  await tap('sbu:0', 'AHP-Rumicare', from);
  await text('India', from);
  await text('Sunil Traders', from);
  await text('Rumicare Bolus', from);
  await text('RB2409', from);
  await tap('cat:0', 'Packaging', from);
  await text('Three bottles arrived with broken seals.', from);
}

describe('webhook security', () => {
  it('answers Meta’s verification handshake only with the right token', async () => {
    const good = await request(app).get('/api/webhooks/whatsapp').query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'verify-token-123', 'hub.challenge': '4242' });
    expect(good.status).toBe(200);
    expect(good.text).toBe('4242');
    const bad = await request(app).get('/api/webhooks/whatsapp').query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'guess', 'hub.challenge': '4242' });
    expect(bad.status).toBe(403);
  });

  it('rejects unsigned or tampered payloads and stores nothing', async () => {
    expect((await post(payload({ type: 'text', text: { body: 'Hi' } }), { signature: 'sha256=00' })).status).toBe(401);
    expect((await post(payload({ type: 'text', text: { body: 'Hi' } }), { signature: '' })).status).toBe(401);
    expect(await WhatsappMessage.countDocuments()).toBe(0);
  });

  it('processes a redelivered message only once', async () => {
    const body = payload({ id: 'wamid.same', type: 'text', text: { body: 'Hi' } });
    await post(body);
    await post(body);
    expect(await WhatsappMessage.countDocuments({ direction: 'inbound' })).toBe(1);
    expect(wa.messagesFor(WA)).toHaveLength(1); // the greeting was sent once
  });
});

describe('registering a complaint on WhatsApp', () => {
  it('collects every field, keeps photos, creates the complaint and replies with its number', async () => {
    await converse();
    expect(last().text).toMatch(/send up to 5 photos/);

    const mediaId = wa.putMedia(PNG, 'image/png', 'seal.png');
    await post(payload({ type: 'image', image: { id: mediaId, mime_type: 'image/png', caption: 'Seal of bottle 1' } }));
    expect(last().text).toBe('Received (1 of 5). Send more, or press *Done*.');
    await tap('done', 'Done');
    expect(last().kind).toBe('buttons');
    expect(last().text).toContain('*Batch:* RB2409');
    expect(last().options.map((o) => o.title)).toEqual(['Submit', 'Start over']);

    await tap('confirm:submit', 'Submit');
    const c = await Complaint.findOne({}).lean();
    expect(c).toMatchObject({
      origin: 'WhatsApp',
      status: 'D1_ACK_PENDING',
      requester: { name: 'Sunil Verma', email: 'sunil@example.test', mobile: `+${WA}`, type: 'Retailer' },
      sbu: 'AHP-Rumicare',
      country: 'India',
      category: 'Packaging',
      shortDescription: 'Three bottles arrived with broken seals.',
      additionalRemarks: 'Seal of bottle 1',
      customer: { name: 'Sunil Traders' },
      reportedProduct: { name: 'Rumicare Bolus', batchNumber: 'RB2409' },
    });
    expect(c.createdBy).toBeUndefined();
    const file = await ComplaintAttachment.findOne({ complaint: c._id }).lean();
    expect(file).toMatchObject({ source: 'whatsapp', stage: 'SYNCED', mimeType: 'image/png' });
    expect(await WhatsappSession.countDocuments()).toBe(0);

    // The number goes out through the notification queue, with retries.
    await processDue();
    expect(last().text).toContain(`Complaint number: *${c.complaintNumber}*`);
    const n = await Notification.findOne({ type: 'WHATSAPP_COMPLAINT_REGISTERED' }).lean();
    expect(n).toMatchObject({ channel: 'whatsapp', recipient: WA, status: 'SENT' });

    // Meta's delivery receipt marks it delivered.
    await post({ object: 'whatsapp_business_account', entry: [{ changes: [{ value: { statuses: [{ id: n.providerMessageId, status: 'delivered' }] } }] }] });
    expect((await Notification.findById(n._id).lean()).status).toBe('DELIVERED');
  });

  it('validates answers and asks again with a helpful message', async () => {
    await text('Hi');
    await text('Sunil Verma');
    await text('sunil at example');
    expect(wa.messagesFor(WA).at(-2).text).toMatch(/does not look like an email/);
    expect(last().text).toMatch(/email address/);
    await text('sunil@example.test');
    await text('a florist');
    expect(wa.messagesFor(WA).at(-2).text).toBe('Please choose one of the buttons.');
    await text('2'); // typed number picks the 2nd option
    expect(last().kind).toBe('list');
    expect((await WhatsappSession.findOne({}).lean()).answers.reporterType).toBe('Retailer');
  });

  it('“Hi” restarts at any point and “cancel” stops', async () => {
    await text('Hi');
    await text('Sunil Verma');
    await text('Hello');
    expect(last().text).toMatch(/What is your full name\?/);
    expect((await WhatsappSession.findOne({}).lean()).answers.name).toBeUndefined();
    await text('cancel');
    expect(last().text).toMatch(/not submitted/);
    expect(await WhatsappSession.countDocuments()).toBe(0);
  });

  it('a double-tapped Submit creates one complaint', async () => {
    await converse();
    await tap('done', 'Done');
    await Promise.all([tap('confirm:submit', 'Submit'), tap('confirm:submit', 'Submit')]);
    expect(await Complaint.countDocuments()).toBe(1);
  });

  it('if WhatsApp replies fail, the conversation and complaint are unaffected, and the number is retried', async () => {
    await converse();
    wa.failNext(1); // the summary reply fails to send...
    await tap('done', 'Done');
    const failed = await WhatsappMessage.findOne({ direction: 'outbound', 'processing.status': 'FAILED' }).lean();
    expect(failed.processing.error).toBe('Simulated WhatsApp API failure');
    expect((await WhatsappSession.findOne({}).lean()).step).toBe('CONFIRM'); // ...but the state moved on
    await tap('confirm:submit', 'Submit');
    expect(await Complaint.countDocuments()).toBe(1);
    wa.failNext(1); // first attempt to send the complaint number fails
    await processDue();
    const n = await Notification.findOne({ type: 'WHATSAPP_COMPLAINT_REGISTERED' }).lean();
    expect(n).toMatchObject({ status: 'QUEUED', attempts: 1, lastError: 'Simulated WhatsApp API failure' });
    await Notification.updateOne({ _id: n._id }, { nextAttemptAt: new Date() });
    await processDue();
    expect((await Notification.findById(n._id).lean()).status).toBe('SENT');
  });

  it('acknowledging a WhatsApp complaint also sends a WhatsApp status update', async () => {
    await converse();
    await tap('done', 'Done');
    await tap('confirm:submit', 'Submit');
    const c = await Complaint.findOne({}).lean();
    const qc = await signIn(await makeUser({ roles: ['quality_coordinator'] }));
    await qc.post(`/api/complaints/${c._id}/acknowledge`).send({}).expect(200);
    await processDue();
    expect(last().text).toBe(`Update on complaint *${c.complaintNumber}*: our team has acknowledged it and started reviewing it. We have sent the details to sunil@example.test.`);
  });

  it('two senders have separate conversations', async () => {
    await text('Hi', '919800000001');
    await text('Hi', '919800000002');
    await text('Asha', '919800000001');
    expect(last('919800000001').text).toMatch(/Thank you, Asha/);
    expect(last('919800000002').text).toMatch(/full name/);
  });
});

describe('simulator', () => {
  it('drives the same webhook code and shows the conversation; needs permission', async () => {
    const qc = await signIn(await makeUser({ roles: ['quality_coordinator'] }));
    await qc.post('/api/dev/whatsapp/messages').send({ waId: WA, text: 'Hi' }).expect(200);
    await qc.post('/api/dev/whatsapp/messages').send({ waId: WA, text: 'Sunil' }).expect(200);
    const convo = (await qc.get(`/api/dev/whatsapp/messages?waId=${WA}`)).body.data;
    expect(convo.map((m) => [m.direction, m.text?.split('\n')[0]])).toEqual([
      ['inbound', 'Hi'],
      ['outbound', 'Welcome. I will help you register a product complaint. It takes about two minutes.'],
      ['inbound', 'Sunil'],
      ['outbound', 'Thank you, Sunil. What is your email address? We will send the acknowledgement there.'],
    ]);
    const frp = await signIn(await makeUser({ roles: ['frp'] }));
    expect((await frp.post('/api/dev/whatsapp/messages').send({ waId: WA, text: 'Hi' })).status).toBe(403);
  });
});
