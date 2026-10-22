import express from 'express';
import mongoose from 'mongoose';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { pinoHttp } from 'pino-http';
import env from './config/env.js';
import logger from './config/logger.js';
import { authenticate } from './middleware/authenticate.js';
import { requirePasswordChanged } from './middleware/authorize.js';
import { originCheck } from './middleware/originCheck.js';
import { apiLimiter, webhookLimiter as rateLimitWebhook } from './middleware/rateLimits.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import authRoutes from './routes/authRoutes.js';
import userRoutes from './routes/userRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import complaintRoutes from './routes/complaintRoutes.js';
import notificationRoutes from './routes/notificationRoutes.js';
import whatsappRoutes from './routes/whatsappRoutes.js';
import simulatorRoutes from './routes/simulatorRoutes.js';
import reportRoutes from './routes/reportRoutes.js';
import { dashboard } from './controllers/complaintController.js';

export function createApp() {
  const app = express();

  if (env.TRUST_PROXY) app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(helmet());
  app.use(cors({ origin: env.CLIENT_ORIGIN, credentials: true }));
  if (!env.isTest) app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/api/health' } }));

  // Liveness: the process is up. Readiness: it can reach the database.
  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
  app.get('/api/health/ready', async (_req, res) => {
    try {
      if (mongoose.connection.readyState !== 1) throw new Error('not connected');
      await mongoose.connection.db.admin().ping();
      return res.json({ status: 'ready' });
    } catch {
      return res.status(503).json({ status: 'unavailable' });
    }
  });

  // API responses carry personal and complaint data: never cache them.
  app.use('/api', (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  // WhatsApp webhook: before JSON parsing and the origin check, because it
  // needs the raw body for signature verification and is called by Meta.
  app.use('/api/webhooks/whatsapp', rateLimitWebhook, whatsappRoutes);

  app.use(express.json({ limit: '200kb' }));
  app.use(cookieParser());
  app.use('/api', apiLimiter, originCheck);

  app.use('/api/auth', authRoutes);

  // Everything below requires a session and a non-temporary password.
  app.use('/api', authenticate, requirePasswordChanged);
  app.use('/api/users', userRoutes);
  app.use('/api/complaints', complaintRoutes);
  app.use('/api/notifications', notificationRoutes);
  app.use('/api/dev/whatsapp', simulatorRoutes);
  app.use('/api/reports', reportRoutes);
  app.get('/api/dashboard/summary', dashboard);
  app.use('/api', adminRoutes);

  app.use('/api', notFound);
  app.use(errorHandler);
  return app;
}
