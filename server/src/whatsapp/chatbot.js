import { z } from 'zod';
import { WhatsappMessage, WhatsappSession, Notification } from '../models/index.js';
import env from '../config/env.js';
import logger from '../config/logger.js';
import { createComplaint } from '../services/complaintService.js';
import { storeSystemAttachments } from '../services/attachmentService.js';
import * as notifications from '../services/notificationService.js';
import * as audit from '../services/auditService.js';
import { whatsapp } from './adapters.js';

/*
 * WhatsApp complaint registration.
 *
 * One conversation per sender (WhatsappSession, expires after 24h idle).
 * Steps: NAME → EMAIL → REPORTER_TYPE → SBU → COUNTRY → CUSTOMER → PRODUCT
 *        → BATCH → CATEGORY → DESCRIPTION → DETAILS (photos/notes) → CONFIRM
 * "Hi" (or hello/start/restart/menu) starts over at any point; "cancel" stops.
 *
 * Isolation: chat replies are best-effort. If WhatsApp is down the reply is
 * logged as failed, but the conversation state and any complaint are saved.
 * The registration confirmation with the complaint number goes through the
 * notification queue, so it is retried until WhatsApp accepts it.
 */

const RESTART = /^(hi|hii+|hello|hey|start|restart|menu|namaste)\b/i;
const CANCEL = /^(cancel|stop|exit)$/i;
const SKIP = /^(skip|no|none|na|n\/a|-)$/i;
const DONE = /^(done|finish|finished|submit|ok)$/i;
const MAX_FILES = 5;
const REPORTER_TYPES = ['Customer', 'Retailer', 'Distributor'];
const emailSchema = z.email();

/* ---------------- Sending (logged, never throws) ---------------- */

async function reply(waId, kind, text, extra = {}) {
  const wa = whatsapp();
  let messageId;
  let error;
  try {
    if (kind === 'buttons') ({ messageId } = await wa.sendButtons(waId, text, extra.options));
    else if (kind === 'list') ({ messageId } = await wa.sendList(waId, text, extra.label, extra.options));
    else ({ messageId } = await wa.sendText(waId, text));
  } catch (err) {
    error = String(err.message || err);
    logger.warn({ waId, err: error }, 'WhatsApp reply failed');
  }
  await WhatsappMessage.create({
    waMessageId: messageId || `failed.${Date.now()}.${Math.random().toString(36).slice(2)}`,
    direction: 'outbound',
    waId,
    type: kind,
    body: { text, ...extra },
    processing: { status: error ? 'FAILED' : 'PROCESSED', error, processedAt: new Date() },
  });
}

const say = (waId, text) => reply(waId, 'text', text);
const ask = (waId, text, options) => reply(waId, 'buttons', text, { options });
const choose = (waId, text, label, options) => reply(waId, 'list', text, { label, options });

/* ---------------- Prompts ---------------- */

const PROMPTS = {
  NAME: (w) => say(w, 'Welcome. I will help you register a product complaint. It takes about two minutes.\n\nType *Hi* at any time to start again.\n\nWhat is your full name?'),
  EMAIL: (w, a) => say(w, `Thank you, ${a.name}. What is your email address? We will send the acknowledgement there.`),
  REPORTER_TYPE: (w) => ask(w, 'Are you a customer, a retailer or a distributor?', REPORTER_TYPES.map((t) => ({ id: `type:${t}`, title: t }))),
  SBU: (w) => choose(w, 'Which business unit does the product belong to?', 'Choose unit', env.WHATSAPP_SBUS.map((s, i) => ({ id: `sbu:${i}`, title: s }))),
  COUNTRY: (w) => say(w, 'Which country are you in?'),
  CUSTOMER: (w, a) =>
    say(w, a.reporterType === 'Customer'
      ? 'Which distributor or retailer did you buy the product from? Reply *SKIP* if you do not know.'
      : `What is the name of your ${a.reporterType.toLowerCase()} business?`),
  PRODUCT: (w) => say(w, 'Which product is the complaint about? Reply *SKIP* if you are not sure.'),
  BATCH: (w) => say(w, 'What is the batch number printed on the pack? Reply *SKIP* if you cannot find it.'),
  CATEGORY: (w) => choose(w, 'What kind of problem is it?', 'Choose type', env.WHATSAPP_CATEGORIES.map((c, i) => ({ id: `cat:${i}`, title: c }))),
  DESCRIPTION: (w) => say(w, 'Please describe the problem in a sentence or two.'),
  DETAILS: (w) => ask(w, `You can now send up to ${MAX_FILES} photos or documents, or any more details. Press *Done* when you have finished.`, [{ id: 'done', title: 'Done' }]),
};

