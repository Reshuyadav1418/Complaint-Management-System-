import { describe, it, expect } from 'vitest';
import { useDatabase, makeUser, signIn } from './helpers.js';

useDatabase();

describe('role-based access is enforced on the server', () => {
  it('an employee cannot list, create or edit users, even by calling the API directly', async () => {
    const employee = await makeUser({ roles: ['employee'] });
    const victim = await makeUser({ roles: ['employee'] });
    const agent = await signIn(employee);

    expect((await agent.get('/api/users')).status).toBe(403);
    expect((await agent.post('/api/users').send({ name: 'X Y', email: 'x@example.test', roles: ['admin'] })).status).toBe(403);
    expect((await agent.patch(`/api/users/${victim._id}`).send({ roles: ['admin'] })).status).toBe(403);
    expect((await agent.patch(`/api/users/${employee._id}`).send({ roles: ['admin'] })).status).toBe(403);
  });

  it('a quality coordinator can use the assignment directory but not user management', async () => {
    const agent = await signIn(await makeUser({ roles: ['quality_coordinator'] }));
    expect((await agent.get('/api/users/directory')).status).toBe(200);
    expect((await agent.get('/api/users')).status).toBe(403);
  });

  it('an FRP cannot change role permissions', async () => {
    const agent = await signIn(await makeUser({ roles: ['frp'] }));
    const res = await agent.put('/api/roles/frp/permissions').send({ permissions: ['users.manage'] });
    expect(res.status).toBe(403);
  });

  it('a permission change applies to existing sessions', async () => {
    const admin = await signIn(await makeUser({ roles: ['admin'] }));
    const reviewer = await signIn(await makeUser({ roles: ['reviewer'] }));

    expect((await reviewer.get('/api/audit-logs')).status).toBe(200);
    await admin.put('/api/roles/reviewer/permissions').send({ permissions: ['complaint.view.all'] }).expect(200);
    expect((await reviewer.get('/api/audit-logs')).status).toBe(403);
    const me = await reviewer.get('/api/auth/me');
    expect(me.body.data.permissions).toEqual(['complaint.view.all']);
  });

  it('rejects unknown permissions and protects admin recovery', async () => {
    const admin = await signIn(await makeUser({ roles: ['admin'] }));
    expect((await admin.put('/api/roles/frp/permissions').send({ permissions: ['do.anything'] })).status).toBe(422);
    const res = await admin.put('/api/roles/admin/permissions').send({ permissions: ['users.manage'] });
    expect(res.status).toBe(400);
  });

  it('rejects state-changing requests from a foreign origin', async () => {
    const admin = await signIn(await makeUser({ roles: ['admin'] }));
    const res = await admin
      .post('/api/departments')
      .set('Origin', 'https://evil.example')
      .send({ name: 'Sneaky', code: 'SNK' });
    expect(res.status).toBe(403);
    const ok = await admin
      .post('/api/departments')
      .set('Origin', 'http://localhost:5173')
      .send({ name: 'Quality', code: 'QA' });
    expect(ok.status).toBe(201);
  });

  it('every signed-in user can read reference data', async () => {
    const agent = await signIn(await makeUser({ roles: ['employee'] }));
    const res = await agent.get('/api/meta');
    expect(res.status).toBe(200);
    expect(res.body.data.fishboneCategories).toHaveLength(6);
    expect(res.body.data.statuses.find((s) => s.key === 'D3_REWORK').stage).toBe('D3');
  });
});
