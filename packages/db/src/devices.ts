/**
 * Device persistence (push tokens). All SQL here follows the authoritative
 * schema in packages/shared/src/db/schema.sql. This package never creates
 * tables.
 */

import type { DbPool } from "./pool.js";

export function makeDevicesDb(pool: DbPool) {
  /** Upsert device for a user; returns device id. */
  async function upsertDevice(userId: string, pushToken: string): Promise<string> {
    const { rows } = await pool.query(
      `INSERT INTO devices (user_id, push_token) VALUES ($1, $2)
       ON CONFLICT (user_id, push_token) DO UPDATE SET push_token = EXCLUDED.push_token
       RETURNING id`,
      [userId, pushToken],
    );
    const row = rows[0];
    if (!row) throw new Error("device upsert failed: no row returned");
    return row.id;
  }

  /** Most recently registered push token for the user, or null. */
  async function getLatestPushToken(userId: string): Promise<string | null> {
    const { rows } = await pool.query(
      `SELECT push_token FROM devices
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT 1`,
      [userId],
    );
    const row = rows[0];
    return row ? row.push_token : null;
  }

  return { upsertDevice, getLatestPushToken };
}
