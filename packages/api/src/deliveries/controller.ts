import { Request, Response } from "express";
import { createDelivery, fetchDeliveryWithReport } from "./service.js";
import type { DeliveryRecord, DeliveryStatus, Report } from "@bowled/shared";

/** Controller handling delivery-related HTTP requests. */
export class DeliveriesController {
  /** POST /deliveries - Upload a new delivery (multipart/form-data) */
  static async upload(req: Request, res: Response): Promise<void> {
    try {
      const { userId } = req.body;
      const { videoPath, deliveryAngle, captureFps } = req.body;

      if (!videoPath || !deliveryAngle) {
        res.status(400).json({ error: "videoPath and deliveryAngle required" });
        return;
      }

      const result = await createDelivery({
        userId: userId || "anonymous",
        videoPath,
        deliveryAngle,
        captureFps: Number(captureFps) || 30,
      });

      res.status(201).json({ deliveryId: result.id, status: result.status });
    } catch (err) {
      console.error("Delivery upload error:", err);
      res.status(500).json({ error: "Failed to upload delivery" });
    }
  }

  /** GET /deliveries/:id - Get delivery with report */
  static async getById(req: Request, res: Response): Promise<{ delivery: any; analysis: any } | null> {
    const deliveryId = req.params.id as string;
    const result = await fetchDeliveryWithReport(deliveryId);
    if (!result) {
      return null;
    }
    return result;
  }
}