/**
 * Error classification for the delivery pipeline.
 *
 * RETRIES ARE FOR TRANSIENT ERRORS ONLY. A `PermanentDeliveryError` means the
 * Delivery itself cannot succeed — retrying would only reproduce the same
 * failure — so the BullMQ processor converts it to `UnrecoverableError` and
 * the job fails immediately on its first attempt (no retry).
 */

/**
 * The Delivery is permanently unprocessable: extraction produced nothing
 * usable after a successful ffmpeg decode, the Delivery Angle is unsupported,
 * the extractor is not configured, or the video file is poisoned. Never
 * thrown for infrastructure problems (Redis/Postgres/network) — those stay
 * transient and are retried.
 */
export class PermanentDeliveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentDeliveryError";
  }
}

/** Extraction is not configured (no MediaPipe model path) — nothing to run. */
export class MissingExtractorError extends PermanentDeliveryError {
  constructor(message: string) {
    super(message);
    this.name = "MissingExtractorError";
  }
}
