import { describe, it, expect } from 'vitest';
import { useDatabase, makeUser, signIn, makeComplaint, complaintBody, models } from './helpers.js';

useDatabase();

const { Complaint, ComplaintAssignment, AuditLog } = models;

describe('registering a complaint', () => {
  it('creates it with a number, at acknowledgement pending, with history', async () => {
    const qc = await makeUser({ roles: ['quality_coordinator'], name: 'Priya QC' });
    const agent = await signIn(qc);
    const res = await agent.post('/api/complaints').send(complaintBody());

    expect(res.status).toBe(201);
    expect(res.body.data.complaintNumber).toMatch(/^CMP-\d{4}-000001$/);
    expect(res.body.data).toMatchObject({ origin: 'Phone', status: 'D1_ACK_PENDING', stage: 'D1' });

    const history = await agent.get(`/api/complaints/${res.body.data._id}/history`);
    expect(history.body.data.map((h) => h.action)).toEqual(['complaint.status.register', 'complaint.create']);
    expect(history.body.data[1].actorName).toBe('Priya QC');
  });

  it('returns field errors for bad input', async () => {
    const agent = await signIn(await makeUser({ roles: ['quality_coordinator'] }));
    const res = await agent.post('/api/complaints').send(
      complaintBody({ origin: 'WhatsApp', requester: { name: 'X', email: 'nope' }, sbu: '', complaintDate: '2099-01-01' }),
    );
    expect(res.status).toBe(422);
    const fields = res.body.error.details.map((d) => d.field);
    expect(fields).toEqual(expect.arrayContaining(['origin', 'requester.name', 'requester.email', 'sbu', 'complaintDate']));
    expect(await Complaint.countDocuments()).toBe(0);
  });

  it('is refused for roles without manual registration', async () => {
    const agent = await signIn(await makeUser({ roles: ['frp'] }));
    expect((await agent.post('/api/complaints').send(complaintBody())).status).toBe(403);
  });

  it('numbers stay unique when many arrive at once', async () => {
    const agent = await signIn(await makeUser({ roles: ['quality_coordinator'] }));
    const results = await Promise.all(Array.from({ length: 10 }, () => agent.post('/api/complaints').send(complaintBody())));
    expect(results.every((r) => r.status === 201)).toBe(true);
    expect(new Set(results.map((r) => r.body.data.complaintNumber)).size).toBe(10);
  });
});

describe('who can see which complaint', () => {
  it('an FRP sees only complaints assigned to them; others are 404, not 403', async () => {
    const qc = await makeUser({ roles: ['quality_coordinator'] });
    const frp = await makeUser({ roles: ['frp'] });
    const mine = await makeComplaint(qc);
    const notMine = await makeComplaint(qc);
    await Complaint.updateOne({ _id: mine._id }, { frp: frp._id });

    const agent = await signIn(frp);
    const list = await agent.get('/api/complaints');
    expect(list.body.data.map((c) => c.complaintNumber)).toEqual([mine.complaintNumber]);

    expect((await agent.get(`/api/complaints/${mine._id}`)).status).toBe(200);
    for (const path of ['', '/history', '/attachments']) {
      expect((await agent.get(`/api/complaints/${notMine._id}${path}`)).status).toBe(404);
    }
  });

  it('an active assignment (e.g. reviewer) also grants visibility; an ended one does not', async () => {
    const qc = await makeUser({ roles: ['quality_coordinator'] });
    const person = await makeUser({ roles: ['employee'] });
    const c = await makeComplaint(qc);
    const a = await ComplaintAssignment.create({ complaint: c._id, role: 'REVIEWER', assignee: person._id, assignedBy: qc._id });
    const agent = await signIn(person);
    expect((await agent.get(`/api/complaints/${c._id}`)).status).toBe(200);
    await ComplaintAssignment.updateOne({ _id: a._id }, { active: false });
    expect((await agent.get(`/api/complaints/${c._id}`)).status).toBe(404);
  });

  it('a user with no view permission cannot list at all', async () => {
    const qc = await makeUser({ roles: ['quality_coordinator'] });
    await makeComplaint(qc);
    const nobody = await makeUser({ roles: [] });
    const agent = await signIn(nobody);
    expect((await agent.get('/api/complaints')).status).toBe(403);
  });

  it('dashboard counts respect visibility', async () => {
    const qc = await makeUser({ roles: ['quality_coordinator'] });
    const frp = await makeUser({ roles: ['frp'] });
    const c = await makeComplaint(qc);
    await makeComplaint(qc);
    await Complaint.updateOne({ _id: c._id }, { frp: frp._id });

    const all = await (await signIn(qc)).get('/api/dashboard/summary');
    expect(all.body.data).toMatchObject({ total: 2, awaitingAcknowledgement: 2, closed: 0 });
    const own = await (await signIn(frp)).get('/api/dashboard/summary');
    expect(own.body.data).toMatchObject({ total: 1, assignedToMe: 1 });
  });
});

