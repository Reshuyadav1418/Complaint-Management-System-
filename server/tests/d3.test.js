import { describe, it, expect } from 'vitest';
import { useDatabase, makeUser, signIn, makeComplaint, models } from './helpers.js';

useDatabase();

const { Complaint, FishboneCause, CapaRecord, AuditLog, RootCauseAnalysis } = models;

/** A complaint whose D2 is complete, with its FRP signed in. */
async function readyForD3() {
  const qc = await makeUser({ roles: ['quality_coordinator'] });
  const frp = await makeUser({ roles: ['frp'], name: 'Ravi Kumar' });
  const complaint = await makeComplaint(qc);
  await Complaint.updateOne({ _id: complaint._id }, { status: 'D2_COMPLETED', stage: 'D2', frp: frp._id });
  return { qc, frp, complaint, agent: await signIn(frp) };
}

async function inD3() {
  const ctx = await readyForD3();
  const res = await ctx.agent.post(`/api/complaints/${ctx.complaint._id}/start-d3`).send({});
  expect(res.status).toBe(200);
  const url = `/api/complaints/${ctx.complaint._id}/d3`;
  return { ...ctx, url };
}

describe('starting D3', () => {
  it('only the assigned FRP starts it, and the analysis record is created with it', async () => {
    const { qc, complaint, agent } = await readyForD3();
    expect((await (await signIn(qc)).post(`/api/complaints/${complaint._id}/start-d3`).send({})).status).toBe(403);
    const otherFrp = await signIn(await makeUser({ roles: ['frp'] }));
    expect((await otherFrp.post(`/api/complaints/${complaint._id}/start-d3`).send({})).status).toBe(404);

    const res = await agent.post(`/api/complaints/${complaint._id}/start-d3`).send({});
    expect(res.body.data.complaint).toMatchObject({ status: 'D3_IN_PROGRESS', stage: 'D3' });
    expect(res.body.data.can.editD3).toBe(true);
    expect(await RootCauseAnalysis.countDocuments({ complaint: complaint._id })).toBe(1);
  });
});

describe('Why-Why analysis', () => {
  it('saves levels in order, keeps every version in the audit trail, and refuses stale saves', async () => {
    const { agent, url, complaint } = await inD3();
    const first = await agent.get(url);
    const v = first.body.data.analysis.__v;
    const steps = [
      { why: 'Why did the seal break?', because: 'Induction sealing temperature was low.' },
      { why: 'Why was the temperature low?', because: 'Sensor drifted after maintenance.' },
    ];
    const saved = await agent.patch(`${url}/analysis`).send({ version: v, methods: ['WHY_WHY', 'FISHBONE'], problemStatement: 'Broken seals on batch RB2409', whyWhy: steps });
    expect(saved.status).toBe(200);
    expect(saved.body.data.analysis.whyWhy.map((w) => [w.level, w.because])).toEqual([
      [1, 'Induction sealing temperature was low.'],
      [2, 'Sensor drifted after maintenance.'],
    ]);

    const v2 = saved.body.data.analysis.__v;
    await agent.patch(`${url}/analysis`).send({ version: v2, whyWhy: [steps[0]] }).expect(200);
    expect((await agent.patch(`${url}/analysis`).send({ version: v2, problemStatement: 'x' })).status).toBe(409);

    const logs = await AuditLog.find({ complaint: complaint._id, action: 'complaint.d3.analysis.update' }).sort({ at: 1 }).lean();
    expect(logs).toHaveLength(2);
    expect(logs[1].before.whyWhy).toHaveLength(2); // the earlier version is preserved
    expect(logs[1].after.whyWhy).toHaveLength(1);
  });
});

