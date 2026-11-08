/**
 * Node adapter: ffmpeg decodes frames → MediaPipe Pose Landmarker per frame.
 *
 * This adapter is best-effort glue and is HARD isolated behind the
 * FrameExtractor interface — nothing outside extraction/ touches ffmpeg,
 * wire formats, or the @mediapipe/tasks-vision API.
 *
 * Failure modes:
 * - ffmpeg exits nonzero → Error carrying the stderr tail (transient-looking,
 *   classified by the pipeline: a poisoned file reaches the pipeline only if
 *   ffmpeg misdecodes quietly, so extraction throws PermanentDeliveryError
 *   only when it succeeds with zero frames);
 * - a single frame that MediaPipe cannot read yields a zero-Confidence frame
 *   (recorded and dropped by analysis) rather than a crash;
 * - every frame unreadable → PermanentDeliveryError with the first per-frame
 *   error, so the Delivery fails honestly with a clear reason.
 */

import { spawn, type ChildProcessWithoutNullStreams, type ChildProcessByStdio } from "node:child_process";
import { Readable } from "node:stream";
import { FilesetResolver, PoseLandmarker, type PoseLandmarkerResult } from "@mediapipe/tasks-vision";
import type { FrameCoordinates, PoseLandmark } from "@bowled/shared";
import { PermanentDeliveryError } from "../errors.js";
import type { FrameExtractor } from "./types.js";

// Keep the stderr tail for error reporting; the exit-code check decides
// whether it becomes an Error.
const STDERR_TAIL_BYTES = 8_192;

/**
 * Upper-body landmark indices (MediaPipe Pose numbering). Per-frame
 * Confidence is the MEAN of these six landmarks' visibility. Mean over min:
 * min over-reacts to a single occluded landmark and would drop recoverable
 * frames wholesale, while CONFIDENCE_THRESHOLD (enforced downstream by
 * analysis) still catches degraded footage; fast-bowler motion blur affects
 * the whole upper body roughly uniformly, so the mean tracks overall
 * landmark quality.
 */
const UPPER_BODY_INDICES = [11, 12, 13, 14, 15, 16];

export class FfmpegMediaPipeExtractor implements FrameExtractor {
  async extract(videoPath: string, captureFps: number): Promise<FrameCoordinates[]> {
    const { width, height } = await probeFrameSize(videoPath);
    const landmarker = await createPoseLandmarker();
    try {
      return await extractFrames(videoPath, captureFps, width, height, landmarker);
    } finally {
      landmarker.close();
    }
  }
}

/** ffprobe's JSON view of stream 0, reduced to the fields we need. */
type Probe = { width: number; height: number };

async function probeFrameSize(videoPath: string): Promise<Probe> {
  const proc = spawn("ffprobe", [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=width,height",
    "-of", "json",
    videoPath,
  ], { stdio: ["ignore", "pipe", "pipe"] });
  const stderr = collectStderr(proc);
  let code: number | null;
  let stdout: string;
  try {
    [code, stdout] = await Promise.all([waitForExit(proc), collectStdout(proc)]);
  } catch (error) {
    proc.kill();
    await ignoreExit(proc);
    throw new Error(`ffprobe failed for ${videoPath}: ${errorText(error)}`);
  }
  if (code !== 0) {
    throw new Error(`ffprobe exited with code ${code} for ${videoPath}: ${await stderr}`);
  }
  const parsed = JSON.parse(stdout) as { streams?: Probe[] };
  const stream = parsed.streams?.[0];
  if (!stream?.width || !stream?.height) {
    throw new PermanentDeliveryError(
      `ffprobe found no video stream with a frame size in ${videoPath}`,
    );
  }
  return { width: stream.width, height: stream.height };
}

/**
 * Decode the whole clip with ffmpeg at the requested fps and landmarker each
 * frame as it arrives. The pipeline is streaming: no more than a couple of
 * frames are buffered at a time, so a burst of jobs cannot exhaust memory.
 */
