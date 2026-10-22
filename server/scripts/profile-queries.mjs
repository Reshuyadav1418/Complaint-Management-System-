/**
 * Times the heaviest queries against the load-test database and prints their
 * query plans. Seed it first with scripts/perf-seed.js.
 *
 *   MONGODB_URI=x JWT_SECRET=<32+ chars> node scripts/profile-queries.mjs
 */
import mongoose from 'mongoose';
import * as M from '../src/models/index.js';
await mongoose.connect('mongodb://127.0.0.1:27017/sfa_cms_perf?replicaSet=rs0');
const t = async (label, fn) => { const s = performance.now(); const r = await fn(); console.log(label.padEnd(52), String(Math.round(performance.now() - s)).padStart(6), 'ms'); return r; };
const ex = async (label, q) => { const e = await q.explain('executionStats'); const st = e.executionStats || e[0]?.executionStats; const plan = JSON.stringify(e.queryPlanner?.winningPlan || {}); console.log('   plan:', label, '| docsExamined', st?.totalDocsExamined, '| keysExamined', st?.totalKeysExamined, '|', (plan.match(/"stage":"(\w+)"/g)||[]).slice(0,4).join(' ')); };
const match = { $and: [{}] };
await t('list: find sorted by lastActivityAt, limit 20', () => M.Complaint.find(match).sort({ lastActivityAt: -1, _id: -1 }).limit(20).lean());
await ex('list sort', M.Complaint.find(match).sort({ lastActivityAt: -1, _id: -1 }).limit(20));
await t('list: countDocuments (all)', () => M.Complaint.countDocuments(match));
const rx = /Broken seal/i;
await t('search: regex over 7 fields', () => M.Complaint.find({ $or: ['complaintNumber','requester.name','shortDescription','customer.name','reportedProduct.name','reportedProduct.batchNumber','d2.verifiedProduct.batchNumber'].map((f) => ({ [f]: rx })) }).limit(20).lean());
await t('dashboard: byStatus aggregate', () => M.Complaint.aggregate([{ $match: {} }, { $group: { _id: '$status', n: { $sum: 1 } } }]));
await t('dashboard: overdue (stageDueAt)', () => M.Complaint.countDocuments({ $and: [{}, { stageDueAt: { $type: 'date', $lt: new Date() } }, { status: { $ne: 'CLOSED' } }] }));
await ex('overdue', M.Complaint.find({ $and: [{ stageDueAt: { $type: 'date', $lt: new Date() } }, { status: { $ne: 'CLOSED' } }] }));
await t('dashboard: newLast24h', () => M.Complaint.countDocuments({ $and: [{}, { createdAt: { $gte: new Date(Date.now() - 864e5) } }] }));
const ids = await t('reports: distinct _id', () => M.Complaint.distinct('_id', match));
await t('reports: RootCause $in 10k ids', () => M.RootCause.aggregate([{ $match: { complaint: { $in: ids }, deletedAt: null } }, { $group: { _id: '$category', n: { $sum: 1 } } }]));
await t('reports: CAPA overdue count $in', () => M.CapaRecord.countDocuments({ complaint: { $in: ids }, deletedAt: null, capaRequired: true, targetDate: { $lt: new Date() }, actionStatus: { $nin: ['COMPLETED','VERIFIED','NOT_REQUIRED'] } }));
await t('reports: monthly $dateToString', () => M.Complaint.aggregate([{ $match: match }, { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$complaintDate', timezone: 'Asia/Kolkata' } }, n: { $sum: 1 } } }]));
await t('reports: workload $lookup', () => M.Complaint.aggregate([{ $match: { $and: [match, { frp: { $ne: null } }] } }, { $group: { _id: '$frp', open: { $sum: 1 } } }, { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'u' } }]));
await mongoose.disconnect();
