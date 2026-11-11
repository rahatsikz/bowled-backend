/**
 * Worker-owned DB facade over @bowled/db. The worker creates and closes its
 * own pool here; no SQL lives in the worker.
 *
 * The schema itself is authoritative in packages/shared/src/db/schema.sql,
 * applied by Postgres on database volume initialization (see
 * docker-compose.yml). No module ever creates tables.
 */

import {
  createDbPool,
  makeAnalysesDb,
  makeDeliveriesDb,
  makeDevicesDb,
} from "@bowled/db";
import type {
  DeliveryRecord,
  DeliveryStatus,
  Report,
} from "@bowled/shared";

export type Db = {
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
  const pool = createDbPool(
    process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : {},
  );

  const deliveries = makeDeliveriesDb(pool);
  const analyses = makeAnalysesDb(pool);
  const devices = makeDevicesDb(pool);

  return {
    getDelivery: deliveries.getDelivery,
    setDeliveryStatus: deliveries.setDeliveryStatus,
    setAnalysisResult: analyses.setAnalysisResult,
    setAnalysisFailed: analyses.setAnalysisFailed,
    getDevicePushToken: devices.getLatestPushToken,
    close: () => pool.end(),
  };
}