async function extractFrames(
  videoPath: string,
  captureFps: number,
  width: number,
  height: number,
  landmarker: PoseLandmarker,
): Promise<FrameCoordinates[]> {
  const proc = spawn("ffmpeg", [
    "-i", videoPath,
    "-vf", `fps=${captureFps}`,
    "-f", "rawvideo",
    "-pix_fmt", "rgba",
    "pipe:1",
  ], { stdio: ["ignore", "pipe", "pipe"] });
  const stderrTailPromise = collectStderr(proc);
  let exitCode: number | null | undefined;
  let exitError: unknown;
  proc.on("exit", (code) => { exitCode = code; });
  proc.on("error", (error) => { exitError = error; });

  const frames: FrameCoordinates[] = [];
  const frameBytes = width * height * 4;
  let frameIndex = 0;
  let detectionFailures = 0;
  let firstDetectionError: { message: string } | null = null;

  try {
    for await (const rgba of rgbaFrames(proc.stdout, frameBytes)) {
      try {
        frames.push(detectPose(landmarker, rgba, width, height, frameIndex, captureFps));
      } catch (error) {
        // A poisoned frame must not crash the run: record it as a zero
        // Confidence frame (analysis drops and records it downstream).
        frames.push(zeroConfidenceFrame(frameIndex, captureFps));
        detectionFailures++;
        firstDetectionError ??= { message: errorText(error) };
      }
      frameIndex++;
    }
  } finally {
    if (proc.exitCode === null) proc.kill();
  }
  const stderrTail = await stderrTailPromise;
  if (exitError !== undefined && exitError !== null) {
    throw new Error(`ffmpeg failed for ${videoPath}: ${errorText(exitError)}`);
  }
  if (exitCode === undefined || exitCode === null) {
    await ignoreExit(proc);
  }
  if (exitCode !== 0 && exitCode !== undefined && exitCode !== null) {
    throw new Error(`ffmpeg exited with code ${exitCode} for ${videoPath}: ${stderrTail}`);
  }
  if (frames.length === 0) {
    throw new PermanentDeliveryError(
      `extraction produced no frames from ${videoPath} (ffmpeg decoded successfully but nothing was usable)`,
    );
  }
  if (detectionFailures === frames.length) {
    throw new PermanentDeliveryError(
      `pose extraction failed for every frame of ${videoPath}: ${firstDetectionError?.message ?? "unknown error"}`,
    );
  }
  return frames;
}

/**
 * Async-iterate over fixed-size RGBA frames from ffmpeg's stdout. Chunks are
 * small, so the pending buffer never exceeds one frame + one chunk.
 */
async function* rgbaFrames(
  stdout: Readable,
  frameBytes: number,
): AsyncGenerator<Uint8Array> {
  let pending = Buffer.alloc(0);
  for await (const chunk of stdout) {
    const buf = Buffer.from(chunk as any);
    pending = pending.length === 0 ? buf : Buffer.concat([pending, buf]);
    let cursor = 0;
    while (pending.length - cursor >= frameBytes) {
      yield pending.subarray(cursor, cursor + frameBytes);
      cursor += frameBytes;
    }
    pending = pending.subarray(cursor);
  }
  // A trailing partial frame (truncated video) is not decodable content —
  // silently dropped, as ffmpeg-shaped signal, and reflected in the frame
  // count only.
}

function detectPose(
  landmarker: PoseLandmarker,
  rgba: Uint8Array,
  width: number,
  height: number,
  frameIndex: number,
  captureFps: number,
): FrameCoordinates {
  const result = landmarker.detect(toImageData(rgba, width, height));
  const pose = result.landmarks[0];
  if (!pose || pose.length === 0) {
    // The model ran but found no person: zero Confidence, dropped downstream.
    return zeroConfidenceFrame(frameIndex, captureFps);
  }
  const landmarks: PoseLandmark[] = pose.map((l, i) => ({
    index: i, // MediaPipe Pose Landmarker's own index space (0–32).
    x: l.x,
    y: l.y,
  }));
  return {
    frameIndex,
    timestampMs: Math.round((frameIndex * 1000) / captureFps),
    confidence: meanUpperBodyVisibility(result),
    landmarks,
  };
}

