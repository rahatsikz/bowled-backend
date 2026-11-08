/**
 * Synthetic Fixture — the validation deliverable.
 *
 * Renders MediaPipe-style 2D coordinate sequences from *authored* biomechanics
 * with known ground truth. Used to prove Analysis accuracy within a stated
 * tolerance (README documents it; v1 states ±5°).
 *
 * Model: the clip is a side-on view of one right-armed Delivery:
 * - the bowling (right) arm sweeps over the top from hanging behind,
 * - flexes to `maxFlexionAngleDeg` mid-clip,
 * - extends to `releaseAngleDeg` at the release frame (ease-out, as a real
 *   extension decelerates near full extension),
 * - holds a frozen follow-through pose afterwards.
 * The release pose is detectable the same way Analysis detects it: the bowling
 * wrist above the bowling shoulder. The non-bowling arm performs a small,
 * low-amplitude gather so arm-selection has something to reject.
 *
 * All motion lies in the image plane (orthographic, side-on): 2D elbow angles
 * equal the authored 3D angles exactly, so ground truth is exact by construction.
 *
 * Frames carry only the landmarks the Metric reads (indices 11–16, MediaPipe
 * Pose numbering) and per-frame Confidence.
 */

import type { DeliveryMetadata, FrameCoordinates, PoseLandmark } from "@bowled/shared";

export type SyntheticDeliveryOptions = {
  fps: number;
  /** Total frames authored. Default 40. */
  frameCount?: number;
  /** Most-flexed bowling elbow angle, degrees. Default 95. */
  maxFlexionAngleDeg?: number;
  /** Bowling elbow angle at release, degrees. Default 168. */
  releaseAngleDeg?: number;
  /** Per-frame Confidence; defaults to uniformly high (0.95). */
  confidences?: number[];
};

export type SyntheticDelivery = {
  frames: FrameCoordinates[];
  metadata: DeliveryMetadata;
  groundTruth: {
    bowlingArm: "left" | "right";
    maxFlexionAngleDeg: number;
    releaseFrameIndex: number;
    releaseAngleDeg: number;
    /** releaseAngleDeg - maxFlexionAngleDeg */
    extensionDeltaDeg: number;
  };
};

// MediaPipe Pose Landmarker indices.
const LEFT_SHOULDER = 11;
const LEFT_ELBOW = 13;
const LEFT_WRIST = 15;
const RIGHT_SHOULDER = 12;
const RIGHT_ELBOW = 14;
const RIGHT_WRIST = 16;

const SHOULDER_X = 0.5;
const SHOULDER_Y = 0.45;
const UPPER_ARM_LENGTH = 0.09;
const FOREARM_LENGTH = 0.085;

const DEFAULT_FRAME_COUNT = 40;
const EXTENDED_ANGLE_DEG = 170; // straight arm at the gather
const FLEXION_FRAME = 20;
const RELEASE_FRAME = 35; // authored release moment
// Angles in math convention: 0° = image right, positive = image up.
const UPPER_ARM_START_DEG = -150;
const UPPER_ARM_SWEEP_DEG = 95; // over the top by release
const NON_BOWLING_SHOULDER_DEG = -125;

