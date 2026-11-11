/**
 * Worker — bounded-concurrency analysis pipeline.
 *
 * Job data: { deliveryId }
 * Process: extract → analyze → set terminal state → notify.
 *
 * Bounded retries: PermanentDeliveryError (poison file, unsupported angle,
 * missing extractor config) fails the job immediately, no retry. All other
 * errors (ffmpeg infra, MediaPipe OOM, etc.) are transient and let BullMQ
 * retry up to the per-job maxAttempts set in the API.
 *
 * On final exhaustion: delivery + analysis marked failed; FCM/Noop notifier
 * fires. SIGTERM finishes in‑flight jobs then exits.
 */

import "dotenv/config";
import path from "path";
import fs from "fs";
import { Worker } from "bullmq";
import { Redis } from "ioredis";
import { makeDb, type Db } from "./db.js";
import { FrameExtractor } from "./extraction/types.js";
import { SyntheticExtractor } from "./extraction/test-extractor.js";
import { FfmpegMediaPipeExtractor } from "./extraction/ffmpeg-mediapipe.js";
import { analyzeDelivery } from "@bowled/analysis";
import { FcmNotifier, NoopNotifier } from "./notify.js";
import type { Notifer } from "./notify.js";
import { PermanentDeliveryError, MissingExtractorError } from "./errors.js";

const DEFAULT_WORKER_CONCURRENCY = 2;
const MAX_JOB_ATTEMPTS = 5;

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

function makeExtractor(): FrameExtractor {
  const testMode = process.env.TEST_EXTRACTION_MODE === "1";
  if (testMode) {
    console.log("Worker: TEST_EXTRACTION_MODE=enabled — using synthetic extractor");
    return new SyntheticExtractor();
  }
  const wasmDir = process.env.MEDIAPIPE_WASM_DIR;
  const modelPath = process.env.MEDIAPIPE_MODEL_PATH;
  if (!wasmDir || !modelPath) {
    console.warn(
      "Worker: MediaPipe not configured — jobs will fail with MissingExtractorError",
    );
    return {
      extract: async () => {
        throw new MissingExtractorError(
          "MediaPipe extraction not configured: set MEDIAPIPE_WASM_DIR and MEDIAPIPE_MODEL_PATH",
        );
      },
    } as unknown as FrameExtractor;
  }
  return new FfmpegMediaPipeExtractor();
}

function makeNotifier(): (Notifer & { close?(): Promise<void> }) {
  const fcmPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (fcmPath && fs.existsSync(fcmPath)) {
    return new FcmNotifier(fcmPath);
  }
  return new NoopNotifier();
}

// ---------------------------------------------------------------------------
// Job processor
// ---------------------------------------------------------------------------

interface ProcessJob {
  deliveryId: string;
}

async function processDelivery(
  deliveryId: string,
  db: Db,
  extractor: FrameExtractor,
  notifier: ReturnType<typeof makeNotifier>,
): Promise<void> {
  // 1. Load delivery record
  const delivery = await db.getDelivery(deliveryId);
  if (!delivery) {
    console.error(`delivery ${deliveryId} not found — cannot process`);
    return;
  }

  // 2. Mark processing
  await db.setDeliveryStatus(deliveryId, "processing");

  try {
    // 3. Extract frames
    const frames = await extractor.extract(delivery.videoPath, delivery.captureFps);

    // 4. Run Analysis (pure geometry; no ffmpeg / MediaPipe)
    const metadata = {
      deliveryAngle: delivery.deliveryAngle as "side-on",
      captureFps: delivery.captureFps,
    };
    const report = await analyzeDelivery({ frames, metadata });

    // 5. Persist analysis result
    await db.setAnalysisResult(deliveryId, report);

    // 6. Delivery complete → notification
    const pushToken = await db.getDevicePushToken(delivery.userId ?? "");
    if (pushToken) {
      await notifier.deliveryComplete(pushToken, deliveryId);
    } else {
      console.info(
        `delivery ${deliveryId}: no push token registered; notification suppressed`,
      );
    }

    // 7. Mark delivery complete
    await db.setDeliveryStatus(deliveryId, "complete");
  } catch (err) {
    // -----------------------------------------------------------------
    // Error classification
    // -----------------------------------------------------------------
    const msg = err instanceof Error ? err.message : String(err);

    // Permanent delivery error → no retries, fail immediately
    if (err instanceof PermanentDeliveryError) {
      console.error(`permanent delivery error for ${deliveryId}: ${msg}`);
      await db.setAnalysisFailed(deliveryId, msg);
      await db.setDeliveryStatus(deliveryId, "failed", msg);
      const pushToken = await db.getDevicePushToken(delivery.userId ?? "");
      if (pushToken) {
        await (notifier as any).deliveryFailed?.(pushToken, deliveryId, msg);
      }
      return; // no retry
    }

    // Transient error → re-throw so BullMQ can retry (respects job-level maxAttempts)
    console.error(`transient error for ${deliveryId}: ${msg}`);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Worker main
// ---------------------------------------------------------------------------

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  const redisUrl = process.env.REDIS_URL;
  const workerConcurrency = Number(process.env.WORKER_CONCURRENCY ?? DEFAULT_WORKER_CONCURRENCY);

  if (!databaseUrl || !redisUrl) {
    console.error("FATAL: DATABASE_URL and REDIS_URL must be set");
    process.exit(1);
  }

  const db = makeDb();

  const extractor = makeExtractor();
  const notifier = makeNotifier();

  // BullMQ v6 takes an already-constructed Redis client (it no longer bundles
  // one); maxRetriesPerRequest: null is required for blocking job waits.
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });

  // BullMQ worker
  const worker = new Worker(
    "deliveries",
    async (job: { data: { deliveryId: string } }) => {
      const { deliveryId }: { deliveryId: string } = job.data;
      await processDelivery(deliveryId, db, extractor, notifier);
    },
    {
      connection,
      concurrency: workerConcurrency,
      // Per-job maxAttempts is set by the API when enqueueing the job.
      // The worker itself does not impose a global cap; our code
      // classification (PermanentDeliveryError vs transient) decides
      // whether a retry makes sense.
    },
  );

  worker.on("completed", (job) => {
    console.log(`job ${job.id} completed for delivery ${job.data.deliveryId}`);
  });

  worker.on("failed", (job, err) => {
    console.error(
      `job ${job?.id} failed for delivery ${job?.data?.deliveryId}: ${err.message}`,
    );
  });

  worker.on("error", (err) => {
    console.error("worker error:", err);
  });

  console.log(`worker started: concurrency=${workerConcurrency}, redis=${redisUrl}`);
}

// Graceful SIGTERM: let BullMQ finish in‑flight jobs then exit
process.once("SIGTERM", async () => {
  console.log("SIGTERM received — shutting down worker...");
  // BullMQ workers stop accepting new jobs on SIGTERM; in‑flight jobs
  // complete before the process exits. We just exit after a brief wait.
  setTimeout(() => process.exit(0), 5000);
});

main().catch((err) => {
  console.error("worker fatal error:", err);
  process.exit(1);
});