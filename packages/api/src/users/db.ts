import { Pool } from "pg";
import { DeliveryRecord, DeliveryStatus, Report } from "@bowled/shared";
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

export { SCHEMA_SQL };

/** Build a consolidated Db API object for backwards compatibility (users-only). */
export function makeApiDb(pool: Pool) {
  return {
    upsertUserByKey: (apiKey: string) => upsertUserByKey(apiKey),
    upsertDevice: (userId: string, pushToken: string) => upsertDevice(userId, pushToken),
    setDeliveryStatus: (id: string, status: string, reason?: string) => {
      // Runtime stub - in production would use pool to update status
      console.log(`Setting delivery ${id} status to ${status}`, reason);
    },
    /** @deprecated Use the deliveries domain service instead. */
    insertDelivery: (params: {
      userId: string;
      videoPath: string;
      deliveryAngle: string;
      captureFps: number;
    }) => {
      throw new Error("insertDelivery: Use the deliveries domain service/module instead.");
    },
    /** @deprecated Use the deliveries domain service instead. */
    getDeliveryWithReport: (id: string) => {
      throw new Error("getDeliveryWithReport: Use the deliveries domain service/module instead.");
    },
  };
}