describe('fishbone causes', () => {
  it('are stored as data and returned as the tree the diagram is drawn from', async () => {
    const { agent, url } = await inD3();
    await agent.post(`${url}/causes`).send({ category: 'Machine', text: 'Induction sealer temperature drift' }).expect(200);
    await agent.post(`${url}/causes`).send({ category: 'Method', text: 'No seal integrity check at packing' }).expect(200);
    let res = await agent.post(`${url}/causes`).send({ category: 'Machine', text: 'Worn sealing head' });
    const machine = res.body.data.fishbone.Machine;
    expect(machine.map((c) => c.text)).toEqual(['Induction sealer temperature drift', 'Worn sealing head']);

    // A sub-cause inherits its parent's category, whatever the request says.
    res = await agent.post(`${url}/causes`).send({ category: 'Material', text: 'Sensor not recalibrated', parent: machine[0]._id });
    expect(res.body.data.fishbone.Machine[0].children.map((c) => c.text)).toEqual(['Sensor not recalibrated']);
    expect(res.body.data.fishbone.Material).toEqual([]);

    // Sub-causes cannot nest further.
    const sub = res.body.data.fishbone.Machine[0].children[0];
    expect((await agent.post(`${url}/causes`).send({ text: 'Too deep', parent: sub._id })).status).toBe(422);

    // Reopening the complaint returns the same diagram data.
    const again = await agent.get(url);
    expect(again.body.data.fishbone).toEqual(res.body.data.fishbone);
    expect(Object.keys(again.body.data.fishbone)).toEqual(['Manpower', 'Method', 'Machine', 'Material', 'Measurement', 'Mother Nature']);
  });

  it('edits, moves with sub-causes, and removes without losing history', async () => {
    const { agent, url, complaint } = await inD3();
    let res = await agent.post(`${url}/causes`).send({ category: 'Manpower', text: 'Operator untrained' });
    const main = res.body.data.fishbone.Manpower[0];
    await agent.post(`${url}/causes`).send({ text: 'New joiner', parent: main._id }).expect(200);

    res = await agent.patch(`${url}/causes/${main._id}`).send({ category: 'Method', text: 'No training procedure' });
    expect(res.body.data.fishbone.Manpower).toEqual([]);
    expect(res.body.data.fishbone.Method[0]).toMatchObject({ text: 'No training procedure', children: [{ text: 'New joiner' }] });

    res = await agent.delete(`${url}/causes/${main._id}`);
    expect(res.body.data.fishbone.Method).toEqual([]);
    expect(await FishboneCause.countDocuments({ complaint: complaint._id })).toBe(2); // soft-deleted, still stored
    const log = await AuditLog.findOne({ action: 'complaint.d3.cause.remove' }).lean();
    expect(log.summary).toBe('Removed cause under Method: No training procedure (and 1 sub-cause)');
  });

  it('rejects categories outside the six', async () => {
    const { agent, url } = await inD3();
    const res = await agent.post(`${url}/causes`).send({ category: 'Money', text: 'Budget cuts' });
    expect(res.status).toBe(422);
  });
});

