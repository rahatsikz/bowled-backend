import { Pool } from "pg";
import type { DeliveryRecord, DeliveryStatus, Report } from "@bowled/shared";
import { v4 as uuidv4 } from "uuid";

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  push_token TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, push_token)
);

CREATE TABLE IF NOT EXISTS deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  video_path TEXT NOT NULL,
  delivery_angle TEXT NOT NULL CHECK (delivery_angle = 'side-on'),
  capture_fps INTEGER NOT NULL CHECK (capture_fps > 0),
  status TEXT NOT NULL CHECK (status IN ('queued', 'processing', 'complete', 'failed')),
  failure_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS analyses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id UUID NOT NULL UNIQUE REFERENCES deliveries(id),
  status TEXT NOT NULL CHECK (status IN ('complete', 'failed')),
  report JSONB,
  failure_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

/** Idempotent schema boot. Returns true on success. */
export async function ensureSchema(): Promise<boolean> {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });
  try {
    await pool.query(SCHEMA_SQL);
    return true;
  } catch {
    return false;
  }
}

/** Upsert user by API key; returns { id }. */
export async function upsertUserByKey(apiKey: string): Promise<{ id: string }> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const { rows } = await pool.query(
    `INSERT INTO users (api_key) VALUES ($1)
     ON CONFLICT (api_key) DO NOTHING
     RETURNING id`,
    [apiKey],
  );
  if (rows.length > 0) return { id: rows[0].id };
  const { rows: r2 } = await pool.query(
    `SELECT id FROM users WHERE api_key = $1`,
    [apiKey],
  );
  return { id: r2[0].id };
}

/** Upsert device for a user; returns device id. */
export async function upsertDevice(userId: string, pushToken: string): Promise<string> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const { rows } = await pool.query(
    `INSERT INTO devices (user_id, push_token) VALUES ($1, $2)
     ON CONFLICT (user_id, push_token) DO UPDATE SET push_token = EXCLUDED.push_token
     RETURNING id`,
    [userId, pushToken],
  );
  return rows[0].id;
}

/** Insert a delivery row with status 'queued'. */
export async function insertDelivery({
  userId,
  videoPath,
  deliveryAngle,
  captureFps,
}: {
  userId: string;
  videoPath: string;
  deliveryAngle: string;
  captureFps: number;
}): Promise<{ id: string; status: string }> {
  const id = uuidv4();
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  await pool.query(
    `INSERT INTO deliveries (id, user_id, video_path, delivery_angle, capture_fps, status)
     VALUES ($1, $2, $3, $4, $5, 'queued')`,
    [id, userId, videoPath, deliveryAngle, captureFps],
  );
  return { id, status: "queued" };
}

/** Get delivery joined with its latest analysis, if any. */
export async function getDeliveryWithReport(
  id: string,
): Promise<{ delivery: any; analysis: any | null } | null> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const { rows } = await pool.query(
    `SELECT d.id, d.user_id, d.video_path, d.delivery_angle, d.capture_fps,
            d.status, d.failure_reason, d.created_at,
            a.status AS analysis_status, a.report, a.failure_reason AS analysis_failure_reason,
            a.created_at AS analysis_created_at, a.updated_at AS analysis_updated_at
     FROM deliveries d
     LEFT JOIN analyses a ON a.delivery_id = d.id
     WHERE d.id = $1`,
    [id],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    delivery: {
      id: row.id,
      userId: row.user_id,
      videoPath: row.video_path,
      deliveryAngle: row.delivery_angle,
      captureFps: row.capture_fps,
      status: row.status,
      failureReason: row.failure_reason,
      createdAt: row.created_at,
    },
    analysis: row.analysis_status === "complete"
      ? { report: row.report, failureReason: row.analysis_failure_reason }
      : null,
  };
}

export function makeApiDb(pool: Pool) {
  return {
    upsertUserByKey: (apiKey: string) => upsertUserByKey(apiKey),
    upsertDevice: (userId: string, pushToken: string) => upsertDevice(userId, pushToken),
    insertDelivery: (params: {
      userId: string;
      videoPath: string;
      deliveryAngle: string;
      captureFps: number;
    }) => insertDelivery(params),
    getDeliveryWithReport: (id: string) => getDeliveryWithReport(id),
    setDeliveryStatus: (id: string, status: string, reason?: string) => {
      // Runtime stub - in production would use pool to update status
      console.log(`Setting delivery ${id} status to ${status}`, reason);
    },
  };
}