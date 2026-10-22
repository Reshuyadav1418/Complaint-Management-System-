import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config({ quiet: true });

/**
 * All configuration comes from environment variables and is validated at
 * startup, so a missing secret fails fast instead of failing on first use.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
  CLIENT_ORIGIN: z.url().default('http://localhost:5173'),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  SESSION_TTL_HOURS: z.coerce.number().positive().default(10),
  COOKIE_SECURE: z.enum(['true', 'false']).optional(),
  TRUST_PROXY: z.enum(['true', 'false']).default('false'),

  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(12),
  // Requests per minute per client IP across the API (behind a proxy, set TRUST_PROXY).
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(300),
  LOGIN_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  LOGIN_LOCK_MINUTES: z.coerce.number().int().positive().default(15),

  // Complaint numbering. The company's real format is an open question
  // (docs/OPEN_QUESTIONS.md, Q1); these defaults are placeholders.
  COMPLAINT_NUMBER_PREFIX: z.string().regex(/^[A-Z0-9-]{1,12}$/).default('CMP'),
  COMPLAINT_NUMBER_PAD: z.coerce.number().int().min(3).max(10).default(6),

  // Private attachment storage. 'local' writes to STORAGE_DIR, which must be
  // outside any web-served folder. An S3/Azure adapter replaces it in production.
  STORAGE_DRIVER: z.enum(['local']).default('local'),
  STORAGE_DIR: z.string().default('./storage'),
  UPLOAD_MAX_MB: z.coerce.number().positive().max(50).default(10),
  UPLOAD_MAX_FILES: z.coerce.number().int().positive().max(20).default(5),

  // Email. 'file' writes each message as a .eml file to MAIL_OUTBOX_DIR
  // (development); 'smtp' sends through the company's SMTP server.
  MAIL_DRIVER: z.enum(['file', 'smtp']).default('file'),
  MAIL_FROM: z.string().min(3).default('Customer Relationship Management <no-reply@example.test>'),
  MAIL_OUTBOX_DIR: z.string().default('./mail-outbox'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: z.enum(['true', 'false']).default('false'),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),

  // Background sending. Failed emails are retried with increasing delays
  // until NOTIFY_MAX_ATTEMPTS, then marked failed for manual retry.
  NOTIFY_WORKER: z.enum(['true', 'false']).optional(),
  NOTIFY_POLL_SECONDS: z.coerce.number().int().positive().default(15),
  NOTIFY_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(5),

  // Who receives the D2 completion notice (OPEN_QUESTIONS Q6b): a comma list
  // of "frp" (the assigned FRP), "completer" (who completed D2) and/or email
  // addresses, e.g. "frp,qa.head@example.com".
  D2_COMPLETED_NOTIFY: z.string().default('frp'),

  // WhatsApp. 'mock' runs the full chatbot without Meta (replies are kept in
  // memory and shown in the in-app simulator); 'cloud' uses the WhatsApp
  // Business Cloud API.
  WHATSAPP_DRIVER: z.enum(['mock', 'cloud']).default('mock'),
  WHATSAPP_VERIFY_TOKEN: z.string().optional(),
  WHATSAPP_APP_SECRET: z.string().optional(),
  WHATSAPP_ACCESS_TOKEN: z.string().optional(),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_API_VERSION: z.string().regex(/^v\d+\.\d+$/).default('v21.0'),
  // Choices offered by the chatbot. Placeholders until the company confirms
  // its lists (OPEN_QUESTIONS Q6, Q18). Comma-separated.
  WHATSAPP_SBUS: z.string().default('AHP-Rumicare,AHP-Poultry,AHP-Aqua'),
  WHATSAPP_CATEGORIES: z.string().default('Packaging,Product quality,Efficacy,Labelling,Other'),

  // Public address of the web app, used for links in internal emails.
  APP_BASE_URL: z.url().optional(),

  // Allows MAIL_DRIVER=file or WHATSAPP_DRIVER=mock with NODE_ENV=production,
  // for a staging server that must not send real messages.
  ALLOW_DEV_DRIVERS: z.enum(['true', 'false']).default('false'),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
  // eslint-disable-next-line no-console
  console.error(`Invalid environment configuration:\n${lines.join('\n')}`);
  process.exit(1);
}

const raw = parsed.data;
const isProduction = raw.NODE_ENV === 'production';

if (raw.MAIL_DRIVER === 'smtp' && !raw.SMTP_HOST) {
  // eslint-disable-next-line no-console
  console.error('Invalid environment configuration:\n  - SMTP_HOST is required when MAIL_DRIVER=smtp');
  process.exit(1);
}

if (raw.WHATSAPP_DRIVER === 'cloud') {
  const missing = ['WHATSAPP_VERIFY_TOKEN', 'WHATSAPP_APP_SECRET', 'WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID'].filter((k) => !raw[k]);
  if (missing.length) {
    // eslint-disable-next-line no-console
    console.error(`Invalid environment configuration:\n  - WHATSAPP_DRIVER=cloud needs ${missing.join(', ')}`);
    process.exit(1);
  }
}

if (raw.NODE_ENV === 'production' && raw.ALLOW_DEV_DRIVERS !== 'true') {
  const problems = [];
  if (raw.MAIL_DRIVER === 'file') problems.push('MAIL_DRIVER=file would write emails to disk instead of sending them; set MAIL_DRIVER=smtp');
  if (raw.WHATSAPP_DRIVER === 'mock') problems.push('WHATSAPP_DRIVER=mock would never reach WhatsApp; set WHATSAPP_DRIVER=cloud');
  if (problems.length) {
    // eslint-disable-next-line no-console
    console.error(`Refusing to start in production:\n${problems.map((p) => `  - ${p}`).join('\n')}\n  (Set ALLOW_DEV_DRIVERS=true only for a staging server.)`);
    process.exit(1);
  }
}

const env = Object.freeze({
  ...raw,
  SMTP_SECURE: raw.SMTP_SECURE === 'true',
  NOTIFY_WORKER: raw.NOTIFY_WORKER === undefined ? raw.NODE_ENV !== 'test' : raw.NOTIFY_WORKER === 'true',
  APP_BASE_URL: raw.APP_BASE_URL || raw.CLIENT_ORIGIN,
  WHATSAPP_SBUS: raw.WHATSAPP_SBUS.split(',').map((v) => v.trim()).filter(Boolean),
  WHATSAPP_CATEGORIES: raw.WHATSAPP_CATEGORIES.split(',').map((v) => v.trim()).filter(Boolean),
  isProduction,
  isTest: raw.NODE_ENV === 'test',
  COOKIE_SECURE: raw.COOKIE_SECURE === undefined ? isProduction : raw.COOKIE_SECURE === 'true',
  TRUST_PROXY: raw.TRUST_PROXY === 'true',
});

export default env;
