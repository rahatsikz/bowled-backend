import type { ApiDb } from '../db.js';
import type { DeliveryWithReport } from '@bowled/db';

/** Service layer for delivery-related operations. */
export async function createDelivery(db: ApiDb, params: {
  userId: string;
  videoPath: string;
  deliveryAngle: 'side-on';
  captureFps: number;
}): Promise<{ id: string; status: 'queued' }> {
  return await db.insertDelivery(params);
}

export async function fetchDeliveryWithReport(db: ApiDb, deliveryId: string): Promise<DeliveryWithReport | null> {
  return await db.getDeliveryWithReport(deliveryId);
}