function summary(a) {
  const rows = [
    ['Name', a.name],
    ['Email', a.email],
    ['You are a', a.reporterType],
    ['Business unit', a.sbu],
    ['Country', a.country],
    [a.reporterType === 'Customer' ? 'Bought from' : 'Business', a.customer || 'Not given'],
    ['Product', a.product || 'Not given'],
    ['Batch', a.batch || 'Not given'],
    ['Problem type', a.category],
    ['Description', a.description],
    ['Photos/documents', String(a.media?.length || 0)],
  ];
  return `Please check your complaint:\n\n${rows.map(([k, v]) => `*${k}:* ${v}`).join('\n')}`;
}

async function showConfirm(waId, a) {
  await ask(waId, summary(a), [
    { id: 'confirm:submit', title: 'Submit' },
    { id: 'confirm:restart', title: 'Start over' },
  ]);
}

/* ---------------- Conversation ---------------- */

async function setStep(session, step, answers = session.answers) {
  session.step = step;
  session.answers = answers;
  session.markModified('answers');
  session.lastInboundAt = new Date();
  await session.save();
}

async function restart(session, waId) {
  await setStep(session, 'NAME', { mobile: waId, media: [] });
  await PROMPTS.NAME(waId);
}

/** Match a button/list reply id, or typed text, against options. */
function pick(input, prefix, values) {
  if (input.replyId?.startsWith(`${prefix}:`)) {
    const key = input.replyId.slice(prefix.length + 1);
    return values.includes(key) ? key : values[Number(key)];
  }
  const t = (input.text || '').trim().toLowerCase();
  return values.find((v) => v.toLowerCase() === t) || (/^\d+$/.test(t) ? values[Number(t) - 1] : undefined);
}

const textOf = (input) => (input.text || '').trim();
const optional = (t) => (SKIP.test(t) ? '' : t);

async function submit(session, waId) {
  // Claim the session atomically so a double-tapped "Submit" creates one complaint.
  const claimed = await WhatsappSession.findOneAndUpdate({ _id: session._id, step: 'CONFIRM' }, { $set: { step: 'SUBMITTING' } }, { returnDocument: 'after' });
  if (!claimed) return null;
  const a = claimed.answers;
  const complaint = await createComplaint(
    {
      requester: { name: a.name, email: a.email, mobile: `+${waId}`, type: a.reporterType },
      sbu: a.sbu,
      country: a.country,
      category: a.category,
      shortDescription: a.description.slice(0, 500),
      additionalRemarks: [a.description.length > 500 ? a.description : '', ...(a.notes || [])].filter(Boolean).join('\n\n').slice(0, 4000) || undefined,
      customer: a.customer ? { name: a.customer } : undefined,
      reportedProduct: a.product || a.batch ? { name: a.product || undefined, batchNumber: a.batch || undefined } : undefined,
    },
    { actor: null, origin: 'WhatsApp' },
  );

  // Attachments are best-effort: a media download failure never loses the complaint.
  if (a.media?.length) {
    const files = [];
    for (const m of a.media) {
      try {
        const f = await whatsapp().downloadMedia(m.id);
        files.push({ buffer: f.buffer, mimetype: f.mimeType || m.mimeType, originalname: m.filename || f.filename || `whatsapp-${m.id.slice(-8)}`, size: f.buffer.length });
      } catch (err) {
        logger.warn({ err: err.message, media: m.id }, 'WhatsApp media download failed');
      }
    }
    const { stored, rejected } = await storeSystemAttachments(complaint, files, 'whatsapp');
    if (rejected.length || files.length < a.media.length) {
      await audit.record({
        action: 'complaint.attachment.whatsapp_skipped',
        entityType: 'Complaint',
        entityId: complaint._id,
        complaint: complaint._id,
        summary: `${a.media.length - stored} WhatsApp file(s) could not be saved: ${[...rejected, ...(files.length < a.media.length ? ['download failed'] : [])].join('; ')}`,
      });
    }
  }

  await notifications.enqueue({
    type: 'WHATSAPP_COMPLAINT_REGISTERED',
    channel: 'whatsapp',
    complaint: complaint._id,
    recipient: waId,
    dedupeKey: `WA_REGISTERED:${complaint._id}`,
    message: {
      subject: `Complaint ${complaint.complaintNumber} registered`,
      text: `Thank you. Your complaint has been registered.\n\nComplaint number: *${complaint.complaintNumber}*\n\nPlease keep this number for reference. We will email you at ${a.email} once our team has reviewed it.\n\nType *Hi* to register another complaint.`,
    },
  });
  notifications.nudge();
  await WhatsappSession.deleteOne({ _id: session._id });
  return complaint;
}