describe('listing', () => {
  it('searches, filters, sorts and pages', async () => {
    const qc = await makeUser({ roles: ['quality_coordinator'] });
    for (let i = 0; i < 12; i += 1) {
      await makeComplaint(qc, {
        country: i % 2 ? 'Kenya' : 'India',
        reportedProduct: { name: i === 7 ? 'Calcium Gel' : 'Rumicare Bolus', batchNumber: `B${100 + i}` },
      });
    }
    const agent = await signIn(qc);

    const page = await agent.get('/api/complaints?limit=5&page=3&sort=number&order=asc');
    expect(page.body.meta).toMatchObject({ total: 12, totalPages: 3 });
    expect(page.body.data.map((c) => c.complaintNumber.slice(-2))).toEqual(['11', '12']);

    const search = await agent.get('/api/complaints?search=calcium');
    expect(search.body.data).toHaveLength(1);
    expect((await agent.get('/api/complaints?search=B105')).body.data).toHaveLength(1);

    expect((await agent.get('/api/complaints?country=Kenya')).body.meta.total).toBe(6);
    expect((await agent.get('/api/complaints?status=D1_ACK_PENDING,CLOSED')).body.meta.total).toBe(12);
    expect((await agent.get('/api/complaints?status=MADE_UP')).status).toBe(422);
    expect((await agent.get('/api/complaints?search=(.*)')).status).toBe(200); // regex is escaped

    const filters = await agent.get('/api/complaints/filters');
    expect(filters.body.data).toEqual({ sbus: ['AHP-Rumicare'], countries: ['India', 'Kenya'] });
  });

  it('"mine" narrows to the user even for someone who sees everything', async () => {
    const admin = await makeUser({ roles: ['admin'] });
    const c = await makeComplaint(admin);
    await makeComplaint(admin);
    await Complaint.updateOne({ _id: c._id }, { frp: admin._id });
    const agent = await signIn(admin);
    expect((await agent.get('/api/complaints')).body.meta.total).toBe(2);
    expect((await agent.get('/api/complaints?mine=true')).body.meta.total).toBe(1);
  });
});

describe('editing D1 details', () => {
  it('saves changes, records only what changed, and clears emptied fields', async () => {
    const qc = await makeUser({ roles: ['quality_coordinator'] });
    const c = await makeComplaint(qc);
    const agent = await signIn(qc);

    const res = await agent.patch(`/api/complaints/${c._id}/d1`).send({
      version: c.__v,
      headQuarter: '',
      requester: { name: 'Sunil Traders Pvt Ltd', email: 'sunil@example.test', mobile: '' },
    });
    expect(res.status).toBe(200);
    const saved = res.body.data.complaint;
    expect(saved.requester).toEqual({ name: 'Sunil Traders Pvt Ltd', email: 'sunil@example.test', mobile: null });
    expect(saved.headQuarter).toBeNull();

    const log = await AuditLog.findOne({ complaint: c._id, action: 'complaint.d1.update' }).lean();
    expect(Object.keys(log.after).sort()).toEqual(['headQuarter', 'requester']);
  });

  it('saving the whole form with one change records only that change', async () => {
    const qc = await makeUser({ roles: ['quality_coordinator'] });
    const c = await makeComplaint(qc, { headQuarter: undefined, customer: undefined, requester: { name: 'Kisan Kendra', email: 'k@example.test' } });
    const agent = await signIn(qc);
    // What the browser sends: every field, empty ones as ''.
    await agent
      .patch(`/api/complaints/${c._id}/d1`)
      .send({
        version: c.__v,
        complaintDate: c.complaintDate,
        requester: { name: 'Kisan Kendra', email: 'k@example.test', mobile: '' },
        sbu: c.sbu,
        country: c.country,
        headQuarter: 'Lucknow',
        category: '',
        additionalRemarks: '',
        customer: { name: '', code: '' },
        reportedProduct: { name: 'Rumicare Bolus', batchNumber: 'RB2409' },
        shortDescription: c.shortDescription,
      })
      .expect(200);
    const log = await AuditLog.findOne({ complaint: c._id, action: 'complaint.d1.update' }).lean();
    expect(log.after).toEqual({ headQuarter: 'Lucknow' });
  });

  it('refuses a stale edit instead of overwriting someone else', async () => {
    const qc = await makeUser({ roles: ['quality_coordinator'] });
    const c = await makeComplaint(qc);
    const agent = await signIn(qc);
    await agent.patch(`/api/complaints/${c._id}/d1`).send({ version: c.__v, category: 'Packaging' }).expect(200);
    const stale = await agent.patch(`/api/complaints/${c._id}/d1`).send({ version: c.__v, category: 'Efficacy' });
    expect(stale.status).toBe(409);
    expect((await Complaint.findById(c._id)).category).toBe('Packaging');
  });

  it('is locked after acknowledgement and refused for roles that cannot edit D1', async () => {
    const qc = await makeUser({ roles: ['quality_coordinator'] });
    const frp = await makeUser({ roles: ['frp'] });
    const c = await makeComplaint(qc);
    await Complaint.updateOne({ _id: c._id }, { frp: frp._id });
    expect((await (await signIn(frp)).patch(`/api/complaints/${c._id}/d1`).send({ version: 1, category: 'x' })).status).toBe(403);

    await Complaint.updateOne({ _id: c._id }, { status: 'D1_ACKNOWLEDGED' });
    const fresh = await Complaint.findById(c._id);
    const res = await (await signIn(qc)).patch(`/api/complaints/${c._id}/d1`).send({ version: fresh.__v, category: 'x' });
    expect(res.status).toBe(409);
  });

  it('detail shows next actions and what this user may do', async () => {
    const qc = await makeUser({ roles: ['quality_coordinator'] });
    const c = await makeComplaint(qc);
    const res = await (await signIn(qc)).get(`/api/complaints/${c._id}`);
    expect(res.body.data.can).toMatchObject({ editD1: true, upload: true, editD2: false, assignFrp: false });
    expect(res.body.data.nextActions[0]).toMatchObject({ action: 'acknowledge', allowed: true, phase: 4 });
  });
});
