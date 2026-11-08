/**
 * Synthetic FrameExtractor for testing the full pipeline without MediaPipe.
 *
 * Generates MediaPipe-style frame coordinates from a simplified biomechanics model:
 * - Elbow flexion from max (e.g. 95°) to release (e.g. 168°) over the delivery window
 * - High per-frame Confidence (0.95) so analysis sees valid frames
 * - Landmark indices match MediaPipe Pose numbering (11-16 for upper body)
 * - 2D coordinates in normalized image space (origin top-left, y down)
 *
 * Used when TEST_EXTRACTION_MODE=1 is set; the real FfmpegMediaPipeExtractor
 * is used otherwise. This enables end-to-end verification of the API→queue→worker→
 * analysis→notification flow without external model dependencies.
 */

import type { FrameCoordinates, PoseLandmark } from "@bowled/shared";

const DEFAULT_FRAME_COUNT = 40;
const MAX_FLEXION_DEG = 95;
const RELEASE_DEG = 168;

const SHOULDER_X = 0.5;
const SHOULDER_Y = 0.45;
const UPPER_ARM_LENGTH = 0.09;
const FOREARM_LENGTH = 0.085;

// MediaPipe Pose indices.
const LEFT_SHOULDER = 11;
const LEFT_ELBOW = 13;
const LEFT_WRIST = 15;
const RIGHT_SHOULDER = 12;
const RIGHT_ELBOW = 14;
const RIGHT_WRIST = 16;

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function computeElbowAngle(frameIndex: number, frameCount: number): number {
  // Ease-in flexion, ease-out extension (mirrors the analysis' authored model).
  if (frameIndex <= 20) {
    // Flexion: extended (170°) → max flexed (95°)
    const t = frameIndex / 20;
    return 170 + (MAX_FLEXION_DEG - 170) * Math.pow(t, 0.7);
  }
  if (frameIndex < 35) {
    // Extension with ease-out: max flexed → release
    const t = (frameIndex - 20) / (35 - 20);
    const s = 1 - Math.pow(1 - t, 1.6);
    return MAX_FLEXION_DEG + (RELEASE_DEG - MAX_FLEXION_DEG) * s;
  }
  // Frozen follow-through at release pose.
  return RELEASE_DEG;
}

function upperArmAngle(frameIndex: number, frameCount: number): number {
  if (frameIndex < 35) {
    // Arm sweeps over the top: -150° at start → -150° - 95° = -245° at release
    const t = frameIndex / 35;
    return -150 - 95 * t;
  }
  return -150 - 95; // frozen
}

function forearmAngle(upperArmAngle: number, elbowAngle: number): number {
  // Forearm folds over the top; straight arm ⇒ ≈180° offset from elbow angle.
  return upperArmAngle + (180 - elbowAngle);
}

function shoulderY(offset: number): number {
  return SHOULDER_Y - offset;
}

function landmark(index: number, x: number, y: number): PoseLandmark {
  return { index, x, y };
}

function pointOnArm(
  originX: number,
  originY: number,
  length: number,
  thetaRad: number,
): [number, number] {
  const x = originX + length * Math.cos(thetaRad);
  const y = originY - length * Math.sin(thetaRad); // image y is down
  return [x, y];
}

export class SyntheticExtractor {
  private frameCount: number;
  private fps: number;

  constructor(frameCount?: number, fps?: number) {
    this.frameCount = frameCount ?? DEFAULT_FRAME_COUNT;
    this.fps = fps ?? 120;
  }

  async extract(videoPath: string, captureFps: number): Promise<FrameCoordinates[]> {
    // videoPath is accepted for interface compatibility but not used in test mode.
    const frames: FrameCoordinates[] = [];
    for (let f = 0; f < this.frameCount; f++) {
      const elbowAngle = computeElbowAngle(f, this.frameCount);
      const uaRad = degToRad(upperArmAngle(f, this.frameCount));
      const [shoulderX, shoulderY] = pointOnArm(SHOULDER_X, SHOULDER_Y, UPPER_ARM_LENGTH, uaRad);
      const [forearmBaseX, forearmBaseY] = pointOnArm(
        shoulderX,
        shoulderY,
        UPPER_ARM_LENGTH,
        degToRad(forearmAngle(uaRad, elbowAngle)),
      );

      // Right arm landmarks (bowling arm - right side in side-on view)
      frames.push({
        frameIndex: f,
        timestampMs: Math.round((f * 1000) / captureFps),
        confidence: 0.95,
        landmarks: [
          landmark(LEFT_SHOULDER, SHOULDER_X - 0.12, SHOULDER_Y), // left shoulder (mirror)
          landmark(LEFT_ELBOW, shoulderX - 0.04, shoulderY - 0.02),
          landmark(LEFT_WRIST, shoulderX - 0.04, shoulderY - 0.05),
          landmark(RIGHT_SHOULDER, SHOULDER_X, SHOULDER_Y),
          landmark(RIGHT_ELBOW, shoulderX + 0.02, shoulderY - 0.02),
          landmark(RIGHT_WRIST, shoulderX + 0.02, shoulderY - 0.05),
        ],
      });

      // Left arm landmarks (non-bowling arm)
      // For simplicity, just mirror some positions or keep static
      frames.push({
        frameIndex: f,
        timestampMs: Math.round((f * 1000) / captureFps),
        confidence: 0.95,
        landmarks: [
          landmark(LEFT_SHOULDER, SHOULDER_X - 0.12, SHOULDER_Y),
          landmark(LEFT_ELBOW, shoulderX - 0.04, shoulderY - 0.02),
          landmark(LEFT_WRIST, shoulderX - 0.04, shoulderY - 0.05),
          // Right shoulder as a placeholder for the second arm set
          landmark(RIGHT_SHOULDER, SHOULDER_X + 0.1, SHOULDER_Y),
          landmark(RIGHT_ELBOW, shoulderX + 0.02, shoulderY - 0.02),
          landmark(RIGHT_WRIST, shoulderX + 0.02, shoulderY - 0.05),
        ],
      });
    }
    return frames;
  }
}