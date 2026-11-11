import { Pool } from "pg";
import type { DeliveryRecord, DeliveryStatus, Report } from "@bowled/shared";

/** Shared PostgreSQL pool — created once, reused by all functions. */
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

/** Upsert user by API key; returns { id }. */
export async function upsertUserByKey(apiKey: string): Promise<{ id: string }> {
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
  const { rows } = await pool.query(
    `INSERT INTO devices (user_id, push_token) VALUES ($1, $2)
     ON CONFLICT (user_id, push_token) DO UPDATE SET push_token = EXCLUDED.push_token
     RETURNING id`,
    [userId, pushToken],
  );
  return rows[0].id;
}

/** Build a consolidated Db API object for backwards compatibility. */
export function makeApiDb(pool: Pool) {
  return {
    upsertUserByKey: (apiKey: string) => upsertUserByKey(apiKey),
    upsertDevice: (userId: string, pushToken: string) => upsertDevice(userId, pushToken),
    setDeliveryStatus: (id: string, status: string, reason?: string) => {
      // Runtime stub - in production would use pool to update status
      console.log(`Setting delivery ${id} status to ${status}`, reason);
    },
  };
}