export function syntheticDelivery(options: SyntheticDeliveryOptions): SyntheticDelivery {
  const frameCount = options.frameCount ?? DEFAULT_FRAME_COUNT;
  const maxFlexionAngleDeg = options.maxFlexionAngleDeg ?? 95;
  const releaseAngleDeg = options.releaseAngleDeg ?? 168;
  const confidences =
    options.confidences ?? Array.from({ length: frameCount }, () => 0.95);

  if (frameCount <= RELEASE_FRAME || confidences.length < frameCount) {
    throw new Error("fixture needs frameCount > 35 and a confidence per frame");
  }
  if (releaseAngleDeg < maxFlexionAngleDeg) {
    throw new Error("releaseAngleDeg must be ≥ maxFlexionAngleDeg");
  }

  const frames: FrameCoordinates[] = [];
  for (let f = 0; f < frameCount; f++) {
    const elbowAngle = authoredElbowAngle(f, maxFlexionAngleDeg, releaseAngleDeg);
    const t1 = authoredUpperArmAngle(f);
    // Forearm folds over the top on one side; straight arm ⇒ ≈180 offset.
    const t2 = t1 + (180 - elbowAngle);
    // Non-bowling arm: low-amplitude gather.
    const leftUpper = NON_BOWLING_SHOULDER_DEG + 2 * Math.sin(f / 4);
    const leftForearm = NON_BOWLING_SHOULDER_DEG - 15 + 2 * Math.sin(f / 4 + 1);

    frames.push({
      frameIndex: f,
      timestampMs: Math.round((f * 1000) / options.fps),
      confidence: confidences[f] ?? 0.95,
      landmarks: [
        { index: LEFT_SHOULDER, x: SHOULDER_X - 0.12, y: SHOULDER_Y },
        pointOnArm(LEFT_ELBOW, SHOULDER_X - 0.12, SHOULDER_Y, UPPER_ARM_LENGTH, leftUpper),
        pointOnArm2(
          LEFT_WRIST,
          SHOULDER_X - 0.12,
          SHOULDER_Y,
          UPPER_ARM_LENGTH,
          leftUpper,
          FOREARM_LENGTH,
          leftForearm,
        ),
        { index: RIGHT_SHOULDER, x: SHOULDER_X, y: SHOULDER_Y },
        pointOnArm(RIGHT_ELBOW, SHOULDER_X, SHOULDER_Y, UPPER_ARM_LENGTH, t1),
        pointOnArm2(
          RIGHT_WRIST,
          SHOULDER_X,
          SHOULDER_Y,
          UPPER_ARM_LENGTH,
          t1,
          FOREARM_LENGTH,
          t2,
        ),
      ],
    });
  }

  return {
    frames,
    metadata: { deliveryAngle: "side-on", captureFps: options.fps },
    groundTruth: {
      bowlingArm: "right",
      maxFlexionAngleDeg,
      releaseFrameIndex: RELEASE_FRAME,
      releaseAngleDeg,
      extensionDeltaDeg: releaseAngleDeg - maxFlexionAngleDeg,
    },
  };
}

/** Bowling elbow angle (degrees) authored per frame. */
function authoredElbowAngle(
  f: number,
  maxFlexionAngleDeg: number,
  releaseAngleDeg: number,
): number {
  if (f <= FLEXION_FRAME) {
    // Wind-up: flexion grows with a slight ease-in, minimum exactly at FLEXION_FRAME.
    const t = f / FLEXION_FRAME;
    return EXTENDED_ANGLE_DEG + (maxFlexionAngleDeg - EXTENDED_ANGLE_DEG) * Math.pow(t, 0.7);
  }
  if (f < RELEASE_FRAME) {
    // Extension with ease-out (decelerates near full extension).
    const t = (f - FLEXION_FRAME) / (RELEASE_FRAME - FLEXION_FRAME);
    const s = 1 - Math.pow(1 - t, 1.6);
    return maxFlexionAngleDeg + (releaseAngleDeg - maxFlexionAngleDeg) * s;
  }
  // Frozen follow-through keeps the release pose.
  return releaseAngleDeg;
}

function authoredUpperArmAngle(f: number): number {
  if (f < RELEASE_FRAME) {
    return UPPER_ARM_START_DEG - (UPPER_ARM_SWEEP_DEG / RELEASE_FRAME) * f;
  }
  // Frozen follow-through.
  return UPPER_ARM_START_DEG - UPPER_ARM_SWEEP_DEG;
}

/**
 * A point at `length` from (originX, originY) along `thetaDeg`.
 * Math convention has y up; image coordinates have y down.
 */
function pointOnArm(
  index: number,
  originX: number,
  originY: number,
  length: number,
  thetaDeg: number,
): PoseLandmark {
  const r = (thetaDeg * Math.PI) / 180;
  return { index, x: originX + length * Math.cos(r), y: originY - length * Math.sin(r) };
}

/** A point two segments out from the shoulder: elbow then wrist. */
function pointOnArm2(
  index: number,
  originX: number,
  originY: number,
  length1: number,
  theta1Deg: number,
  length2: number,
  theta2Deg: number,
): PoseLandmark {
  const elbow = pointOnArm(-1, originX, originY, length1, theta1Deg);
  return pointOnArm(index, elbow.x, elbow.y, length2, theta2Deg);
}
