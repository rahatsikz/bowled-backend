/**
 * Domain types shared across api, worker, and analysis.
 *
 * Vocabulary is fixed by GLOSSARY.md — do not drift to synonyms:
 * Delivery, Delivery Angle, Capture FPS, Metric, Metric Capability,
 * Capability Tier, Confidence, Report.
 */

/** The filming perspective of a Delivery. v1 supports side-on only. */
export type DeliveryAngle = "side-on";

/** A single pose landmark in normalized image coordinates (origin top-left, y down). */
export type PoseLandmark = {
  /** MediaPipe Pose Landmarker index (e.g. 13 = left elbow). */
  index: number;
  x: number;
  y: number;
};

/**
 * One frame of the coordinate matrix produced by Extraction:
 * every visible landmark plus the per-frame Confidence.
 */
export type FrameCoordinates = {
  frameIndex: number;
  timestampMs: number;
  confidence: number;
  landmarks: PoseLandmark[];
};

/** What the Extraction stage receives / what Analysis is told about the Delivery. */
export type DeliveryMetadata = {
  deliveryAngle: DeliveryAngle;
  captureFps: number;
};

/** v1 Metric name. Each name declares a Metric Capability (minimum Capture FPS). */
export type MetricName = "elbow-extension";

/**
 * Minimum Capture FPS (declared at upload) below which a Metric is not
 * computed and not shown. Never present a Metric with watered-down accuracy.
 */
export const METRIC_FPS_FLOOR: Record<MetricName, number> = {
  "elbow-extension": 120,
};

/** The measured quantities of the elbow-extension Metric, in degrees. */
export type ElbowExtensionMetric = {
  metric: "elbow-extension";
  /** Confidence-weighted elbow angle at the release frame. */
  releaseAngleDeg: number;
  /** Most-flexed elbow angle found in the delivery window. */
  maxFlexionAngleDeg: number;
  /** How far the elbow extended from max flexion toward release. */
  extensionDeltaDeg: number;
  validFrameCount: number;
  droppedFrameCount: number;
};

/**
 * A Metric that was withheld because the Delivery's Capture FPS is below its
 * Metric Capability floor.
 */
export type GatedMetric = {
  metric: MetricName;
  reason: "capture-fps-below-floor";
  requiredFps: number;
  captureFps: number;
};

/** Coaching guidance output for one Delivery. Always guidance, never a verdict. */
export type Report = {
  framing: "guidance";
  metrics: ElbowExtensionMetric[];
  gatedMetrics: GatedMetric[];
  /** Indices of frames dropped for low Confidence. Never silently interpolated. */
  droppedFrames: number[];
  /** Coaching-style narration rendered from frozen templates (possibly LLM-paraphrased). */
  narration: string;
};

/** Persistent state of a Delivery/Analysis pair. */
export type DeliveryStatus = "queued" | "processing" | "complete" | "failed";

/** One uploaded Delivery, as persisted. */
export type DeliveryRecord = {
  id: string;
  userId: string;
  videoPath: string;
  deliveryAngle: DeliveryAngle;
  captureFps: number;
  status: DeliveryStatus;
  failureReason: string | null;
  createdAt: string;
};

/** A registered device for push notifications. */
export type DeviceRecord = {
  id: string;
  userId: string;
  pushToken: string;
  createdAt: string;
};

/** The Analysis attached to one Delivery, as persisted. */
export type AnalysisRecord = {
  id: string;
  deliveryId: string;
  status: "complete" | "failed";
  report: Report | null;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
};
