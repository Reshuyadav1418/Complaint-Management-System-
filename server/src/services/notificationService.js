import mongoose from 'mongoose';
import { Notification, Complaint, WhatsappMessage } from '../models/index.js';
import env from '../config/env.js';
import logger from '../config/logger.js';
import { AppError } from '../utils/AppError.js';
import { escapeRegex, pageMeta } from '../utils/http.js';
import { mailer } from '../mail/mailer.js';
import { whatsapp } from '../whatsapp/adapters.js';
import * as audit from './auditService.js';

/**
 * Outbound notifications.
 *
 * 1. enqueue() renders the message and stores it as QUEUED, inside the same
 *    transaction as the business action that caused it. If the action rolls
 *    back, so does the email. The unique dedupeKey means the same business
 *    event can never queue a second email, however many times it is retried.
 *
 * 2. A worker claims due messages one at a time with an atomic update, sends
 *    them, and records SENT or schedules a retry. A crash while sending leaves
 *    a lock that expires, and the message is picked up again.
 *
 * Status meanings:
 *   QUEUED     waiting to be sent, or waiting for its next retry
 *   SENT       the mail server accepted it (plain SMTP cannot confirm more)
 *   DELIVERED  the provider confirmed delivery (WhatsApp, or an email API with events)
 *   FAILED     gave up after NOTIFY_MAX_ATTEMPTS; can be retried by hand
 */

const LOCK_MS = 2 * 60 * 1000;
// Delay before attempt n+1, after attempt n fails.
const BACKOFF_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000, 3 * 60 * 60_000];

export function backoff(attempts) {
  return BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)];
}

/**
 * Queue a message. Returns { notification, created }. If the dedupeKey was
 * already used, the existing notification is returned and nothing is added.
 */
export async function enqueue({ type, channel = 'email', complaint, recipient, recipientUser, dedupeKey, message, session }) {
  if (!recipient) throw new Error('Notification recipient is required');
  const existing = await Notification.findOne({ dedupeKey }).session(session ?? null);
  if (existing) return { notification: existing, created: false };
  const [notification] = await Notification.create(
    [
      {
        type,
        channel,
        complaint,
        recipient,
        recipientUser,
        dedupeKey,
        subject: message.subject,
        bodyText: message.text,
        bodyHtml: message.html,
        status: 'QUEUED',
        nextAttemptAt: new Date(),
      },
    ],
    session ? { session } : undefined,
  );
  return { notification, created: true };
}

/** Atomically take one due message, or null if none is due. */
async function claimNext(now = new Date()) {
  return Notification.findOneAndUpdate(
    {
      status: 'QUEUED',
      nextAttemptAt: { $lte: now },
      $or: [{ lockedUntil: null }, { lockedUntil: { $lte: now } }],
    },
    { $set: { lockedUntil: new Date(now.getTime() + LOCK_MS) }, $inc: { attempts: 1 } },
    { sort: { nextAttemptAt: 1 }, returnDocument: 'after' },
  ).select('+bodyHtml');
}

async function sendOne(n) {
  try {
    const { messageId } =
      n.channel === 'whatsapp'
        ? await whatsapp().sendText(n.recipient, n.bodyText)
        : await mailer().send({ to: n.recipient, subject: n.subject, text: n.bodyText, html: n.bodyHtml });
    await Notification.updateOne(
      { _id: n._id },
      { $set: { status: 'SENT', sentAt: new Date(), providerMessageId: messageId, lastError: null, lockedUntil: null } },
    );
    if (n.channel === 'whatsapp') {
      // Keep the WhatsApp conversation log complete, including queued messages.
      await WhatsappMessage.create({
        waMessageId: messageId || `queued.${n._id}`,
        direction: 'outbound',
        waId: n.recipient,
        type: 'text',
        body: { text: n.bodyText },
        complaint: n.complaint,
        processing: { status: 'PROCESSED', processedAt: new Date() },
      }).catch(() => {});
    }
    await audit.record({
      action: 'notification.sent',
      entityType: 'Notification',
      entityId: n._id,
      complaint: n.complaint,
      summary: n.channel === 'whatsapp' ? `Sent WhatsApp message "${n.subject}" to +${n.recipient}` : `Sent "${n.subject}" to ${n.recipient}`,
    });
    return 'SENT';
  } catch (err) {
    const reason = String(err?.message || err).slice(0, 2000);
    const final = n.attempts >= env.NOTIFY_MAX_ATTEMPTS;
    await Notification.updateOne(
      { _id: n._id },
      {
        $set: {
          status: final ? 'FAILED' : 'QUEUED',
          lastError: reason,
          lockedUntil: null,
          nextAttemptAt: final ? n.nextAttemptAt : new Date(Date.now() + backoff(n.attempts)),
        },
      },
    );
    logger.warn({ notification: String(n._id), attempts: n.attempts, final, err: reason }, 'Notification send failed');
    if (final) {
      await audit.record({
        action: 'notification.failed',
        entityType: 'Notification',
        entityId: n._id,
        complaint: n.complaint,
        summary: `Could not send "${n.subject}" to ${n.recipient} after ${n.attempts} attempts: ${reason}`,
      });
    }
    return final ? 'FAILED' : 'RETRY';
  }
}

