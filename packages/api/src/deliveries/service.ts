import { insertDelivery, getDeliveryWithReport } from "./db.js";
import type { DeliveryRecord, DeliveryStatus, Report } from "@bowled/shared";

/** Service layer for delivery-related operations. */
export async function createDelivery(params: {
  userId: string;
  videoPath: string;
  deliveryAngle: string;
  captureFps: number;
}): Promise<{ id: string; status: string }> {
  return await insertDelivery(params);
}

export async function fetchDeliveryWithReport(deliveryId: string): Promise<{
  delivery: any;
  analysis: any | null;
} | null> {
  return await getDeliveryWithReport(deliveryId);
}

/** Build a minimal delivery deps object for controllers. */
export function makeDeliveriesDeps() {
  return { insertDelivery, getDeliveryWithReport };
}