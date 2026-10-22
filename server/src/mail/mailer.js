import fs from 'node:fs/promises';
import path from 'node:path';
import nodemailer from 'nodemailer';
import env from '../config/env.js';

/**
 * Every mail driver implements send({ to, subject, text, html }) and returns
 * { messageId }. It throws on failure; the notification service decides
 * whether to retry.
 */

/** Development: write each message as a standard .eml file. */
function fileDriver(dir) {
  const stream = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'unix' });
  return {
    name: 'file',
    async send(msg) {
      const info = await stream.sendMail({ from: env.MAIL_FROM, ...msg });
      await fs.mkdir(dir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const safeTo = String(msg.to).replace(/[^a-z0-9@._-]/gi, '_');
      await fs.writeFile(path.join(dir, `${stamp}_${safeTo}.eml`), info.message);
      return { messageId: info.messageId };
    },
  };
}

/** Production: the company's SMTP relay. */
function smtpDriver() {
  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
    pool: true,
    connectionTimeout: 15_000,
    socketTimeout: 30_000,
  });
  return {
    name: 'smtp',
    async send(msg) {
      const info = await transport.sendMail({ from: env.MAIL_FROM, ...msg });
      // An SMTP server can accept some recipients and reject others.
      if (info.rejected?.length) throw new Error(`Rejected by mail server: ${info.rejected.join(', ')}`);
      return { messageId: info.messageId };
    },
  };
}

let driver;

export function mailer() {
  if (!driver) driver = env.MAIL_DRIVER === 'smtp' ? smtpDriver() : fileDriver(env.MAIL_OUTBOX_DIR);
  return driver;
}

/** Tests and scripts can swap the driver. */
export function setMailer(next) {
  driver = next;
}

/**
 * In-memory driver for tests. `failNext(n, message)` makes the next n sends
 * throw, to exercise the retry logic.
 */
export function memoryMailer() {
  const sent = [];
  let failures = 0;
  let failMessage = 'Simulated SMTP failure';
  return {
    name: 'memory',
    sent,
    failNext(n = 1, message = failMessage) {
      failures = n;
      failMessage = message;
    },
    async send(msg) {
      if (failures > 0) {
        failures -= 1;
        throw new Error(failMessage);
      }
      const messageId = `<test-${sent.length + 1}@sfa-cms.test>`;
      sent.push({ ...msg, messageId });
      return { messageId };
    },
  };
}
