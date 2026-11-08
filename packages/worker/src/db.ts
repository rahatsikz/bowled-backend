/**
 * Thin pg wrapper over the shared schema. All deliveries/analyses/devices
 * state flows through here; no SQL is allowed outside this module in the
 * worker.
 *
 * NOTE: SCHEMA_SQL is inlined from the canonical source, which lives at
 * packages/shared/src/db/schema.sql. Keep the copy identical.
 */

import pg from "pg";
import type {
  DeliveryRecord,
  DeliveryStatus,
  Report,
} from "@bowled/shared";

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

export type Db = {
  /** Idempotent schema boot. Returns false on failure; the caller (index.ts)
   * logs a warning and falls back to assuming the schema already exists. */
  ensureSchema(): Promise<boolean>;
  getDelivery(id: string): Promise<DeliveryRecord | null>;
  setDeliveryStatus(id: string, status: DeliveryStatus, failureReason?: string | null): Promise<void>;
  /** Upsert the completed analysis row (status 'complete') for the Delivery. */
  setAnalysisResult(deliveryId: string, report: Report): Promise<void>;
  /** Upsert a failed-analysis row (status 'failed') for the Delivery. */
  setAnalysisFailed(deliveryId: string, reason: string): Promise<void>;
  /** Most recently registered push token for the user, or null. */
  getDevicePushToken(userId: string): Promise<string | null>;
  close(): Promise<void>;
};

export function makeDb(): Db {
  // DATABASE_URL wins; otherwise pg falls back to the libpq env vars
  // (PGHOST/PGSSL/PGUSER/PGPASSWORD/PGDATABASE) on its own.
  const pool = new pg.Pool(
    process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : {},
  );

  async function ensureSchema(): Promise<boolean> {
    try {
      await pool.query(SCHEMA_SQL);
      return true;
    } catch (error) {
      console.warn(`worker: ensureSchema failed: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  async function getDelivery(id: string): Promise<DeliveryRecord | null> {
    const { rows } = await pool.query(
      `SELECT id, user_id, video_path, delivery_angle, capture_fps,
              status, failure_reason, created_at
          FROM deliveries WHERE id = $1`,
      [id],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      userId: row.user_id,
      videoPath: row.video_path,
      // The schema constraint pins delivery_angle to 'side-on'; cast through
      // the shared type once, here, so the rest of the worker is typed.
      deliveryAngle: row.delivery_angle,
      captureFps: row.capture_fps,
      status: row.status,
      failureReason: row.failure_reason,
      createdAt: toIso(row.created_at),
    };
  }

  async function setDeliveryStatus(
    id: string,
    status: DeliveryStatus,
    failureReason?: string | null,
  ): Promise<void> {
    await pool.query(
      `UPDATE deliveries
          SET status = $2, failure_reason = $3
        WHERE id = $1`,
      [id, status, failureReason === undefined ? null : failureReason],
    );
  }

  async function setAnalysisResult(deliveryId: string, report: Report): Promise<void> {
    await pool.query(
      `INSERT INTO analyses (delivery_id, status, report, updated_at)
       VALUES ($1, 'complete', $2, now())
       ON CONFLICT (delivery_id) DO UPDATE
         SET status = 'complete',
             report = $2,
             failure_reason = NULL,
             updated_at = now()`,
      [deliveryId, JSON.stringify(report)],
    );
  }

  async function setAnalysisFailed(deliveryId: string, reason: string): Promise<void> {
    await pool.query(
      `INSERT INTO analyses (delivery_id, status, report, failure_reason, updated_at)
       VALUES ($1, 'failed', NULL, $2, now())
       ON CONFLICT (delivery_id) DO UPDATE
         SET status = 'failed',
             report = NULL,
             failure_reason = $2,
             updated_at = now()`,
      [deliveryId, reason],
    );
  }

  async function getDevicePushToken(userId: string): Promise<string | null> {
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

  return { ensureSchema, getDelivery, setDeliveryStatus, setAnalysisResult, setAnalysisFailed, getDevicePushToken, close: () => pool.end() };
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}