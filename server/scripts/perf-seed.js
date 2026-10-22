/**
 * Load-test data: N complaints with realistic spread, 40 FRPs, root causes,
 * CAPA and audit history. Writes to the database in MONGODB_URI, which must
 * end in _perf so it can never touch real data.
 *
 *   MONGODB_URI=mongodb://127.0.0.1:27017/sfa_cms_perf?replicaSet=rs0 node scripts/perf-seed.js 10000
 */
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import * as M from '../src/models/index.js';
import { ensureDefaultRoles } from '../src/services/roleService.js';

const N = Number(process.argv[2] || 10000);
const uri = process.env.MONGODB_URI;
if (!/_perf(\?|$)/.test(uri || '')) throw new Error('MONGODB_URI must point at a database whose name ends in _perf');

const pick = (a, i) => a[i % a.length];
const STATUSES = ['D1_ACK_PENDING', 'D1_ACKNOWLEDGED', 'D2_IN_PROGRESS', 'D2_COMPLETED', 'D3_IN_PROGRESS', 'D3_PENDING_APPROVAL', 'D3_REWORK', 'D3_APPROVED', 'CLOSED', 'CLOSED'];
const STAGE = { D1_ACK_PENDING: 'D1', D1_ACKNOWLEDGED: 'D1', D2_IN_PROGRESS: 'D2', D2_COMPLETED: 'D2', D3_IN_PROGRESS: 'D3', D3_PENDING_APPROVAL: 'D3', D3_REWORK: 'D3', D3_APPROVED: 'D3', CLOSED: 'CLOSED' };

await mongoose.connect(uri);
await mongoose.connection.dropDatabase();
await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
await ensureDefaultRoles();

const hash = await bcrypt.hash('Perf-pass-2026', 10);
const users = await M.User.insertMany([
  { name: 'Perf Admin', email: 'admin@perf.test', roles: ['admin'], passwordHash: hash, mustChangePassword: false },
  { name: 'Perf QC', email: 'qc@perf.test', roles: ['quality_coordinator'], passwordHash: hash, mustChangePassword: false },
  ...Array.from({ length: 40 }, (_, i) => ({ name: `FRP ${i + 1}`, email: `frp${i + 1}@perf.test`, roles: ['frp'], passwordHash: hash, mustChangePassword: false })),
]);
const frps = users.slice(2);

const start = new Date('2025-01-01').getTime();
const span = Date.now() - start;
const docs = Array.from({ length: N }, (_, i) => {
  const status = pick(STATUSES, i * 7 + (i % 3));
  const date = new Date(start + Math.floor((span * i) / N));
  return {
    complaintNumber: `CMP-${date.getFullYear()}-${String(i + 1).padStart(6, '0')}`,
    complaintDate: date,
    origin: pick(['WhatsApp', 'WhatsApp', 'Phone', 'Email', 'Web'], i),
    requester: { name: `Retailer ${i % 900}`, email: `r${i % 900}@perf.test`, type: pick(['Customer', 'Retailer', 'Distributor'], i) },
    sbu: pick(['AHP-Rumicare', 'AHP-Poultry', 'AHP-Aqua'], i),
    country: pick(['India', 'India', 'India', 'Kenya', 'Nepal', 'Bangladesh'], i),
    category: pick(['Packaging', 'Product quality', 'Efficacy', 'Labelling'], i * 3),
    shortDescription: `${pick(['Broken seal', 'Caked powder', 'Low efficacy reported', 'Label smudged', 'Short quantity'], i)} on batch B${1000 + (i % 400)}`,
    reportedProduct: { name: pick(['Rumicare Bolus', 'Rumicare Gel', 'Poultry Mix', 'Aqua Care'], i), batchNumber: `B${1000 + (i % 400)}` },
    status,
    stage: STAGE[status],
    frp: STATUSES.indexOf(status) >= 2 ? frps[i % frps.length]._id : undefined,
    acknowledgement: STATUSES.indexOf(status) >= 1 ? { approvedBy: users[1]._id, approvedAt: new Date(date.getTime() + ((i % 48) + 1) * 3600000) } : undefined,
    closedAt: status === 'CLOSED' ? new Date(date.getTime() + ((i % 30) + 3) * 86400000) : undefined,
    lastActivityAt: new Date(date.getTime() + 86400000),
  };
});
for (let i = 0; i < docs.length; i += 2000) await M.Complaint.insertMany(docs.slice(i, i + 2000), { ordered: false });
const complaints = await M.Complaint.find({}, { _id: 1, status: 1, frp: 1, complaintNumber: 1 }).lean();

const rcas = [];
const rcs = [];
const capas = [];
const logs = [];
for (const [i, c] of complaints.entries()) {
  for (let k = 0; k < 6; k += 1) logs.push({ at: new Date(), actorName: 'Perf QC', action: 'complaint.d1.update', entityType: 'Complaint', entityId: c._id, complaint: c._id, summary: 'Seed' });
  if (['D3_IN_PROGRESS', 'D3_PENDING_APPROVAL', 'D3_REWORK', 'D3_APPROVED', 'CLOSED'].includes(c.status)) {
    const rca = { _id: new mongoose.Types.ObjectId(), complaint: c._id, status: 'APPROVED', methods: ['FISHBONE'] };
    rcas.push(rca);
    for (let k = 0; k < 2; k += 1) {
      const rc = { _id: new mongoose.Types.ObjectId(), complaint: c._id, analysis: rca._id, category: pick(['Machine', 'Method', 'Material', 'Manpower'], i + k), description: 'Seed root cause' };
      rcs.push(rc);
      capas.push({ capaNumber: `${c.complaintNumber}-CAPA-0${k + 1}`, complaint: c._id, rootCause: rc._id, capaRequired: true, correctiveAction: 'Seed', responsiblePerson: c.frp, targetDate: new Date(Date.now() + ((i % 60) - 20) * 86400000), actionStatus: pick(['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'VERIFIED'], i + k), approvalStatus: 'APPROVED' });
    }
  }
}
const batch = async (Model, rows) => { for (let i = 0; i < rows.length; i += 5000) await Model.insertMany(rows.slice(i, i + 5000), { ordered: false }); };
await batch(M.RootCauseAnalysis, rcas);
await batch(M.RootCause, rcs);
await batch(M.CapaRecord, capas);
await batch(M.AuditLog, logs);
console.log(`Seeded ${complaints.length} complaints, ${rcs.length} root causes, ${capas.length} CAPA, ${logs.length} audit entries, ${users.length} users.`);
await mongoose.disconnect();
