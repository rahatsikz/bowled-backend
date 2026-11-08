import express from "express";
import type { Response, NextFunction } from "express";
import busboy from "busboy";
import type { Pool } from "pg";
import { makeApiDb } from "./db.js";

// Extend Express Request type to include bb property from busboy
declare module "express" {
  export interface Request {
    bb?: import("busboy").Busboy;
  }
}

export interface ApiDeps {
  db: ReturnType<typeof makeApiDb>;
  queue: import("bullmq").Queue;
  maxUploadBytes: number;
}

function wrapAsync(fn: any) {
  return function (req: any, res: Response, next: NextFunction) {
    fn(req, res, next).catch(next);
  };
}

export function setupRoutes({
  app,
  db,
  queue,
  maxUploadBytes,
}: {
  app: express.Express;
  db: ReturnType<typeof makeApiDb>;
  queue: import("bullmq").Queue;
  maxUploadBytes: number;
}) {
  // Health check
  app.get("/healthz", (_req, res: Response) => res.json({ ok: true }));

  // Device registration (minimal key-based auth)
  app.post("/devices", express.json(), wrapAsync(async (req: any, res: Response) => {
    const { pushToken } = req.body;
    if (!pushToken) {
      return res.status(400).json({ error: "pushToken required" });
    }
    const userKey = req.headers["x-user-key"] as string | undefined;
    if (!userKey) {
      return res.status(401).json({ error: "x-user-key required" });
    }
    const { id: userId } = await db.upsertUserByKey(userKey);
    const deviceId = await db.upsertDevice(userId, pushToken);
    res.status(201).json({ deviceId });
  }));

  // Upload Delivery (multipart, streamed to disk via busboy)
  app.post(
    "/deliveries",
    (req: any, res: Response, next: NextFunction) => {
      if (!req.headers["content-type"]?.startsWith("multipart/form-data")) {
        return next();
      }
      const bb = busboy({
        headers: req.headers,
        limits: { fieldNameSize: 1024, fieldNames: 100 } as any,
      });
      req.bb = bb;
      next();
    },
    wrapAsync(async (req: any, res: Response) => {
      const bb = req.bb;
      if (!bb) return res.status(400).json({ error: "busboy not initialized" });

      let receivedFields: Record<string, string> = {};
      let videoFilename: string | null = null;
      let partialPath: string | null = null;

      bb.on("field", (fieldname: string, val: string, fieldnameTrimmed?: string, valTrimmed?: string) => {
        receivedFields[fieldname] = valTrimmed || val;
      });

      bb.on("file", (fieldname: string, fileStream: any, filename: string, encoding: string, mime: string) => {
        if (fieldname !== "video") {
          fileStream.resume();
          return;
        }
        videoFilename = filename;
        const uploadDir = process.env.UPLOAD_DIR ?? "/data/uploads";
        if (!require("fs").existsSync(uploadDir)) {
          require("fs").mkdirSync(uploadDir, { recursive: true });
        }
        partialPath = `${uploadDir}/${videoFilename}`;
        const out = require("fs").createWriteStream(partialPath);
        fileStream.pipe(out);
        out.on("error", (err: Error) => {
          if (partialPath && require("fs").existsSync(partialPath)) {
            require("fs").unlinkSync(partialPath);
          }
          res.status(500).json({ error: "disk write error", details: err.message });
        });
      });

      bb.on("finish", async () => {
        const captureFps = Number(receivedFields.captureFps);
        const deliveryAngle = receivedFields.deliveryAngle;
        if (
          isNaN(captureFps) ||
          captureFps < 1 ||
          captureFps > 480 ||
          !deliveryAngle ||
          deliveryAngle !== "side-on"
        ) {
          if (partialPath && require("fs").existsSync(partialPath)) {
            require("fs").unlinkSync(partialPath);
          }
          return res.status(400).json({
            error: "invalid fields: captureFps must be 1–480 and deliveryAngle must be side-on",
          });
        }

        const maxBytes = Number(process.env.MAX_UPLOAD_BYTES ?? 83886080);
        const finalSize = require("fs").existsSync(partialPath)
          ? require("fs").statSync(partialPath).size
          : 0;
        if (finalSize > maxUploadBytes) {
          if (partialPath && require("fs").existsSync(partialPath)) {
            require("fs").unlinkSync(partialPath);
          }
          return res.status(413).json({
            error: `payload too large: ${finalSize} bytes (max ${maxUploadBytes})`,
          });
        }

        const userKey = req.headers["x-user-key"] as string | undefined;
        const userId = userKey ? (await db.upsertUserByKey(userKey)).id : "anonymous";

        const { id, status } = await db.insertDelivery({
          userId,
          videoPath: partialPath!,
          deliveryAngle,
          captureFps,
        });

        try {
          await queue.add("process", { deliveryId: id });
          res.status(201).json({ deliveryId: id, status });
        } catch (err) {
          await db.setDeliveryStatus(id, "failed", String(err));
          res.status(503).json({ error: "queue error", details: String(err) });
        }
      });

      bb.on("error", (err: Error) => {
        if (partialPath && require("fs").existsSync(partialPath)) {
          require("fs").unlinkSync(partialPath);
        }
        res.status(400).json({ error: "bad multipart request", details: err.message });
      });

      req.pipe(bb);
    }),
  );

  // Delivery status + report
  app.get("/deliveries/:id", wrapAsync(async (req: any, res: Response) => {
    const deliver = await db.getDeliveryWithReport(req.params.id);
    if (!deliver) {
      return res.status(404).json({ error: "delivery not found" });
    }
    res.json(deliver);
  }));

  // 404 for any unmatched routes
  app.use((_req: any, res: Response) => res.status(404).json({ error: "not found" }));
}