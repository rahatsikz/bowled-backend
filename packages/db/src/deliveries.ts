/**
 * Delivery persistence. All SQL here follows the authoritative schema in
 * packages/shared/src/db/schema.sql. This package never creates tables.
 */

import { randomUUID } from "node:crypto";
import type {
  DeliveryAngle,
  DeliveryRecord,
  DeliveryStatus,
  Report,
} from "@bowled/shared";
import type { DbPool } from "./pool.js";

/** One Delivery joined with its Analysis (present only when complete). */
export type DeliveryWithReport = {
  delivery: {
    id: string;
    userId: string;
    videoPath: string;
    deliveryAngle: DeliveryAngle;
    captureFps: number;
    status: DeliveryStatus;
    failureReason: string | null;
    createdAt: Date;
  };
  analysis: {
    report: Report;
    failureReason: string | null;
  } | null;
};

export function makeDeliveriesDb(pool: DbPool) {
  /** Insert a Delivery row with status 'queued'; returns { id, status }. */
  async function insertDelivery(params: {
    userId: string;
    videoPath: string;
    deliveryAngle: DeliveryAngle;
    captureFps: number;
  }): Promise<{ id: string; status: 'queued' }> {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO deliveries (id, user_id, video_path, delivery_angle, capture_fps, status)
       VALUES ($1, $2, $3, $4, $5, 'queued')`,
      [id, params.userId, params.videoPath, params.deliveryAngle, params.captureFps],
    );
    return { id, status: "queued" };
  }

  /** Load one Delivery record, or null. */
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
      // the shared type once, here, so callers are typed.
      deliveryAngle: row.delivery_angle as DeliveryAngle,
      captureFps: row.capture_fps,
      status: row.status as DeliveryStatus,
      failureReason: row.failure_reason,
      createdAt: toIso(row.created_at),
    };
  }

  /** Update a Delivery's status (and failure reason when failing). */
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

  /** Get a Delivery joined with its latest Analysis, if any. */
  async function getDeliveryWithReport(id: string): Promise<DeliveryWithReport | null> {
    const { rows } = await pool.query(
      `SELECT d.id, d.user_id, d.video_path, d.delivery_angle, d.capture_fps,
              d.status, d.failure_reason, d.created_at,
              a.status AS analysis_status, a.report, a.failure_reason AS analysis_failure_reason
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
        // Schema-constrained; cast through the shared type once, here.
        deliveryAngle: row.delivery_angle as DeliveryAngle,
        captureFps: row.capture_fps,
        status: row.status as DeliveryStatus,
        failureReason: row.failure_reason,
        createdAt: row.created_at,
      },
      analysis: row.analysis_status === "complete"
        ? { report: row.report as Report, failureReason: row.analysis_failure_reason }
        : null,
    };
  }

  return { insertDelivery, getDelivery, setDeliveryStatus, getDeliveryWithReport };
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}
