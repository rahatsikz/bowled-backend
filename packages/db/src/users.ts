/**
 * User persistence. All SQL here follows the authoritative schema in
 * packages/shared/src/db/schema.sql, applied by Postgres on database volume
 * initialization (see docker-compose.yml). This package never creates tables.
 */

import type { DbPool } from "./pool.js";

export function makeUsersDb(pool: DbPool) {
  /** Upsert user by API key; returns { id }. */
  async function upsertUserByKey(apiKey: string): Promise<{ id: string }> {
    const { rows } = await pool.query(
      `INSERT INTO users (api_key) VALUES ($1)
       ON CONFLICT (api_key) DO NOTHING
       RETURNING id`,
      [apiKey],
    );
    const inserted = rows[0];
    if (inserted) return { id: inserted.id };
    const { rows: existing } = await pool.query(
      `SELECT id FROM users WHERE api_key = $1`,
      [apiKey],
    );
    const row = existing[0];
    if (!row) throw new Error("user upsert failed: no row returned");
    return { id: row.id };
  }

  return { upsertUserByKey };
}
