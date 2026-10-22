import env from './config/env.js';
import logger from './config/logger.js';
import { connectDatabase, disconnectDatabase } from './config/db.js';
import { ensureDefaultRoles } from './services/roleService.js';
import { createApp } from './app.js';
import { startWorker, stopWorker } from './services/notificationService.js';

async function main() {
  await connectDatabase();
  await ensureDefaultRoles();
  const app = createApp();
  if (env.NOTIFY_WORKER) startWorker();
  const server = app.listen(env.PORT, () => logger.info(`API listening on http://localhost:${env.PORT}`));
  // Bound slow or stalled requests. Uploads of several files need the longest.
  server.requestTimeout = 120_000;
  server.headersTimeout = 30_000;
  server.keepAliveTimeout = 65_000; // above typical load balancer idle timeouts

  const shutdown = (signal) => {
    logger.info({ signal }, 'Shutting down');
    stopWorker();
    server.close(async () => {
      await disconnectDatabase();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  logger.fatal({ err }, 'Failed to start');
  process.exit(1);
});