/** Send everything that is due. Returns counts; safe to run in parallel. */
export async function processDue({ limit = 50 } = {}) {
  const result = { sent: 0, retry: 0, failed: 0 };
  for (let i = 0; i < limit; i += 1) {
    const n = await claimNext();
    if (!n) break;
    const outcome = await sendOne(n);
    if (outcome === 'SENT') result.sent += 1;
    else if (outcome === 'RETRY') result.retry += 1;
    else result.failed += 1;
  }
  return result;
}

/* ---------------- Worker ---------------- */

let timer = null;
let running = false;

async function tick() {
  if (running || mongoose.connection.readyState !== 1) return;
  running = true;
  try {
    const r = await processDue();
    if (r.sent || r.retry || r.failed) logger.info(r, 'Notifications processed');
  } catch (err) {
    logger.error({ err }, 'Notification worker error');
  } finally {
    running = false;
  }
}

export function startWorker() {
  if (timer) return;
  timer = setInterval(tick, env.NOTIFY_POLL_SECONDS * 1000);
  timer.unref();
  logger.info({ driver: mailer().name, everySeconds: env.NOTIFY_POLL_SECONDS }, 'Notification worker started');
}

export function stopWorker() {
  clearInterval(timer);
  timer = null;
}

/** Send soon after a business action instead of waiting for the next poll. */
export function nudge() {
  if (timer) setImmediate(tick);
}

/* ---------------- Reading and manual retry ---------------- */

export async function list(query, page) {
  const filter = {};
  if (query.status) filter.status = query.status;
  if (query.type) filter.type = query.type;
  if (query.search) {
    const rx = new RegExp(escapeRegex(query.search.trim()), 'i');
    const complaints = await Complaint.find({ complaintNumber: rx }, { _id: 1 }).limit(200).lean();
    filter.$or = [{ recipient: rx }, { subject: rx }, { complaint: { $in: complaints.map((c) => c._id) } }];
  }
  const [items, total] = await Promise.all([
    Notification.find(filter)
      .sort({ createdAt: -1 })
      .skip(page.skip)
      .limit(page.limit)
      .select('-dedupeKey -lockedUntil')
      .populate('complaint', 'complaintNumber')
      .populate('retriedBy', 'name')
      .lean(),
    Notification.countDocuments(filter),
  ]);
  return { items, meta: pageMeta(page, total) };
}

/** Notifications for one complaint (caller has already checked visibility). */
export async function forComplaint(complaintId) {
  return Notification.find({ complaint: complaintId })
    .sort({ createdAt: -1 })
    .select('type channel recipient subject status attempts lastError sentAt deliveredAt createdAt nextAttemptAt')
    .lean();
}

/**
 * Put a FAILED message back in the queue. Only FAILED: retrying a SENT email
 * would send it twice, and a QUEUED one is already going to be retried.
 */
export async function retry(id, actor, context) {
  const n = await Notification.findOneAndUpdate(
    { _id: id, status: 'FAILED' },
    // A manual retry gets a fresh set of automatic attempts.
    { $set: { status: 'QUEUED', nextAttemptAt: new Date(), lastError: null, retriedBy: actor._id, attempts: 0 } },
    { returnDocument: 'after' },
  );
  if (!n) {
    const exists = await Notification.exists({ _id: id });
    if (!exists) throw AppError.notFound('Notification');
    throw AppError.conflict('Only failed notifications can be retried. This one has already been sent or is still queued.');
  }
  await audit.record({
    actor,
    action: 'notification.retry',
    entityType: 'Notification',
    entityId: n._id,
    complaint: n.complaint,
    summary: `Requeued email to ${n.recipient}`,
    context,
  });
  nudge();
  return n.toObject();
}

export async function getOne(id) {
  const n = await Notification.findById(id).select('+bodyHtml -dedupeKey -lockedUntil').populate('complaint', 'complaintNumber').lean();
  if (!n) throw AppError.notFound('Notification');
  return n;
}
