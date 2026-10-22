import crypto from 'node:crypto';
import env from '../config/env.js';

/*
 * Every WhatsApp driver implements:
 *   sendText(to, text)                         -> { messageId }
 *   sendButtons(to, text, [{ id, title }])     -> { messageId }   up to 3 buttons, title <= 20 chars
 *   sendList(to, text, label, [{ id, title }]) -> { messageId }   up to 10 rows, title <= 24 chars
 *   downloadMedia(mediaId)                     -> { buffer, mimeType, filename }
 * Methods throw on failure; callers decide what to retry.
 */

const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/* ---------------- WhatsApp Business Cloud API ---------------- */

function cloudAdapter() {
  const base = `https://graph.facebook.com/${env.WHATSAPP_API_VERSION}`;
  const headers = { Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}` };

  async function post(body) {
    const res = await fetch(`${base}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', ...body }),
      signal: AbortSignal.timeout(15_000),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`WhatsApp API ${res.status}: ${json?.error?.message || res.statusText}`);
    return { messageId: json.messages?.[0]?.id };
  }

  return {
    name: 'cloud',
    sendText: (to, text) => post({ to, type: 'text', text: { body: text, preview_url: false } }),
    sendButtons: (to, text, buttons) =>
      post({
        to,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text },
          action: { buttons: buttons.slice(0, 3).map((b) => ({ type: 'reply', reply: { id: b.id, title: clip(b.title, 20) } })) },
        },
      }),
    sendList: (to, text, label, rows) =>
      post({
        to,
        type: 'interactive',
        interactive: {
          type: 'list',
          body: { text },
          action: { button: clip(label, 20), sections: [{ title: clip(label, 24), rows: rows.slice(0, 10).map((r) => ({ id: r.id, title: clip(r.title, 24) })) }] },
        },
      }),
    async downloadMedia(mediaId) {
      const meta = await fetch(`${base}/${mediaId}`, { headers, signal: AbortSignal.timeout(15_000) });
      if (!meta.ok) throw new Error(`WhatsApp media lookup ${meta.status}`);
      const { url, mime_type: mimeType } = await meta.json();
      const file = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
      if (!file.ok) throw new Error(`WhatsApp media download ${file.status}`);
      return { buffer: Buffer.from(await file.arrayBuffer()), mimeType };
    },
  };
}

/* ---------------- Mock (development, tests, simulator) ---------------- */

/**
 * Keeps sent messages in memory per phone number, so the simulator page can
 * show the bot's replies, and lets the simulator "upload" media that the
 * chatbot then downloads exactly as it would from Meta.
 */
export function mockAdapter() {
  const outbox = new Map(); // waId -> [{ id, at, kind, text, options }]
  const media = new Map(); // mediaId -> { buffer, mimeType, filename }
  let failures = 0;

  const record = (to, entry) => {
    const id = `wamid.mock.${crypto.randomUUID()}`;
    const list = outbox.get(to) || [];
    list.push({ id, at: new Date().toISOString(), ...entry });
    outbox.set(to, list.slice(-200));
    return { messageId: id };
  };
  const maybeFail = () => {
    if (failures > 0) {
      failures -= 1;
      throw new Error('Simulated WhatsApp API failure');
    }
  };

  return {
    name: 'mock',
    async sendText(to, text) {
      maybeFail();
      return record(to, { kind: 'text', text });
    },
    async sendButtons(to, text, buttons) {
      maybeFail();
      return record(to, { kind: 'buttons', text, options: buttons });
    },
    async sendList(to, text, label, rows) {
      maybeFail();
      return record(to, { kind: 'list', text, label, options: rows });
    },
    async downloadMedia(mediaId) {
      const m = media.get(mediaId);
      if (!m) throw new Error('Unknown media id');
      return m;
    },
    // Test and simulator helpers
    putMedia(buffer, mimeType, filename) {
      const id = `media.mock.${crypto.randomUUID()}`;
      media.set(id, { buffer, mimeType, filename });
      return id;
    },
    messagesFor: (waId) => outbox.get(waId) || [],
    clear: (waId) => (waId ? outbox.delete(waId) : outbox.clear()),
    failNext(n = 1) {
      failures = n;
    },
  };
}

let instance;
export function whatsapp() {
  if (!instance) instance = env.WHATSAPP_DRIVER === 'cloud' ? cloudAdapter() : mockAdapter();
  return instance;
}
export function setWhatsapp(adapter) {
  instance = adapter;
}
