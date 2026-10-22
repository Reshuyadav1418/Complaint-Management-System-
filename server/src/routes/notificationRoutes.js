import { Router } from 'express';
import { z } from 'zod';
import * as c from '../controllers/notificationController.js';
import { requirePermission } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import { PERMISSIONS as P } from '../auth/permissions.js';
import { idParams, pageQuery } from '../validation/common.js';
import { NOTIFICATION_TYPES } from '../models/Notification.js';

const listQuery = z.object({
  ...pageQuery,
  status: z.enum(['QUEUED', 'SENT', 'DELIVERED', 'FAILED']).optional(),
  type: z.enum(NOTIFICATION_TYPES).optional(),
  search: z.string().trim().max(100).optional(),
});

import * as inApp from '../services/inAppNotificationService.js';

const r = Router();

// In-app notifications for the logged-in user (bell icon dropdown)
r.get('/in-app', async (req, res, next) => {
  try {
    const data = await inApp.listForUser(req.user._id);
    res.json({ data });
  } catch (err) {
    next(err);
  }
});

r.post('/in-app/mark-all-read', async (req, res, next) => {
  try {
    await inApp.markAllRead(req.user._id);
    res.json({ status: 'ok' });
  } catch (err) {
    next(err);
  }
});

r.post('/in-app/:id/read', validate({ params: idParams }), async (req, res, next) => {
  try {
    await inApp.markRead(req.params.id, req.user._id);
    res.json({ status: 'ok' });
  } catch (err) {
    next(err);
  }
});

r.get('/', requirePermission(P.NOTIFICATIONS_VIEW), validate({ query: listQuery }), c.list);
r.get('/:id', requirePermission(P.NOTIFICATIONS_VIEW), validate({ params: idParams }), c.get);
r.post('/:id/retry', requirePermission(P.NOTIFICATIONS_RETRY), validate({ params: idParams }), c.retry);
export default r;
