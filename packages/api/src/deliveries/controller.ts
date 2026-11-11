import { Request, Response } from "express";
import { createDelivery, fetchDeliveryWithReport } from "./service.js";
import type { ApiDb } from "../db.js";

/** Controller handling delivery-related HTTP requests. */
export class DeliveriesController {
  constructor(private readonly db: ApiDb) {}

  /** POST /deliveries - Upload a new delivery (multipart/form-data) */
  async upload(req: Request, res: Response): Promise<void> {
    try {
      const { userId, videoPath, deliveryAngle, captureFps } = req.body;

      if (!videoPath || !deliveryAngle) {
        res.status(400).json({ error: "videoPath and deliveryAngle required" });
        return;
      }

      // v1 supports side-on only (schema CHECK enforces the same).
      if (deliveryAngle !== "side-on") {
        res.status(400).json({ error: "unsupported deliveryAngle" });
        return;
      }

      const result = await createDelivery(this.db, {
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
  async getById(req: Request, res: Response): Promise<{ delivery: unknown; analysis: unknown } | null> {
    const deliveryId = req.params.id as string;
    const result = await fetchDeliveryWithReport(this.db, deliveryId);
    if (!result) {
      return null;
    }
    return result;
  }
}
