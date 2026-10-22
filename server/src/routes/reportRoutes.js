import { Router } from 'express';
import { z } from 'zod';
import * as reports from '../services/reportService.js';
import { requirePermission } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import { PERMISSIONS as P } from '../auth/permissions.js';
import { ok, requestContext } from '../utils/http.js';
import * as audit from '../services/auditService.js';

const query = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  sbu: z.string().trim().max(80).optional(),
  country: z.string().trim().max(80).optional(),
});

const r = Router();
r.use(requirePermission(P.REPORTS_VIEW));

r.get('/summary', validate({ query }), async (req, res) => ok(res, await reports.summary(req.validQuery, req.user, req.permissions)));

r.get('/complaints.csv', validate({ query }), async (req, res) => {
  const csv = await reports.complaintsCsv(req.validQuery, req.user, req.permissions);
  // Bulk exports of complaint data are recorded.
  await audit.record({ actor: req.user, action: 'report.export', entityType: 'Report', summary: 'Exported complaints to CSV', after: req.validQuery, context: requestContext(req) });
  res.set({
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="complaints-${new Date().toISOString().slice(0, 10)}.csv"`,
    'Cache-Control': 'no-store',
  });
  return res.send(csv);
});

export default r;