/** Handle one inbound message. Returns what happened, for logs and tests. */
export async function handleMessage(input) {
  const { waId } = input;
  let session = await WhatsappSession.findOne({ waId });

  if (CANCEL.test(textOf(input))) {
    if (session) await WhatsappSession.deleteOne({ _id: session._id });
    await say(waId, 'Your complaint was not submitted. Type *Hi* whenever you want to start again.');
    return { step: 'CANCELLED' };
  }
  if (!session || RESTART.test(textOf(input)) || input.replyId === 'confirm:restart') {
    session = session || new WhatsappSession({ waId, step: 'NAME', answers: {} });
    await restart(session, waId);
    return { step: 'NAME' };
  }
  if (session.step === 'SUBMITTING') return { step: 'SUBMITTING' };

  const a = { media: [], notes: [], ...session.answers };
  const t = textOf(input);
  const isMedia = input.media && ['image', 'document'].includes(input.type);
  if (!t && !input.replyId && !(session.step === 'DETAILS' && isMedia)) {
    await say(waId, isMedia ? 'Thank you. You can send photos after describing the problem; I will ask for them.' : 'Sorry, I can only read text, buttons, photos and documents.');
    await PROMPTS[session.step]?.(waId, a);
    return { step: session.step };
  }

  const next = async (step) => {
    await setStep(session, step, a);
    if (step === 'CONFIRM') await showConfirm(waId, a);
    else await PROMPTS[step](waId, a);
    return { step };
  };
  const retry = async (message) => {
    await say(waId, message);
    await PROMPTS[session.step](waId, a);
    return { step: session.step, invalid: true };
  };

  switch (session.step) {
    case 'NAME':
      if (t.length < 2 || t.length > 120) return retry('Please enter your full name (2 to 120 characters).');
      a.name = t;
      return next('EMAIL');
    case 'EMAIL':
      if (!emailSchema.safeParse(t).success) return retry('That does not look like an email address. Please check it, for example name@example.com.');
      a.email = t.toLowerCase();
      return next('REPORTER_TYPE');
    case 'REPORTER_TYPE': {
      const v = pick(input, 'type', REPORTER_TYPES);
      if (!v) return retry('Please choose one of the buttons.');
      a.reporterType = v;
      return next('SBU');
    }
    case 'SBU': {
      const v = pick(input, 'sbu', env.WHATSAPP_SBUS);
      if (!v) return retry('Please choose a business unit from the list.');
      a.sbu = v;
      return next('COUNTRY');
    }
    case 'COUNTRY':
      if (t.length < 2 || t.length > 80) return retry('Please enter the country name.');
      a.country = t;
      return next('CUSTOMER');
    case 'CUSTOMER':
      if (t.length > 200) return retry('Please keep this under 200 characters.');
      if (a.reporterType !== 'Customer' && SKIP.test(t)) return retry('We need the business name to trace the supply.');
      a.customer = optional(t);
      return next('PRODUCT');
    case 'PRODUCT':
      if (t.length > 200) return retry('Please keep this under 200 characters.');
      a.product = optional(t);
      return next('BATCH');
    case 'BATCH':
      if (t.length > 60) return retry('Batch numbers are usually short. Please check it.');
      a.batch = optional(t);
      return next('CATEGORY');
    case 'CATEGORY': {
      const v = pick(input, 'cat', env.WHATSAPP_CATEGORIES);
      if (!v) return retry('Please choose a problem type from the list.');
      a.category = v;
      return next('DESCRIPTION');
    }
    case 'DESCRIPTION':
      if (t.length < 10) return retry('Please describe the problem in at least a few words (10 characters or more).');
      if (t.length > 4000) return retry('That is too long. Please keep it under 4000 characters; you can add more after this.');
      a.description = t;
      return next('DETAILS');
    case 'DETAILS':
      if (isMedia) {
        if (a.media.length >= MAX_FILES) {
          await say(waId, `You have already sent ${MAX_FILES} files, which is the limit. Press *Done* to continue.`);
          return { step: 'DETAILS' };
        }
        a.media.push({ id: input.media.id, mimeType: input.media.mimeType, filename: input.media.filename });
        if (input.media.caption) a.notes.push(input.media.caption);
        await setStep(session, 'DETAILS', a);
        await ask(waId, `Received (${a.media.length} of ${MAX_FILES}). Send more, or press *Done*.`, [{ id: 'done', title: 'Done' }]);
        return { step: 'DETAILS', files: a.media.length };
      }
      if (input.replyId === 'done' || DONE.test(t)) return next('CONFIRM');
      a.notes.push(t.slice(0, 2000));
      await setStep(session, 'DETAILS', a);
      await ask(waId, 'Noted. Send anything else, or press *Done*.', [{ id: 'done', title: 'Done' }]);
      return { step: 'DETAILS' };
    case 'CONFIRM':
      if (input.replyId === 'confirm:submit' || /^submit$/i.test(t)) {
        const complaint = await submit(session, waId);
        return { step: 'SUBMITTED', complaintNumber: complaint?.complaintNumber, complaintId: complaint?._id };
      }
      await showConfirm(waId, a);
      return { step: 'CONFIRM' };
    default:
      return restart(session, waId).then(() => ({ step: 'NAME' }));
  }
}

