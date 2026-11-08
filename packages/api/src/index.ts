import 'dotenv/config';
import express from 'express';
import { createQueue } from './queue.js';
import { ensureSchema } from './users/db.js';
import { setupUsersRoutes } from './users/route.js';
import { setupDeliveriesRoutes } from './deliveries/route.js';
import { Pool } from 'pg';

export function createApp(deps: { redisUrl: string }) {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });
  const queue = createQueue(deps.redisUrl);
  const maxUploadBytes = Number(process.env.MAX_UPLOAD_BYTES ?? 83886080);

  // Ensure schema on first request (best-effort; won't block server start)
  ensureSchema().catch(console.warn);

  const app = express();
  app.use(express.json({ limit: '1mb' }));

  // Set up modular domain routes
  setupUsersRoutes(app);
  setupDeliveriesRoutes(app);

  // 404 fallback
  app.use((_req: any, res: any) => res.status(404).json({ error: 'not found' }));

  return app;
}