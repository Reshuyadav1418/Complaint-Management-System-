import { describe, it, expect } from 'vitest';
import { useDatabase, makeUser, signIn, makeComplaint, models } from './helpers.js';
import { csvCell } from '../src/services/reportService.js';

useDatabase();

const { Complaint, RootCause, CapaRecord, RootCauseAnalysis } = models;
const days = (n) => new Date(Date.now() + n * 86400000);

async function seed() {
  const qc = await makeUser({ roles: ['quality_coordinator'] });
  const frp = await makeUser({ roles: ['frp'], name: 'Ravi Kumar' });
  const make = (o) => makeComplaint(qc, o);
  const a = await make({ category: 'Packaging', origin: 'Phone', complaintDate: days(-10) });
  const b = await make({ category: 'Packaging', complaintDate: days(-6) });
  const c = await make({ category: 'Efficacy', complaintDate: days(-4) });
  const d = await make({ category: undefined, country: 'Kenya', complaintDate: days(-2) });
  // a closed after 4 days; b acknowledged 12 hours after receipt
  await Complaint.updateOne({ _id: a._id }, { status: 'CLOSED', stage: 'CLOSED', closedAt: new Date(a.complaintDate.getTime() + 4 * 86400000), frp: frp._id });
  await Complaint.updateOne({ _id: b._id }, { status: 'D3_REWORK', stage: 'D3', frp: frp._id, 'acknowledgement.approvedAt': new Date(b.complaintDate.getTime() + 12 * 3600000) });
  const rca = await RootCauseAnalysis.create({ complaint: b._id });
  const rc1 = await RootCause.create({ complaint: b._id, analysis: rca._id, category: 'Machine', description: 'Sealer drift' });
  await RootCause.create({ complaint: b._id, analysis: rca._id, category: 'Machine', description: 'Worn head' });
  await RootCause.create({ complaint: b._id, analysis: rca._id, category: 'Method', description: 'No check' });
  await CapaRecord.create({ capaNumber: 'X-1', complaint: b._id, rootCause: rc1._id, capaRequired: true, correctiveAction: 'Fix', responsiblePerson: frp._id, targetDate: days(-1), actionStatus: 'IN_PROGRESS' });
  await CapaRecord.create({ capaNumber: 'X-2', complaint: b._id, rootCause: rc1._id, capaRequired: true, correctiveAction: 'Fix', responsiblePerson: frp._id, targetDate: days(-1), actionStatus: 'COMPLETED' });
  await CapaRecord.create({ capaNumber: 'X-3', complaint: b._id, rootCause: rc1._id, capaRequired: false, description: 'n/a', actionStatus: 'NOT_REQUIRED' });
  return { qc, frp, a, b, c, d };
}

describe('reports', () => {
  it('calculates each figure from the records', async () => {
    const { qc } = await seed();
    const r = (await (await signIn(qc)).get('/api/reports/summary')).body.data;
    expect(r.total).toBe(4);
    expect(r.openVsClosed).toEqual({ open: 3, closed: 1 });
    expect(r.byCategory.map((x) => [x.label, x.count])).toEqual([['Packaging', 2], ['Efficacy', 1], ['Uncategorised', 1]]);
    expect(r.bySource.find((x) => x.key === 'Phone').count).toBe(4);
    expect(r.resolution).toEqual({ closedCount: 1, averageDays: 4 });
    expect(r.acknowledgement).toEqual({ acknowledgedCount: 1, averageHours: 12 });
    expect(r.workload).toEqual([{ name: 'Ravi Kumar', open: 1, closed: 1, inRework: 1 }]);
    expect(r.rootCauseCategories).toEqual([{ label: 'Machine', count: 2 }, { label: 'Method', count: 1 }]);
    expect(r.capa.byAction).toEqual({ IN_PROGRESS: 1, COMPLETED: 1, NOT_REQUIRED: 1 });
    expect(r.capa.overdue).toBe(1); // completed and not-required ones are not overdue
    expect(r.capa.overdueList[0]).toMatchObject({ capaNumber: 'X-1', responsible: 'Ravi Kumar' });
    expect(r.sla.configured).toBe(false);
  });

  it('serves a cached result for a minute, per scope and filters', async () => {
    const { qc } = await seed();
    const agent = await signIn(qc);
    const first = (await agent.get('/api/reports/summary')).body.data;
    await makeComplaint(qc, {});
    const second = (await agent.get('/api/reports/summary')).body.data;
    expect(second.total).toBe(first.total);
    expect(second.calculatedAt).toBe(first.calculatedAt);
    expect((await agent.get('/api/reports/summary?country=India')).body.data.total).toBe(4); // other filters calculate fresh
  });

  it('filters by date and country', async () => {
    const { qc } = await seed();
    const agent = await signIn(qc);
    expect((await agent.get(`/api/reports/summary?from=${days(-5).toISOString()}`)).body.data.total).toBe(2);
    expect((await agent.get('/api/reports/summary?country=Kenya')).body.data.total).toBe(1);
  });

  it('requires the reports permission and respects visibility', async () => {
    const { frp } = await seed();
    expect((await (await signIn(frp)).get('/api/reports/summary')).status).toBe(403);
    // A role with reports.view but only assigned visibility sees only its complaints.
    const admin = await signIn(await makeUser({ roles: ['admin'] }));
    await admin.put('/api/roles/frp/permissions').send({ permissions: ['complaint.view.assigned', 'complaint.d3.edit', 'reports.view'] }).expect(200);
    const r = (await (await signIn(frp)).get('/api/reports/summary')).body.data;
    expect(r.total).toBe(2);
  });

  it('exports CSV that is safe to open in Excel, and records the export', async () => {
    const qc = await makeUser({ roles: ['quality_coordinator'] });
    await makeComplaint(qc, { shortDescription: '=HYPERLINK("http://evil","click")', requester: { name: 'Shah, "Tiwari" & Co' } });
    const res = await (await signIn(qc)).get('/api/reports/complaints.csv').buffer(true);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    const body = res.text;
    expect(body.charCodeAt(0)).toBe(0xfeff);
    expect(body).toContain('"Complaint number","Complaint date"');
    expect(body).toContain(`"'=HYPERLINK(""http://evil"",""click"")"`);
    expect(body).toContain('"Shah, ""Tiwari"" & Co"');
    expect(await models.AuditLog.countDocuments({ action: 'report.export' })).toBe(1);
    expect(csvCell('-1+2')).toBe(`"'-1+2"`);
  });
});
