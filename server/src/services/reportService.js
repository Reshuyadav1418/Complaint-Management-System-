import { Complaint, RootCause, CapaRecord } from '../models/index.js';
import { STATUSES as S, STATUS_LABELS } from '../config/workflow.js';
import { visibilityFilter } from './complaintService.js';

/*
 * Reports. Every figure is calculated from live records, within what the
 * user is allowed to see, using these definitions:
 *
 *   Open                 any status other than Closed
 *   Resolution time      complaint date → closedAt, for closed complaints only
 *   Time to acknowledge  complaint date → D1 approval time
 *   Workload             open complaints per current FRP, plus all-time totals
 *   Overdue CAPA         target date passed and action not Completed,
 *                        Verified or Not required
 *   SLA                  needs stage deadlines, which need confirmed SLA rules
 *                        (OPEN_QUESTIONS Q6a); reported as "not configured"
 */

function baseMatch(scope, { from, to, sbu, country }) {
  const and = [scope];
  if (from || to) and.push({ complaintDate: { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) } });
  if (sbu) and.push({ sbu });
  if (country) and.push({ country });
  return { $and: and };
}

/** Count by a field; largest first, ties alphabetical, missing values last. */
const count = (field, match, label = (v) => v ?? 'Not recorded') =>
  Complaint.aggregate([{ $match: match }, { $group: { _id: `$${field}`, n: { $sum: 1 } } }]).then((rows) =>
    rows
      .map((r) => ({ key: r._id ?? null, label: label(r._id), count: r.n }))
      .sort((x, y) => y.count - x.count || (x.key === null) - (y.key === null) || x.label.localeCompare(y.label)),
  );

const HOURS = 3_600_000;

/*
 * Reports are cached for CACHE_MS per (visibility scope, filters). Many people
 * opening the reports page at once then cost one calculation, not one each.
 * The response says when the figures were calculated.
 */
const CACHE_MS = 60_000;
const cache = new Map();

export function clearReportCache() {
  cache.clear();
}

export async function summary(query, user, permissions) {
  const scope = await visibilityFilter(user, permissions);
  const key = JSON.stringify({ scope, query });
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.promise;
  // Single-flight: requests arriving while this is being calculated share the
  // same promise instead of each starting the same heavy calculation.
  if (cache.size > 500) cache.clear();
  const promise = calculate(scope, query);
  cache.set(key, { at: Date.now(), promise });
  try {
    return await promise;
  } catch (err) {
    cache.delete(key); // never cache a failure
    throw err;
  }
}

