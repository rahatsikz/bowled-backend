/**
 * Analysis — pure-geometry measurement over the coordinate matrix.
 *
 * The designed seam: frame coordinates + Delivery metadata in → Report out.
 * Knows nothing about ffmpeg, MediaPipe, LLMs, queues, or the network.
 */

import {
  METRIC_FPS_FLOOR,
  type DeliveryMetadata,
  type ElbowExtensionMetric,
  type FrameCoordinates,
  type MetricName,
  type PoseLandmark,
  type Report,
} from "@bowled/shared";

// MediaPipe Pose Landmarker indices.
const LEFT_SHOULDER = 11;
const LEFT_ELBOW = 13;
const LEFT_WRIST = 15;
const RIGHT_SHOULDER = 12;
const RIGHT_ELBOW = 14;
const RIGHT_WRIST = 16;

/**
 * Frames at or below this Confidence are dropped, and recorded as dropped,
 * never silently interpolated.
 */
export const CONFIDENCE_THRESHOLD = 0.5;

// Weights for confidence-weighted smoothing at release (newest frame heaviest).
const RELEASE_SMOOTHING = [0.25, 0.35, 0.4];

export const GUIDANCE_FRAMING = "guidance" as const;

/**
 * One math-derived factual claim the LLM may paraphrase. The LLM is allowed
 * to reword these claims and nothing else — new numbers or new biomechanics
 * claims never reach a Report.
 */
export type LlmFact = {
  id: string;
  claim: string;
};

/**
 * Injected paraphraser around the LLM. Given the Facts the math produced,
 * returns rewordings, each anchored to the fact IDs it restates (or throws —
 * the Report falls back to templates). Claims not anchored to real facts, or
 * carrying numbers the math didn't produce, are discarded by the narrator.
 */
export type LlmClaim = {
  factIds: string[];
  text: string;
};

/** Injected paraphraser around the LLM. */
export type ReportLlm = {
  paraphrase(facts: LlmFact[]): Promise<LlmClaim[]>;
};

export type AnalyzeDeliveryInput = {
  frames: FrameCoordinates[];
  metadata: DeliveryMetadata;
  llm?: ReportLlm;
};

export async function analyzeDelivery(input: AnalyzeDeliveryInput): Promise<Report> {
  const { frames, metadata } = input;
  if (metadata.deliveryAngle !== "side-on") {
    throw new Error(
      `unsupported Delivery Angle: ${metadata.deliveryAngle} (v1 supports side-on only)`,
    );
  }

  const gatedMetrics = gated(["elbow-extension"], metadata);
  if (gatedMetrics.length > 0) {
    return emptyReport(gatedMetrics);
  }

  const droppedFrames = frames
    .filter((f) => f.confidence < CONFIDENCE_THRESHOLD)
    .map((f) => f.frameIndex);

  const metric = measureElbowExtension(frames);
  return {
    framing: GUIDANCE_FRAMING,
    metrics: [metric],
    gatedMetrics: [],
    droppedFrames,
    narration: await narrate(metric, input.llm),
  };
}

function gated(requested: MetricName[], metadata: DeliveryMetadata) {
  return requested
    .filter((name) => metadata.captureFps < METRIC_FPS_FLOOR[name])
    .map((name) => ({
      metric: name,
      reason: "capture-fps-below-floor" as const,
      requiredFps: METRIC_FPS_FLOOR[name],
      captureFps: metadata.captureFps,
    }));
}

function emptyReport(gatedMetrics: ReturnType<typeof gated>): Report {
  return {
    framing: GUIDANCE_FRAMING,
    metrics: [],
    gatedMetrics,
    droppedFrames: [],
    narration:
      "This footage's Capture FPS is below what an elbow measurement needs, so no numbers are shown for it. Consistent with our Capability rules, film a future Delivery at a higher frame rate to enable it.",
  };
}

type AngleSeries = {
  /** Per-frame elbow angle in degrees, paired with its frame index. */
  angles: Array<{ frameIndex: number; angleDeg: number }>;
  landmarks: Array<{ frameIndex: number; shoulder: PoseLandmark; wrist: PoseLandmark }>;
};

