import { Router } from 'express';
import { z } from 'zod';
import env from '../config/env.js';
import { WhatsappMessage } from '../models/index.js';
import { requireAnyPermission } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import { PERMISSIONS as P } from '../auth/permissions.js';
import { AppError } from '../utils/AppError.js';
import { ok } from '../utils/http.js';
import { processWebhook } from '../whatsapp/chatbot.js';
import { whatsapp } from '../whatsapp/adapters.js';

/**
 * WhatsApp simulator (mock driver only). Builds the same payload Meta sends
 * and feeds it through the real webhook processing, so the simulator tests
 * exactly the code that runs in production.
 */
const r = Router();

// Never available in production, even on a staging server using the mock driver.
r.use((req, _res, next) => (env.WHATSAPP_DRIVER === 'mock' && !env.isProduction ? next() : next(AppError.notFound('Simulator'))));
r.use(requireAnyPermission(P.SETTINGS_MANAGE, P.COMPLAINT_CREATE_MANUAL));

const waId = z.string().regex(/^\d{8,15}$/, 'Use digits only, with country code, e.g. 919812345678.');

const sendBody = z.object({
  waId,
  name: z.string().trim().max(80).optional(),
  text: z.string().max(4000).optional(),
  reply: z.object({ id: z.string().max(200), title: z.string().max(100) }).optional(),
  file: z
    .object({
      base64: z.string().max(8_000_000),
      mimeType: z.string().max(100),
      filename: z.string().max(200),
      caption: z.string().max(1000).optional(),
    })
    .optional(),
});

let counter = 0;

r.post('/messages', validate({ body: sendBody }), async (req, res) => {
  const { waId: from, name, text, reply, file } = req.body;
  const id = `wamid.sim.${Date.now()}.${(counter += 1)}`;
  let message = { from, id, timestamp: String(Math.floor(Date.now() / 1000)) };
  if (reply) message = { ...message, type: 'interactive', interactive: { type: 'button_reply', button_reply: reply } };
  else if (file) {
    const mediaId = whatsapp().putMedia(Buffer.from(file.base64, 'base64'), file.mimeType, file.filename);
    const kind = file.mimeType.startsWith('image/') ? 'image' : 'document';
    message = { ...message, type: kind, [kind]: { id: mediaId, mime_type: file.mimeType, filename: file.filename, caption: file.caption } };
  } else message = { ...message, type: 'text', text: { body: text ?? '' } };

  const payload = {
    object: 'whatsapp_business_account',
    entry: [{ id: 'sim', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', contacts: [{ wa_id: from, profile: { name: name || 'Simulator' } }], messages: [message] } }] }],
  };
  const result = await processWebhook(payload);
  return ok(res, result);
});

/** The conversation, oldest first, from the message log. */
r.get('/messages', validate({ query: z.object({ waId }) }), async (req, res) => {
  const rows = await WhatsappMessage.find({ waId: req.validQuery.waId }).sort({ createdAt: 1, _id: 1 }).limit(300).populate('complaint', 'complaintNumber').lean();
  return ok(
    res,
    rows.map((m) => ({
      _id: m._id,
      at: m.createdAt,
      direction: m.direction,
      type: m.type,
      text: m.direction === 'inbound' ? m.body?.text?.body ?? m.body?.interactive?.button_reply?.title ?? m.body?.interactive?.list_reply?.title ?? (m.body?.image || m.body?.document ? `[${m.type}] ${m.body[m.type]?.filename || ''}`.trim() : '') : m.body?.text,
      options: m.body?.options,
      label: m.body?.label,
      failed: m.processing?.status === 'FAILED',
      complaint: m.complaint,
    })),
  );
});

r.delete('/messages', validate({ query: z.object({ waId }) }), async (req, res) => {
  await WhatsappMessage.deleteMany({ waId: req.validQuery.waId });
  return ok(res, { cleared: true });
});

export default r;
