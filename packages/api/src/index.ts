import 'dotenv/config';
import express from 'express';
import { createQueue } from './queue.js';
import { setupUsersRoutes } from './users/route.js';
import { setupDeliveriesRoutes } from './deliveries/route.js';
import { createDbPool } from '@bowled/db';
import { makeApiDb, type ApiDb } from './db.js';

export function createApp(deps: { redisUrl: string; db: ApiDb }) {
  const queue = createQueue(deps.redisUrl);
  const maxUploadBytes = Number(process.env.MAX_UPLOAD_BYTES ?? 83886080);

  const app = express();
  app.use(express.json({ limit: '1mb' }));

  // Set up modular domain routes
  setupUsersRoutes(app, deps.db);
  setupDeliveriesRoutes(app, deps.db);

  // 404 fallback
  app.use((_req: any, res: any) => res.status(404).json({ error: 'not found' }));

  return app;
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

const redisUrl = process.env.REDIS_URL;
if (!redisUrl) {
  console.error("FATAL: REDIS_URL must be set");
  process.exit(1);
}

// The API process owns its pool (created here, closed on shutdown).
const pool = createDbPool(
  process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : {},
);
const db = makeApiDb(pool);

const port = Number(process.env.PORT ?? 3000);
const server = createApp({ redisUrl, db }).listen(port, () => {
  console.log(`api listening on :${port}`);
});

process.once('SIGTERM', async () => {
  console.log('SIGTERM received — shutting down api...');
  server.close();
  await db.close();
  process.exit(0);
});