describe('root causes and CAPA', () => {
  it('supports several root causes, each with its own numbered CAPA', async () => {
    const { agent, url, frp, complaint } = await inD3();
    await agent.post(`${url}/root-causes`).send({ category: 'Machine', description: 'Sealer temperature sensor out of calibration' }).expect(200);
    let res = await agent.post(`${url}/root-causes`).send({ category: 'Method', description: 'No in-process seal integrity check' });
    const [rc1, rc2] = res.body.data.rootCauses;

    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    res = await agent.post(`${url}/root-causes/${rc1._id}/capa`).send({
      capaRequired: true, category: 'Calibration', correctiveAction: 'Recalibrate sensor', preventiveAction: 'Monthly calibration check',
      responsiblePerson: String(frp._id), targetDate: tomorrow,
    });
    expect(res.status).toBe(200);
    res = await agent.post(`${url}/root-causes/${rc2._id}/capa`).send({ capaRequired: false, description: 'Covered by the calibration CAPA.' });

    const rcs = res.body.data.rootCauses;
    expect(rcs).toHaveLength(2);
    expect(rcs[0].capas[0]).toMatchObject({ capaNumber: `${complaint.complaintNumber}-CAPA-01`, actionStatus: 'NOT_STARTED', approvalStatus: 'PENDING', responsiblePerson: { name: 'Ravi Kumar' } });
    expect(rcs[1].capas[0]).toMatchObject({ capaNumber: `${complaint.complaintNumber}-CAPA-02`, actionStatus: 'NOT_REQUIRED' });
  });

  it('enforces CAPA rules with clear messages', async () => {
    const { agent, url } = await inD3();
    const res = await agent.post(`${url}/root-causes`).send({ category: 'Material', description: 'Seal liner from new supplier' });
    const rc = res.body.data.rootCauses[0];
    const missing = await agent.post(`${url}/root-causes/${rc._id}/capa`).send({ capaRequired: true });
    expect(missing.body.error.details.map((d) => d.field)).toEqual(['correctiveAction', 'responsiblePerson', 'targetDate']);
    const noReason = await agent.post(`${url}/root-causes/${rc._id}/capa`).send({ capaRequired: false });
    expect(noReason.body.error.details[0].field).toBe('description');
    const past = await agent.post(`${url}/root-causes/${rc._id}/capa`).send({ capaRequired: true, correctiveAction: 'x', responsiblePerson: String((await makeUser({})).id), targetDate: '2020-01-01' });
    expect(past.body.error.details.map((d) => d.message)).toContain('The target date cannot be in the past.');
  });

  it('removing a root cause removes its CAPA from view but keeps them stored', async () => {
    const { agent, url, frp } = await inD3();
    let res = await agent.post(`${url}/root-causes`).send({ category: 'Machine', description: 'Sealer head wear' });
    const rc = res.body.data.rootCauses[0];
    await agent.post(`${url}/root-causes/${rc._id}/capa`).send({ capaRequired: true, correctiveAction: 'Replace head', responsiblePerson: String(frp._id), targetDate: new Date(Date.now() + 86400000) }).expect(200);
    res = await agent.delete(`${url}/root-causes/${rc._id}`);
    expect(res.body.data.rootCauses).toEqual([]);
    expect(await CapaRecord.countDocuments({ deletedAt: { $ne: null } })).toBe(1);
  });

  it('CAPA edits are versioned and audited', async () => {
    const { agent, url, frp } = await inD3();
    let res = await agent.post(`${url}/root-causes`).send({ category: 'Machine', description: 'Sealer head wear' });
    res = await agent.post(`${url}/root-causes/${res.body.data.rootCauses[0]._id}/capa`).send({ capaRequired: true, correctiveAction: 'Replace head', responsiblePerson: String(frp._id), targetDate: new Date(Date.now() + 86400000) });
    const capa = res.body.data.rootCauses[0].capas[0];
    await agent.patch(`${url.replace('/d3', '/d3')}/capa/${capa._id}`).send({ version: capa.__v, actionStatus: 'IN_PROGRESS' }).expect(200);
    expect((await agent.patch(`${url}/capa/${capa._id}`).send({ version: capa.__v, actionStatus: 'COMPLETED' })).status).toBe(409);
    const log = await AuditLog.findOne({ action: 'complaint.d3.capa.update' }).lean();
    expect(log.after).toEqual({ actionStatus: 'IN_PROGRESS' });
  });
});

describe('who can change D3, and when', () => {
  it('a reassigned former FRP and the coordinator cannot edit; an admin can', async () => {
    const { url, complaint, frp } = await inD3();
    const qc = await signIn(await makeUser({ roles: ['quality_coordinator'] }));
    expect((await qc.post(`${url}/causes`).send({ category: 'Machine', text: 'Sneaky edit' })).status).toBe(403);
    expect((await qc.get(url)).body.data.canEdit).toBe(false); // can read

    const newFrp = await makeUser({ roles: ['frp'] });
    await Complaint.updateOne({ _id: complaint._id }, { frp: newFrp._id });
    expect((await (await signIn(frp)).post(`${url}/causes`).send({ category: 'Machine', text: 'Old FRP edit' })).status).toBe(404);
    expect((await (await signIn(newFrp)).post(`${url}/causes`).send({ category: 'Machine', text: 'New FRP edit' })).status).toBe(200);

    const admin = await signIn(await makeUser({ roles: ['admin'] }));
    expect((await admin.post(`${url}/causes`).send({ category: 'Method', text: 'Admin covering for FRP' })).status).toBe(200);
  });

  it('nothing can be changed while waiting for approval, or before D3 starts', async () => {
    const { agent, url, complaint } = await inD3();
    await Complaint.updateOne({ _id: complaint._id }, { status: 'D3_PENDING_APPROVAL' });
    const res = await agent.post(`${url}/causes`).send({ category: 'Machine', text: 'Late edit' });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/waiting for approval/);

    const fresh = await readyForD3();
    expect((await fresh.agent.post(`/api/complaints/${fresh.complaint._id}/d3/causes`).send({ category: 'Machine', text: 'Too early' })).status).toBe(409);
  });
});
