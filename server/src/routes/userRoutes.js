import { Router } from 'express';
import * as c from '../controllers/userController.js';
import { requirePermission, requireAnyPermission } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import { PERMISSIONS as P } from '../auth/permissions.js';
import { idParams } from '../validation/common.js';
import { createUserBody, updateUserBody, listUsersQuery, directoryQuery } from '../validation/userSchemas.js';

const r = Router();

// Directory of active users for assignment pickers: anyone who can assign
// people or manage users may read names and emails.
r.get(
  '/directory',
  requireAnyPermission(P.USERS_MANAGE, P.COMPLAINT_ASSIGN, P.COMPLAINT_D3_EDIT),
  validate({ query: directoryQuery }),
  c.directory,
);

r.use(requirePermission(P.USERS_MANAGE));
r.get('/', validate({ query: listUsersQuery }), c.list);
r.post('/', validate({ body: createUserBody }), c.create);
r.get('/:id', validate({ params: idParams }), c.get);
r.patch('/:id', validate({ params: idParams, body: updateUserBody }), c.update);
r.post('/:id/reset-password', validate({ params: idParams }), c.resetPassword);

export default r;
