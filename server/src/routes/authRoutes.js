import { Router } from 'express';
import * as c from '../controllers/authController.js';
import { authenticate } from '../middleware/authenticate.js';
import { validate } from '../middleware/validate.js';
import { loginLimiter } from '../middleware/rateLimits.js';
import { loginBody, changePasswordBody } from '../validation/authSchemas.js';

const r = Router();

r.post('/login', loginLimiter, validate({ body: loginBody }), c.login);
r.post('/logout', c.logout);
// The routes below work even while a password change is pending.
r.get('/me', authenticate, c.me);
r.post('/logout-all', authenticate, c.logoutAll);
r.post('/change-password', authenticate, validate({ body: changePasswordBody }), c.changePassword);

export default r;
