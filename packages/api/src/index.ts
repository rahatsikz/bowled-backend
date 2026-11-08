import 'dotenv/config';
import express from 'express';
import { createQueue } from './queue.js';
import {
  ensureSchema,
  upsertUserByKey,
  upsertDevice,
  insertDelivery,
  getDeliveryWithReport,
} from './db.js';
import { Pool } from 'pg';
import { makeApiDb } from './db.js';

export function createApp(deps: { redisUrl: string }) {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });
  const db = makeApiDb(pool);
  const queue = createQueue(deps.redisUrl);
  const maxUploadBytes = Number(process.env.MAX_UPLOAD_BYTES ?? 83886080);

  // Ensure schema on first request (best-effort; won't block server start)
  ensureSchema().catch(console.warn);

  const app = express();
  app.use(express.json({ limit: '1mb' }));

  // Device registration (minimal key-based auth)
  app.post('/devices', express.json(), async (req: any, res: any) => {
    const { pushToken } = req.body;
    if (!pushToken) return res.status(400).json({ error: 'pushToken required' });
    const userKey = req.headers['x-user-key'] as string;
    if (!userKey) return res.status(401).json({ error: 'x-user-key required' });
    const { id: userId } = await upsertUserByKey(userKey);
    const deviceId = await upsertDevice(userId, pushToken);
    res.status(201).json({ deviceId });
  });

  // Upload Delivery (multipart, streamed to disk via busboy)
  app.post(
    '/deliveries',
    (req: any, res: any, next: any) => {
      if (!req.headers['content-type']?.startsWith('multipart/form-data')) return next();
      const bb = require('busboy')({
        headers: req.headers,
        limits: { fieldSize: 1024, fieldNameSize: 100, fields: 100 },
      });
      req.bb = bb;
      next();
    },
    async (req: any, res: any) => {
      const bb = req.bb;
      if (!bb) return res.status(400).json({ error: 'busboy not initialized' });

      let receivedFields: Record<string, string> = {};
      let videoFilename: string | null = null;
      let partialPath: string | null = null;
      const fs = require('fs');
      const uploadDir = process.env.UPLOAD_DIR ?? '/data/uploads';
      if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

      bb.on('field', (fieldname: string, val: string) => {
        receivedFields[fieldname] = val;
      });
      bb.on(
        'file',
        (fieldname: string, fileStream: any, filename: string, encoding: string, mime: string) => {
          if (fieldname !== 'video') {
            fileStream.resume();
            return;
          }
          videoFilename = filename;
          partialPath = `${uploadDir}/${videoFilename}`;
          const out = fs.createWriteStream(partialPath);
          fileStream.pipe(out);
          out.on('error', () => {
            if (partialPath && fs.existsSync(partialPath)) fs.unlinkSync(partialPath);
            res.status(500).json({ error: 'disk write error' });
          });
        },
      );

      bb.on('finish', async () => {
        const captureFps = Number(receivedFields.captureFps);
        const deliveryAngle = receivedFields.deliveryAngle;
        if (
          isNaN(captureFps) ||
          captureFps < 1 ||
          captureFps > 480 ||
          !deliveryAngle ||
          deliveryAngle !== 'side-on'
        ) {
          if (partialPath && fs.existsSync(partialPath)) fs.unlinkSync(partialPath);
          return res
            .status(400)
            .json({ error: 'invalid fields: captureFps 1–480, deliveryAngle side-on' });
        }
        const maxBytes = Number(process.env.MAX_UPLOAD_BYTES ?? 83886080);
        const finalSize = fs.existsSync(partialPath) ? fs.statSync(partialPath).size : 0;
        if (finalSize > maxBytes) {
          if (partialPath && fs.existsSync(partialPath)) fs.unlinkSync(partialPath);
          return res.status(413).json({ error: `payload too large: ${finalSize} bytes` });
        }

        const userKey = req.headers['x-user-key'] as string | undefined;
        const userId = userKey ? (await upsertUserByKey(userKey)).id : 'anonymous';

        const { id, status } = await insertDelivery({
          userId,
          videoPath: partialPath!,
          deliveryAngle,
          captureFps,
        });

        try {
          await queue.add('process', { deliveryId: id });
          res.status(201).json({ deliveryId: id, status });
        } catch (err) {
          console.error('queue add failed, marking delivery failed:', err);
          res.status(503).json({ error: 'queue error', details: String(err) });
        }
      });

      bb.on('error', (err: any) => {
        if (partialPath && fs.existsSync(partialPath)) fs.unlinkSync(partialPath);
        res.status(400).json({ error: 'bad multipart request', details: err.message });
      });

      req.pipe(bb);
    },
  );

  // Delivery status + report
  app.get('/deliveries/:id', async (req: any, res: any) => {
    const deliver = await getDeliveryWithReport(req.params.id);
    if (!deliver) return res.status(404).json({ error: 'delivery not found' });
    res.json(deliver);
  });

  // 404 fallback
  app.use((_req: any, res: any) => res.status(404).json({ error: 'not found' }));

  return app;
}