type ArmIndices = {
  shoulder: number;
  elbow: number;
  wrist: number;
};

const ARMS: Array<{ side: "left" | "right"; indices: ArmIndices }> = [
  { side: "left", indices: { shoulder: LEFT_SHOULDER, elbow: LEFT_ELBOW, wrist: LEFT_WRIST } },
  { side: "right", indices: { shoulder: RIGHT_SHOULDER, elbow: RIGHT_ELBOW, wrist: RIGHT_WRIST } },
];

function measureElbowExtension(frames: FrameCoordinates[]): ElbowExtensionMetric {
  const series = ARMS.map((arm) => ({ side: arm.side, ...elbowAngleSeries(frames, arm.indices) }));
  // The bowling arm is the one with the larger angular travel over the clip.
  const bowlingArm = series.reduce((a, b) =>
    travel(a.angles) >= travel(b.angles) ? a : b,
  );
  const valid = bowlingArm.angles;

  // Release frame: the last frame whose bowling wrist is above its shoulder.
  let releaseFrameIndex: number | null = null;
  for (const { frameIndex, shoulder, wrist } of bowlingArm.landmarks) {
    if (wrist.y < shoulder.y) {
      releaseFrameIndex = frameIndex;
    }
  }

  const maxFlexionAngleDeg = Math.min(...valid.map((v) => v.angleDeg));
  const lastValid: number | null = valid.length > 0
    ? valid[valid.length - 1]!.angleDeg
    : null;
  const releaseAngleDeg =
    releaseFrameIndex === null ? lastValid : smoothedAngleAtRelease(bowlingArm.angles, releaseFrameIndex);
  if (releaseAngleDeg === null) {
    throw new Error("Delivery has no usable frames for the bowling arm");
  }

  return {
    metric: "elbow-extension",
    releaseAngleDeg,
    maxFlexionAngleDeg,
    extensionDeltaDeg: releaseAngleDeg - maxFlexionAngleDeg,
    validFrameCount: valid.length,
    droppedFrameCount: frames.length - valid.length,
  };
}

/** Elbow angle (degrees) per frame for one arm, over frames missing no landmark. */
function elbowAngleSeries(frames: FrameCoordinates[], { shoulder, elbow, wrist }: ArmIndices): AngleSeries {
  const angles: AngleSeries["angles"] = [];
  const landmarks: AngleSeries["landmarks"] = [];
  for (const frame of frames) {
    if (frame.confidence < CONFIDENCE_THRESHOLD) continue;
    const s = findLandmark(frame, shoulder);
    const e = findLandmark(frame, elbow);
    const w = findLandmark(frame, wrist);
    if (!s || !e || !w) continue;
    angles.push({
      frameIndex: frame.frameIndex,
      angleDeg: angleBetween(s, e, w),
    });
    landmarks.push({ frameIndex: frame.frameIndex, shoulder: s, wrist: w });
  }
  return { angles, landmarks };
}

function angleBetween(shoulder: PoseLandmark, elbow: PoseLandmark, wrist: PoseLandmark): number {
  const ux = shoulder.x - elbow.x;
  const uy = shoulder.y - elbow.y;
  const vx = wrist.x - elbow.x;
  const vy = wrist.y - elbow.y;
  const dotProduct = ux * vx + uy * vy;
  const magnitude = Math.hypot(ux, uy) * Math.hypot(vx, vy);
  if (magnitude === 0) return 180;
  return (Math.acos(Math.min(1, Math.max(-1, dotProduct / magnitude))) * 180) / Math.PI;
}

function findLandmark(frame: FrameCoordinates, index: number): PoseLandmark | null {
  return frame.landmarks.find((l) => l.index === index) ?? null;
}

function travel(angles: AngleSeries["angles"]): number {
  if (angles.length === 0) return 0;
  let min = Infinity;
  let max = -Infinity;
  for (const { angleDeg } of angles) {
    if (angleDeg < min) min = angleDeg;
    if (angleDeg > max) max = angleDeg;
  }
  return max - min;
}

