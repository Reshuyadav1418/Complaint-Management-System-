import crypto from 'node:crypto';
import express, { Router } from 'express';
import env from '../config/env.js';
import logger from '../config/logger.js';
import { processWebhook } from '../whatsapp/chatbot.js';

/**
 * Meta WhatsApp webhook. Mounted before JSON parsing and before the CSRF
 * origin check: Meta calls it server to server, and authenticity comes from
 * the X-Hub-Signature-256 HMAC of the raw body with the app secret.
 */
const r = Router();

// Verification handshake when the webhook is registered in the Meta app.
r.get('/', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  if (mode === 'subscribe' && env.WHATSAPP_VERIFY_TOKEN && safeEqual(String(token), env.WHATSAPP_VERIFY_TOKEN)) {
    return res.status(200).type('text/plain').send(String(req.query['hub.challenge'] ?? ''));
  }
  return res.sendStatus(403);
});

function safeEqual(a, b) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export function signatureValid(raw, header) {
  if (!env.WHATSAPP_APP_SECRET) return env.WHATSAPP_DRIVER === 'mock' && !env.isProduction;
  if (!header?.startsWith('sha256=')) return false;
  const expected = `sha256=${crypto.createHmac('sha256', env.WHATSAPP_APP_SECRET).update(raw).digest('hex')}`;
  return safeEqual(header, expected);
}

r.post('/', express.raw({ type: '*/*', limit: '1mb' }), async (req, res) => {
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
  if (!signatureValid(raw, req.get('x-hub-signature-256'))) {
    logger.warn({ ip: req.ip }, 'WhatsApp webhook with invalid signature rejected');
    return res.sendStatus(401);
  }
  let body;
  try {
    body = JSON.parse(raw.toString('utf8'));
  } catch {
    return res.sendStatus(400);
  }
  try {
    const result = await processWebhook(body);
    logger.info(result, 'WhatsApp webhook processed');
  } catch (err) {
    // Still 200: a non-200 makes Meta resend, and the duplicate guard would
    // then skip messages already stored. Failures are logged per message.
    logger.error({ err }, 'WhatsApp webhook processing error');
  }
  return res.sendStatus(200);
});

export default r;
