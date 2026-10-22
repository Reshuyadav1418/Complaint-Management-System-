import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { useDatabase, app, makeUser, signIn, models, PASSWORD } from './helpers.js';

useDatabase();

describe('sign in', () => {
  it('sets an httpOnly session cookie and returns the user with permissions', async () => {
    const user = await makeUser({ roles: ['quality_coordinator'] });
    const res = await request(app).post('/api/auth/login').send({ email: user.email.toUpperCase(), password: PASSWORD });

    expect(res.status).toBe(200);
    const cookie = res.headers['set-cookie'][0];
    expect(cookie).toMatch(/^sfa_session=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(res.body.data.user.email).toBe(user.email);
    expect(res.body.data.user.passwordHash).toBeUndefined();
    expect(res.body.data.permissions).toContain('complaint.d1.acknowledge');
  });

  it('gives the same message for an unknown email and a wrong password', async () => {
    const user = await makeUser();
    const wrong = await request(app).post('/api/auth/login').send({ email: user.email, password: 'nope-nope-1' });
    const unknown = await request(app).post('/api/auth/login').send({ email: 'ghost@example.test', password: 'nope-nope-1' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error.message).toBe(unknown.body.error.message);
  });

  it('validates the request body', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'not-an-email' });
    expect(res.status).toBe(422);
    expect(res.body.error.details.map((d) => d.field)).toEqual(expect.arrayContaining(['email', 'password']));
  });

  it('locks the account after the configured number of failures, then rejects the right password', async () => {
    const user = await makeUser();
    for (let i = 0; i < 3; i += 1) {
      await request(app).post('/api/auth/login').send({ email: user.email, password: 'wrong-pass-1' });
    }
    const res = await request(app).post('/api/auth/login').send({ email: user.email, password: PASSWORD });
    expect(res.status).toBe(423);
    expect(res.body.error.code).toBe('ACCOUNT_LOCKED');
    const lockout = await models.AuditLog.findOne({ action: 'auth.lockout', entityId: user._id });
    expect(lockout).not.toBeNull();
  });

  it('rejects a deactivated account', async () => {
    const user = await makeUser({ isActive: false });
    const res = await request(app).post('/api/auth/login').send({ email: user.email, password: PASSWORD });
    expect(res.status).toBe(403);
  });
});

describe('session', () => {
  it('requires a session for protected routes', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('rejects a tampered token', async () => {
    const res = await request(app).get('/api/auth/me').set('Cookie', 'sfa_session=eyJhbGciOiJub25lIn0.e30.');
    expect(res.status).toBe(401);
  });

  it('logout clears the cookie', async () => {
    const agent = await signIn(await makeUser());
    const out = await agent.post('/api/auth/logout');
    expect(out.status).toBe(204);
    expect(out.headers['set-cookie'][0]).toMatch(/sfa_session=;/);
    expect((await agent.get('/api/auth/me')).status).toBe(401);
  });

  it('sign out everywhere ends other sessions', async () => {
    const user = await makeUser();
    const laptop = await signIn(user);
    const phone = await signIn(user);
    await laptop.post('/api/auth/logout-all');
    expect((await phone.get('/api/auth/me')).status).toBe(401);
  });

  it('deactivating a user ends their session immediately', async () => {
    const admin = await makeUser({ roles: ['admin'] });
    const user = await makeUser();
    const userAgent = await signIn(user);
    const adminAgent = await signIn(admin);
    await adminAgent.patch(`/api/users/${user._id}`).send({ isActive: false }).expect(200);
    expect((await userAgent.get('/api/auth/me')).status).toBe(401);
  });
});

describe('password change', () => {
  it('blocks the app until a temporary password is replaced', async () => {
    const user = await makeUser({ mustChangePassword: true, roles: ['admin'] });
    const agent = await signIn(user);

    expect((await agent.get('/api/auth/me')).status).toBe(200);
    const blocked = await agent.get('/api/users');
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');

    const changed = await agent.post('/api/auth/change-password').send({ currentPassword: PASSWORD, newPassword: 'Brand-new-pass-7' });
    expect(changed.status).toBe(200);
    expect(changed.body.data.user.mustChangePassword).toBe(false);
    expect((await agent.get('/api/users')).status).toBe(200);
  });

  it('enforces the password policy and checks the current password', async () => {
    const agent = await signIn(await makeUser());
    const weak = await agent.post('/api/auth/change-password').send({ currentPassword: PASSWORD, newPassword: 'short' });
    expect(weak.status).toBe(422);
    const wrong = await agent.post('/api/auth/change-password').send({ currentPassword: 'not-it-123', newPassword: 'Brand-new-pass-7' });
    expect(wrong.status).toBe(422);
    expect(wrong.body.error.details[0].field).toBe('currentPassword');
  });

  it('keeps the current session but ends others', async () => {
    const user = await makeUser();
    const here = await signIn(user);
    const elsewhere = await signIn(user);
    await here.post('/api/auth/change-password').send({ currentPassword: PASSWORD, newPassword: 'Brand-new-pass-7' }).expect(200);
    expect((await here.get('/api/auth/me')).status).toBe(200);
    expect((await elsewhere.get('/api/auth/me')).status).toBe(401);
  });
});
