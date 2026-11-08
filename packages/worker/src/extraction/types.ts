/**
 * The designed Extraction seam.
 *
 * Everything about ffmpeg, MediaPipe, frame decoding, and per-frame failure
 * lives behind this one interface — Analysis consumes FrameCoordinates[] and
 * never knows how the video was touched.
 */

import type { FrameCoordinates } from "@bowled/shared";

export interface FrameExtractor {
  /** Convert one Delivery video into a coordinate matrix at `captureFps`. */
  extract(videoPath: string, captureFps: number): Promise<FrameCoordinates[]>;
}
