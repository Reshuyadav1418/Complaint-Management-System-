import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { useDatabase, app, makeUser, signIn, models } from './helpers.js';

useDatabase();

async function adminAgent() {
  const admin = await makeUser({ roles: ['admin'], name: 'Asha Admin' });
  return { admin, agent: await signIn(admin) };
}

describe('user management', () => {
  it('creates a user with a one-time temporary password', async () => {
    const { agent } = await adminAgent();
    const dept = await models.Department.create({ name: 'Quality Assurance', code: 'QA' });

    const res = await agent.post('/api/users').send({
      name: 'Ravi Kumar',
      email: 'Ravi.Kumar@Example.test',
      employeeId: 'E1001',
      department: String(dept._id),
      roles: ['frp'],
    });

    expect(res.status).toBe(201);
    const { user, temporaryPassword } = res.body.data;
    expect(user.email).toBe('ravi.kumar@example.test');
    expect(user.department.code).toBe('QA');
    expect(user.mustChangePassword).toBe(true);
    expect(temporaryPassword).toMatch(/[A-Za-z]/);

    const login = await request(app).post('/api/auth/login').send({ email: user.email, password: temporaryPassword });
    expect(login.status).toBe(200);
    expect(login.body.data.user.mustChangePassword).toBe(true);

    const stored = await models.User.findById(user._id).select('+passwordHash').lean();
    expect(stored.passwordHash).not.toContain(temporaryPassword);
  });

  it('reports duplicate email and employee ID as field errors', async () => {
    const { agent } = await adminAgent();
    await makeUser({ email: 'taken@example.test' });
    const dupEmail = await agent.post('/api/users').send({ name: 'Dup Email', email: 'taken@example.test', roles: ['employee'] });
    expect(dupEmail.status).toBe(422);
    expect(dupEmail.body.error.details[0].field).toBe('email');

    await agent.post('/api/users').send({ name: 'First', email: 'first@example.test', employeeId: 'E9', roles: ['employee'] }).expect(201);
    const dupId = await agent.post('/api/users').send({ name: 'Second', email: 'second@example.test', employeeId: 'E9', roles: ['employee'] });
    expect(dupId.status).toBe(422);
    expect(dupId.body.error.details[0].field).toBe('employeeId');
  });

  it('rejects unknown roles and inactive departments', async () => {
    const { agent } = await adminAgent();
    const badRole = await agent.post('/api/users').send({ name: 'No Role', email: 'nr@example.test', roles: ['superuser'] });
    expect(badRole.status).toBe(422);
    const dept = await models.Department.create({ name: 'Old', code: 'OLD', isActive: false });
    const badDept = await agent.post('/api/users').send({ name: 'Old Dept', email: 'od@example.test', roles: ['employee'], department: String(dept._id) });
    expect(badDept.status).toBe(422);
  });

  it('never leaves the system without an active administrator', async () => {
    const { admin, agent } = await adminAgent();
    expect((await agent.patch(`/api/users/${admin._id}`).send({ isActive: false })).status).toBe(409);
    expect((await agent.patch(`/api/users/${admin._id}`).send({ roles: ['employee'] })).status).toBe(409);

    const second = await makeUser({ roles: ['admin'] });
    const secondAgent = await signIn(second);
    // With another admin present, one admin may demote the other...
    expect((await secondAgent.patch(`/api/users/${admin._id}`).send({ roles: ['employee'] })).status).toBe(200);
    // ...but the last one standing cannot be demoted by anyone.
    const third = await makeUser({ roles: ['admin'] });
    await models.User.updateOne({ _id: third._id }, { isActive: false });
    const r = await secondAgent.patch(`/api/users/${second._id}`).send({ roles: ['employee'] });
    expect(r.status).toBe(409);
  });

  it('records an audit trail of changes without secrets', async () => {
    const { agent } = await adminAgent();
    const created = await agent.post('/api/users').send({ name: 'Meera Shah', email: 'meera@example.test', roles: ['employee'], password: 'Initial-pass-11' });
    const id = created.body.data.user._id;
    await agent.patch(`/api/users/${id}`).send({ roles: ['frp', 'employee'], designation: 'QA Officer' }).expect(200);

    const logs = await models.AuditLog.find({ entityId: id }).sort({ at: 1 }).lean();
    expect(logs.map((l) => l.action)).toEqual(['user.create', 'user.update']);
    expect(logs[0].actorName).toBe('Asha Admin');
    expect(JSON.stringify(logs)).not.toMatch(/Initial-pass-11|passwordHash/);
    expect(logs[1].before).toEqual({ roles: ['employee'] });
    expect(logs[1].after).toEqual({ designation: 'QA Officer', roles: ['frp', 'employee'] });
  });

  it('does not write an audit entry when nothing changed', async () => {
    const { agent } = await adminAgent();
    const user = await makeUser({ name: 'Same Name' });
    await agent.patch(`/api/users/${user._id}`).send({ name: 'Same Name' }).expect(200);
    expect(await models.AuditLog.countDocuments({ entityId: user._id })).toBe(0);
  });

  it('password reset unlocks the account and ends its sessions', async () => {
    const { agent } = await adminAgent();
    const user = await makeUser();
    const userAgent = await signIn(user);
    await models.User.updateOne({ _id: user._id }, { lockUntil: new Date(Date.now() + 600_000) });

    const res = await agent.post(`/api/users/${user._id}/reset-password`);
    expect(res.status).toBe(200);
    expect((await userAgent.get('/api/auth/me')).status).toBe(401);
    const login = await request(app).post('/api/auth/login').send({ email: user.email, password: res.body.data.temporaryPassword });
    expect(login.status).toBe(200);
  });

  it('lists with search, filters and pagination', async () => {
    const { agent } = await adminAgent();
    for (let i = 0; i < 25; i += 1) await makeUser({ name: `Field Officer ${String(i).padStart(2, '0')}`, roles: ['frp'] });
    await makeUser({ name: 'Inactive Person', isActive: false });

    const page2 = await agent.get('/api/users?role=frp&limit=10&page=2');
    expect(page2.body.data).toHaveLength(10);
    expect(page2.body.meta).toMatchObject({ page: 2, limit: 10, total: 25, totalPages: 3 });

    const search = await agent.get('/api/users?search=officer 07');
    expect(search.body.data.map((u) => u.name)).toEqual(['Field Officer 07']);

    const inactive = await agent.get('/api/users?status=inactive');
    expect(inactive.body.data.map((u) => u.name)).toEqual(['Inactive Person']);

    expect((await agent.get('/api/users?limit=500')).status).toBe(422);
    expect((await agent.get('/api/users/not-an-id')).status).toBe(422);
  });
});