async function calculate(scope, query) {
  const match = baseMatch(scope, query);
  const now = new Date();
  // With full visibility and no filters every complaint is in scope, so the
  // child collections need no complaint filter at all (avoids a 10,000-id $in).
  const unrestricted = Object.keys(scope).length === 0 && !query.from && !query.to && !query.sbu && !query.country;
  const inScope = unrestricted ? {} : { complaint: { $in: await Complaint.distinct('_id', match) } };

  const [total, byCategory, bySource, byStatus, bySbu, monthly, durations, workload, rootCauseCats, capaAction, capaApproval, capaOverdue, capaOverdueList] = await Promise.all([
    Complaint.countDocuments(match),
    count('category', match, (v) => v || 'Uncategorised'),
    count('origin', match),
    count('status', match, (v) => STATUS_LABELS[v] || v),
    count('sbu', match),
    Complaint.aggregate([
      { $match: match },
      { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$complaintDate', timezone: 'Asia/Kolkata' } }, n: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
    Complaint.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          closedN: { $sum: { $cond: [{ $ifNull: ['$closedAt', false] }, 1, 0] } },
          resolutionMs: { $sum: { $cond: [{ $ifNull: ['$closedAt', false] }, { $subtract: ['$closedAt', '$complaintDate'] }, 0] } },
          ackN: { $sum: { $cond: [{ $ifNull: ['$acknowledgement.approvedAt', false] }, 1, 0] } },
          ackMs: { $sum: { $cond: [{ $ifNull: ['$acknowledgement.approvedAt', false] }, { $subtract: ['$acknowledgement.approvedAt', '$complaintDate'] }, 0] } },
        },
      },
    ]),
    Complaint.aggregate([
      { $match: { $and: [match, { frp: { $ne: null } }] } },
      {
        $group: {
          _id: '$frp',
          open: { $sum: { $cond: [{ $ne: ['$status', S.CLOSED] }, 1, 0] } },
          closed: { $sum: { $cond: [{ $eq: ['$status', S.CLOSED] }, 1, 0] } },
          inRework: { $sum: { $cond: [{ $eq: ['$status', S.D3_REWORK] }, 1, 0] } },
        },
      },
      { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'u' } },
      { $project: { name: { $ifNull: [{ $first: '$u.name' }, 'Former user'] }, open: 1, closed: 1, inRework: 1 } },
      { $sort: { open: -1, name: 1 } },
    ]),
    RootCause.aggregate([
      { $match: { ...inScope, deletedAt: null } },
      { $group: { _id: '$category', n: { $sum: 1 } } },
      { $sort: { n: -1 } },
    ]),
    CapaRecord.aggregate([{ $match: { ...inScope, deletedAt: null } }, { $group: { _id: '$actionStatus', n: { $sum: 1 } } }]),
    CapaRecord.aggregate([{ $match: { ...inScope, deletedAt: null } }, { $group: { _id: '$approvalStatus', n: { $sum: 1 } } }]),
    CapaRecord.countDocuments({ ...inScope, deletedAt: null, capaRequired: true, targetDate: { $lt: now }, actionStatus: { $nin: ['COMPLETED', 'VERIFIED', 'NOT_REQUIRED'] } }),
    CapaRecord.find({ ...inScope, deletedAt: null, capaRequired: true, targetDate: { $lt: now }, actionStatus: { $nin: ['COMPLETED', 'VERIFIED', 'NOT_REQUIRED'] } })
      .sort({ targetDate: 1 })
      .limit(20)
      .populate('responsiblePerson', 'name')
      .populate('complaint', 'complaintNumber')
      .lean(),
  ]);

  const d = durations[0] || { closedN: 0, resolutionMs: 0, ackN: 0, ackMs: 0 };
  const open = total - (byStatus.find((r) => r.key === S.CLOSED)?.count || 0);
  const stat = (rows) => Object.fromEntries(rows.map((r) => [r._id, r.n]));

  return {
    filters: query,
    calculatedAt: now,
    total,
    openVsClosed: { open, closed: total - open },
    byCategory,
    bySource,
    byStatus,
    bySbu,
    monthly: monthly.map((m) => ({ month: m._id, count: m.n })),
    resolution: {
      closedCount: d.closedN,
      averageDays: d.closedN ? Math.round((d.resolutionMs / d.closedN / (24 * HOURS)) * 10) / 10 : null,
    },
    acknowledgement: {
      acknowledgedCount: d.ackN,
      averageHours: d.ackN ? Math.round((d.ackMs / d.ackN / HOURS) * 10) / 10 : null,
    },
    workload: workload.map((w) => ({ name: w.name, open: w.open, closed: w.closed, inRework: w.inRework })),
    rootCauseCategories: rootCauseCats.map((r) => ({ label: r._id, count: r.n })),
    capa: {
      byAction: stat(capaAction),
      byApproval: stat(capaApproval),
      overdue: capaOverdue,
      overdueList: capaOverdueList.map((c) => ({
        capaNumber: c.capaNumber,
        complaintId: c.complaint?._id,
        complaintNumber: c.complaint?.complaintNumber,
        responsible: c.responsiblePerson?.name,
        targetDate: c.targetDate,
        actionStatus: c.actionStatus,
      })),
    },
    sla: { configured: false, note: 'SLA deadlines are not configured yet, so SLA and escalation performance cannot be measured.' },
  };
}

/* ---------------- CSV export ---------------- */

/**
 * Spreadsheet-safe cell: quoted, and prefixed with ' when it starts with a
 * character Excel would treat as a formula (CSV injection).
 */
export function csvCell(value) {
  let s = value === null || value === undefined ? '' : value instanceof Date ? value.toISOString() : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

const COLUMNS = [
  ['Complaint number', (c) => c.complaintNumber],
  ['Complaint date', (c) => c.complaintDate?.toISOString().slice(0, 10)],
  ['Origin', (c) => c.origin],
  ['Requester', (c) => c.requester?.name],
  ['Reporter type', (c) => c.requester?.type],
  ['SBU', (c) => c.sbu],
  ['Country', (c) => c.country],
  ['Category', (c) => c.category],
  ['Product', (c) => c.d2?.verifiedProduct?.productName || c.reportedProduct?.name],
  ['Batch', (c) => c.d2?.verifiedProduct?.batchNumber || c.reportedProduct?.batchNumber],
  ['Short description', (c) => c.shortDescription],
  ['Stage', (c) => c.stage],
  ['Status', (c) => STATUS_LABELS[c.status]],
  ['Priority', (c) => c.priority],
  ['FRP', (c) => c.frp?.name],
  ['Type of failure', (c) => c.d2?.investigation?.typeOfFailure],
  ['RPN', (c) => c.d2?.investigation?.rpn],
  ['Acknowledged at', (c) => c.acknowledgement?.approvedAt],
  ['Closed at', (c) => c.closedAt],
  ['Last activity', (c) => c.lastActivityAt],
];

export async function complaintsCsv(query, user, permissions) {
  const scope = await visibilityFilter(user, permissions);
  const rows = await Complaint.find(baseMatch(scope, query)).sort({ complaintDate: -1 }).limit(20_000).populate('frp', 'name').lean();
  const lines = [COLUMNS.map(([h]) => csvCell(h)).join(',')];
  for (const c of rows) lines.push(COLUMNS.map(([, get]) => csvCell(get(c))).join(','));
  // BOM so Excel opens UTF-8 (₹, Hindi names) correctly.
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}
