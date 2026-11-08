import { Pool } from "pg";
import { DeliveryRecord, DeliveryStatus, Report } from "@bowled/shared";
import { v4 as uuidv4 } from "uuid";

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