/**
 * Confidence-free for now (all frames valid in the passing slice): weighted
 * mean of the last smoothing-window frames at/before the release frame.
 */
function smoothedAngleAtRelease(
  allAngles: AngleSeries["angles"],
  releaseFrameIndex: number,
): number {
  const upToRelease = allAngles.filter((a) => a.frameIndex <= releaseFrameIndex);
  const window = upToRelease.slice(-RELEASE_SMOOTHING.length);
  const weightTotal = window.reduce(
    (sum, _a, i) => sum + (RELEASE_SMOOTHING[i] ?? 0),
    0,
  );
  return (
    window.reduce(
      (sum, a, i) => sum + (RELEASE_SMOOTHING[i] ?? 0) * a.angleDeg,
      0,
    ) / weightTotal
  );
}

function measurementFacts(metric: ElbowExtensionMetric): LlmFact[] {
  return [
    {
      id: "sample",
      claim: `this measures the bowling-arm elbow across ${metric.validFrameCount} usable frames of your clip, dropping ${metric.droppedFrameCount} frames`,
    },
    {
      id: "release-angle",
      claim: `your bowling-arm elbow measured about ${metric.releaseAngleDeg.toFixed(0)}° at release`,
    },
    {
      id: "max-flexion",
      claim: `the elbow read ${metric.maxFlexionAngleDeg.toFixed(0)}° at its most flexed`,
    },
    {
      id: "extension",
      claim: `the elbow extended ${metric.extensionDeltaDeg.toFixed(0)}° from that flexion through to release`,
    },
  ];
}

/**
 * Narration: LLM-paraphrased claims when available, the frozen template
 * otherwise. Report delivery never depends on the LLM's availability, and a
 * claim only survives if it anchors to a real fact and carries no number the
 * math didn't produce — hallucinated biomechanics never reach a Report.
 */
async function narrate(metric: ElbowExtensionMetric, llm?: ReportLlm): Promise<string> {
  const fallback = renderNarration(metric);
  if (!llm) return fallback;
  try {
    const facts = measurementFacts(metric);
    const claims = await llm.paraphrase(facts);
    const accepted = claims.filter((claim) => admits(claim, facts));
    const rendered = accepted.map((claim) => claim.text.trim()).filter(Boolean).join(" ");
    return rendered.length > 0 ? rendered : fallback;
  } catch {
    return fallback;
  }
}

const NUMBER_PATTERN = /\d+(?:\.\d+)?/g;

function admits(claim: LlmClaim, facts: LlmFact[]): boolean {
  const referenced = facts.filter((fact) => claim.factIds.includes(fact.id));
  // Empty factIds (or unknown ids) mean an unanchored claim: refuse it.
  if (referenced.length === 0) return false;
  const allowedNumbers = new Set(
    referenced.flatMap((fact) => [...fact.claim.matchAll(NUMBER_PATTERN)].map((m) => m[0])),
  );
  return [...claim.text.matchAll(NUMBER_PATTERN)].every((m) => allowedNumbers.has(m[0]));
}

/**
 * Frozen template narration (v1). Claims are math-derived only; the wording
 * is the Coaching Guidance Framing register — guidance, never legality.
 */
function renderNarration(metric: ElbowExtensionMetric): string {
  return [
    `Guidance, not a legality verdict: this measures your bowling-arm elbow from your clip at ${metric.validFrameCount} usable frames.`,
    `The elbow read ${metric.maxFlexionAngleDeg.toFixed(0)}° at its most flexed and about ${metric.releaseAngleDeg.toFixed(0)}° at release — ${metric.extensionDeltaDeg.toFixed(0)}° of extension through the delivery window.`,
    metric.extensionDeltaDeg >= 10
      ? "That change is consistent with rapid elbow extension through release, a known fault it is worth working on."
      : "That is consistent with a bowling action without rapid elbow extension at the release.",
    "One focus for your next session: keep the bowling arm tall and straight through release, and film again to confirm.",
  ].join(" ");
}
