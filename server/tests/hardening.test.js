import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import request from 'supertest';
import { useDatabase, app, makeUser, signIn } from './helpers.js';

useDatabase();

function startWith(env) {
  return spawnSync(process.execPath, ['-e', "import('./src/config/env.js')"], {
    cwd: process.cwd(),
    env: { PATH: process.env.PATH, MONGODB_URI: 'mongodb://x', JWT_SECRET: 'x'.repeat(40), ...env },
    encoding: 'utf8',
    timeout: 10_000,
  });
}

describe('production safety', () => {
  it('refuses to start in production with development mail or WhatsApp drivers', () => {
    const r = startWith({ NODE_ENV: 'production', MAIL_DRIVER: 'file', WHATSAPP_DRIVER: 'mock' });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('MAIL_DRIVER=file');
    expect(r.stderr).toContain('WHATSAPP_DRIVER=mock');
  });

  it('allows them on a staging server only when explicitly enabled', () => {
    const r = startWith({ NODE_ENV: 'production', MAIL_DRIVER: 'file', WHATSAPP_DRIVER: 'mock', ALLOW_DEV_DRIVERS: 'true' });
    expect(r.status).toBe(0);
  });

  it('refuses a short session secret and real WhatsApp without credentials', () => {
    expect(startWith({ JWT_SECRET: 'short' }).stderr).toContain('JWT_SECRET must be at least 32 characters');
    expect(startWith({ WHATSAPP_DRIVER: 'cloud' }).stderr).toContain('WHATSAPP_DRIVER=cloud needs');
  });
});

describe('HTTP hardening', () => {
  it('API responses are never cached and carry security headers', async () => {
    const agent = await signIn(await makeUser({ roles: ['admin'] }));
    const res = await agent.get('/api/users');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['strict-transport-security']).toMatch(/max-age/);
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('readiness reports the database connection', async () => {
    const res = await request(app).get('/api/health/ready');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ready');
  });

  it('unexpected errors do not leak internals', async () => {
    const res = await request(app).post('/api/auth/login').set('Content-Type', 'application/json').send('{"email":');
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toMatch(/at .*\.js|SyntaxError|stack/);
  });

  it('rejects oversized JSON bodies', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'a@b.c', password: 'x'.repeat(300_000) });
    expect(res.status).toBe(413);
  });

  it('query operators cannot be smuggled into lookups', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: { $ne: null }, password: { $ne: null } });
    expect(res.status).toBe(422);
  });
});
