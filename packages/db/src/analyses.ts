/**
 * Analysis persistence. All SQL here follows the authoritative schema in
 * packages/shared/src/db/schema.sql. This package never creates tables.
 */

import type { Report } from "@bowled/shared";
import type { DbPool } from "./pool.js";

export function makeAnalysesDb(pool: DbPool) {
  /** Upsert the completed Analysis row (status 'complete') for the Delivery. */
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

  /** Upsert a failed-Analysis row (status 'failed') for the Delivery. */
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

  return { setAnalysisResult, setAnalysisFailed };
}
