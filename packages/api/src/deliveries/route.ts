import { Router } from "express";
import { DeliveriesController } from "./controller.js";
import type { Express } from "express";

export function setupDeliveriesRoutes(app: Express): void {
  const router = Router();

  // Upload Delivery (multipart, streamed to disk via busboy)
  router.post(
    "/deliveries",
    async (req: any, res: any) => {
      try {
        await DeliveriesController.upload(req, res);
      } catch (err) {
        console.error("Delivery upload error:", err);
        res.status(500).json({ error: "Failed to upload delivery" });
      }
    },
  );

  // Delivery status + report
  router.get("/deliveries/:id", async (req: any, res: any) => {
    const deliver = await DeliveriesController.getById(req, res);
    if (deliver) {
      res.json(deliver);
    } else {
      res.status(404).json({ error: "delivery not found" });
    }
  });

  app.use("/api", router);
}