function zeroConfidenceFrame(frameIndex: number, captureFps: number): FrameCoordinates {
  return {
    frameIndex,
    timestampMs: Math.round((frameIndex * 1000) / captureFps),
    confidence: 0,
    landmarks: [],
  };
}

function meanUpperBodyVisibility(result: PoseLandmarkerResult): number {
  const pose = result.landmarks[0];
  if (!pose) return 0;
  let total = 0;
  let count = 0;
  for (const index of UPPER_BODY_INDICES) {
    const landmark = pose[index];
    if (!landmark) continue;
    total += visibilityOf(landmark);
    count++;
  }
  // A pose with none of indices 11–16 is not usable for the v1 Metric.
  return count === 0 ? 0 : total / count;
}

/**
 * tasks-vision landmarks expose `visibility` (0–1). Older typings sometimes
 * omit it at runtime, so fall back to 1 (the detection clearly found the
 * joint if the module handed it back).
 */
function visibilityOf(landmark: { x: number; y: number; z?: number; visibility?: number }): number {
  return typeof landmark.visibility === "number" ? landmark.visibility : 1;
}

/**
 * tasks-vision expects an ImageData-shaped source. Node has no ImageData
 * global, so when absent we hand over a minimal duck-typed object — the wasm
 * layer reads width/height/data directly. Best-effort by design: if the wasm
 * rejects the input, the per-frame catch turns it into a recordable failure,
 * and an all-frames failure surfaces as a clear PermanentDeliveryError.
 */
function toImageData(rgba: Uint8Array, width: number, height: number): ImageData {
  const data = new Uint8ClampedArray(rgba); // defensive copy
  if (typeof ImageData === "function") {
    return new ImageData(data, width, height);
  }
  return { width, height, data, colorSpace: "srgb" } as unknown as ImageData;
}

async function createPoseLandmarker(): Promise<PoseLandmarker> {
  const wasmDir = process.env.MEDIAPIPE_WASM_DIR;
  const modelPath = process.env.MEDIAPIPE_MODEL_PATH;
  if (!wasmDir || !modelPath) {
    throw new MissingExtractorMessage(
      "MediaPipe extraction is not configured: set MEDIAPIPE_WASM_DIR and MEDIAPIPE_MODEL_PATH",
    );
  }
  const fileset = await FilesetResolver.forVisionTasks(wasmDir);
  return PoseLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: modelPath, delegate: "CPU" },
    // Per-frame pipeline: each decoded frame is an independent still image.
    runningMode: "IMAGE",
    numPoses: 1,
  });
}

// The extraction root decides whether extraction is configured at all
// (makeFrameExtractor); its error type is re-thrown from every extract call
// of the stub. This deferred-message class only exists inside the adapter so
// that the configuration guard lives next to the MediaPipe options.
class MissingExtractorMessage extends PermanentDeliveryError {
  constructor(message: string) {
    super(message);
  }
}

function waitForExit(proc: ChildProcessByStdio<null, Readable, Readable>): Promise<number | null> {
  return new Promise((resolve, reject) => {
    proc.on("exit", (code) => resolve(code));
    proc.on("error", reject);
  });
}

function ignoreExit(proc: ChildProcessByStdio<null, Readable, Readable>): Promise<void> {
  return new Promise((resolve) => {
    proc.on("exit", () => resolve());
    proc.on("error", () => resolve());
  });
}

function collectStdout(proc: ChildProcessByStdio<null, Readable, Readable>): Promise<string> {
  let out = "";
  proc.stdout.setEncoding("utf8");
  proc.stdout.on("data", (chunk: string) => { out += chunk; });
  return new Promise((resolve) => {
    proc.stdout.on("end", () => resolve(out));
    proc.stdout.on("close", () => resolve(out));
  });
}

function collectStderr(proc: ChildProcessByStdio<null, Readable, Readable>): Promise<string> {
  let tail = "";
  proc.stderr.setEncoding("utf8");
  proc.stderr.on("data", (chunk: string) => {
    tail = (tail + chunk).slice(-STDERR_TAIL_BYTES);
  });
  return new Promise((resolve) => {
    proc.stderr.on("end", () => resolve(tail.trim()));
    proc.stderr.on("close", () => resolve(tail.trim()));
  });
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