/* ---------------- Webhook payload ---------------- */

/** Turn one Meta message object into our input shape. */
function normalise(m, contact) {
  const input = { waMessageId: m.id, waId: m.from, name: contact?.profile?.name, type: m.type };
  if (m.type === 'text') input.text = m.text?.body;
  if (m.type === 'interactive') {
    const r = m.interactive?.button_reply || m.interactive?.list_reply;
    input.replyId = r?.id;
    input.text = r?.title;
  }
  if (m.type === 'button') input.text = m.button?.text;
  if (m.type === 'image' || m.type === 'document') {
    const md = m[m.type];
    input.media = { id: md.id, mimeType: md.mime_type, filename: md.filename, caption: md.caption };
  }
  return input;
}

/**
 * Process a webhook body. Each message is stored first; the unique message
 * id means Meta's retries are ignored rather than processed twice.
 */
export async function processWebhook(body) {
  const result = { messages: 0, duplicates: 0, statuses: 0, errors: 0 };
  for (const entry of body?.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value || {};
      for (const m of value.messages || []) {
        const input = normalise(m, value.contacts?.find((c) => c.wa_id === m.from));
        let record;
        try {
          record = await WhatsappMessage.create({ waMessageId: m.id, direction: 'inbound', waId: m.from, type: m.type, body: m });
        } catch (err) {
          if (err?.code === 11000) {
            result.duplicates += 1;
            continue;
          }
          throw err;
        }
        try {
          const outcome = await handleMessage(input);
          await WhatsappMessage.updateOne(
            { _id: record._id },
            { $set: { 'processing.status': 'PROCESSED', 'processing.processedAt': new Date(), ...(outcome?.complaintId ? { complaint: outcome.complaintId } : {}) } },
          );
          result.messages += 1;
        } catch (err) {
          result.errors += 1;
          logger.error({ err, waMessageId: m.id }, 'WhatsApp message processing failed');
          await WhatsappMessage.updateOne({ _id: record._id }, { $set: { 'processing.status': 'FAILED', 'processing.error': String(err.message).slice(0, 2000) } });
          await say(m.from, 'Sorry, something went wrong on our side. Please try again in a few minutes, or type *Hi* to start over.');
        }
      }
      // Delivery receipts for messages we sent through the notification queue.
      for (const st of value.statuses || []) {
        result.statuses += 1;
        if (st.status === 'delivered' || st.status === 'read') {
          await Notification.updateOne({ providerMessageId: st.id, status: { $in: ['SENT', 'QUEUED'] } }, { $set: { status: 'DELIVERED', deliveredAt: new Date() } });
        } else if (st.status === 'failed') {
          const reason = st.errors?.[0]?.title || st.errors?.[0]?.message || 'Delivery failed';
          await Notification.updateOne({ providerMessageId: st.id }, { $set: { status: 'FAILED', lastError: `WhatsApp: ${reason}` } });
        }
      }
    }
  }
  return result;
}
