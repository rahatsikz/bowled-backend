import 'dotenv/config';
import express from 'express';
import { createQueue } from './queue.js';
import { setupUsersRoutes } from './users/route.js';
import { setupDeliveriesRoutes } from './deliveries/route.js';
import { Pool } from 'pg';

export function createApp(deps: { redisUrl: string }) {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });
  const queue = createQueue(deps.redisUrl);
  const maxUploadBytes = Number(process.env.MAX_UPLOAD_BYTES ?? 83886080);

  const app = express();
  app.use(express.json({ limit: '1mb' }));

  // Set up modular domain routes
  setupUsersRoutes(app);
  setupDeliveriesRoutes(app);

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

const port = Number(process.env.PORT ?? 3000);
createApp({ redisUrl }).listen(port, () => {
  console.log(`api listening on :${port}`);
});