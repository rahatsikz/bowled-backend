import { expect, it } from "vitest";
import { analyzeDelivery, syntheticDelivery } from "@bowled/analysis";

/** The spec's stated accuracy tolerance for the analysis pipeline, in degrees. */
const TOLERANCE_DEG = 5;

function expectWithin(actual: number, expected: number, tolerance = TOLERANCE_DEG) {
  expect(
    Math.abs(actual - expected),
    `expected ${actual} to be within ${tolerance}° of ${expected}`,
  ).toBeLessThanOrEqual(tolerance);
}

it("measures elbow extension within tolerance of the fixture's ground truth", async () => {
  const { frames, metadata, groundTruth } = syntheticDelivery({
    fps: 120,
    maxFlexionAngleDeg: 95,
    releaseAngleDeg: 168,
  });

  const report = await analyzeDelivery({ frames, metadata });

  const metric = report.metrics.find((m) => m.metric === "elbow-extension");
  if (!metric) throw new Error("elbow-extension metric missing from Report");
  expectWithin(metric.releaseAngleDeg, groundTruth.releaseAngleDeg);
  expectWithin(metric.maxFlexionAngleDeg, groundTruth.maxFlexionAngleDeg);
  expectWithin(metric.extensionDeltaDeg, groundTruth.extensionDeltaDeg);

  // All frames were high Confidence — none dropped.
  expect(metric.validFrameCount).toBe(frames.length);
  expect(metric.droppedFrameCount).toBe(0);
  expect(report.droppedFrames).toEqual([]);

  // Reports are always guidance, never a legality verdict.
  expect(report.framing).toBe("guidance");
});

it("withholds the elbow Metric entirely below its Capability floor of 120fps", async () => {
  const { frames, metadata, groundTruth } = syntheticDelivery({
    fps: 60,
    maxFlexionAngleDeg: 95,
    releaseAngleDeg: 168,
  });

  const report = await analyzeDelivery({ frames, metadata });

  // No confident-looking numbers the footage can't support.
  expect(report.metrics).toEqual([]);
  expect(report.gatedMetrics).toEqual([
    {
      metric: "elbow-extension",
      reason: "capture-fps-below-floor",
      requiredFps: 120,
      captureFps: 60,
    },
  ]);
  expect(report.narration).not.toContain(String(groundTruth.releaseAngleDeg));
  expect(report.framing).toBe("guidance");
});

it("computes the elbow Metric when Capture FPS exactly meets the floor", async () => {
  const { frames, metadata, groundTruth } = syntheticDelivery({ fps: 120 });

  const report = await analyzeDelivery({ frames, metadata });

  const metric = report.metrics.find((m) => m.metric === "elbow-extension");
  expect(metric).toBeDefined();
  expectWithin(metric!.releaseAngleDeg, groundTruth.releaseAngleDeg);
});

it("drops low-Confidence frames, records them, and never reads their lies", async () => {
  const { frames, metadata, groundTruth } = syntheticDelivery({ fps: 120 });

  const DROPPED_FRAME_COUNT = 11;
  const corruptButLowConfidence = frames.slice(0, DROPPED_FRAME_COUNT);
  for (const frame of corruptButLowConfidence) {
    frame.confidence = 0.3;
    // A wild pose whose elbow angle (~10°) would poison max flexion if it leaked.
    const elbow = frame.landmarks.find((l) => l.index === 14)!;
    const wrist = frame.landmarks.find((l) => l.index === 16)!;
    wrist.x = elbow.x + 0.001;
    wrist.y = elbow.y + 0.001;
  }

  const report = await analyzeDelivery({ frames, metadata });

  expect(report.droppedFrames).toEqual([
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
  ]);
  const metric = report.metrics.find((m) => m.metric === "elbow-extension");
  if (!metric) throw new Error("elbow-extension metric missing from Report");
  expect(metric.validFrameCount).toBe(frames.length - DROPPED_FRAME_COUNT);
  expect(metric.droppedFrameCount).toBe(DROPPED_FRAME_COUNT);

  // The wild ~10° poses were dropped, not smoothed over: ground truth stands.
  expectWithin(metric.maxFlexionAngleDeg, groundTruth.maxFlexionAngleDeg);
  expectWithin(metric.releaseAngleDeg, groundTruth.releaseAngleDeg);
  expectWithin(metric.extensionDeltaDeg, groundTruth.extensionDeltaDeg);
});

it("renders the LLM paraphrase when the paraphraser succeeds", async () => {
  const { frames, metadata, groundTruth } = syntheticDelivery({ fps: 120 });

  const report = await analyzeDelivery({
    frames,
    metadata,
    llm: {
      paraphrase: async (facts) =>
        facts.map((fact) => ({ factIds: [fact.id], text: `THE FACT: ${fact.claim}` })),
    },
  });

  // Narration is metric-grounded: the math's numbers reach the reader.
  expect(report.narration).toContain(`${groundTruth.releaseAngleDeg}`);
  expect(report.narration).toContain("at release");
  expect(report.narration).not.toBe(
    (await analyzeDelivery({ frames, metadata })).narration,
  );
});

it("refuses LLM claims that depart from the math's numbers", async () => {
  const { frames, metadata, groundTruth } = syntheticDelivery({ fps: 120 });

  const report = await analyzeDelivery({
    frames,
    metadata,
    llm: {
      paraphrase: async (facts) => [
        // Grounded rewording of the extension fact.
        {
          factIds: [facts.find((f) => f.id === "extension")!.id],
          text: `the elbow swung through ${groundTruth.extensionDeltaDeg}° of extension before release`,
        },
        // Fabricated number: never measured by the math.
        {
          factIds: [facts.find((f) => f.id === "release-angle")!.id],
          text: `consistent with a throw measuring 141° at release`,
        },
        // Fabricated claim with no anchor to any fact.
        { factIds: [], text: "your action resembles a javelin throw" },
      ],
    },
  });

  expect(report.narration).toContain(`${groundTruth.extensionDeltaDeg}`);
  expect(report.narration).not.toContain("141");
  expect(report.narration).not.toContain("javelin");
});

it("falls back to the frozen template when the LLM paraphraser fails", async () => {  const { frames, metadata } = syntheticDelivery({ fps: 120 });

  const withBrokenLlm = await analyzeDelivery({
    frames,
    metadata,
    llm: {
      paraphrase: () => Promise.reject(new Error("rate limited")),
    },
  });
  const withoutLlm = await analyzeDelivery({ frames, metadata });

  // Report delivery never depends on the paraphraser's availability.
  expect(withBrokenLlm.metrics).toHaveLength(1);
  expect(withBrokenLlm.narration).toBe(withoutLlm.narration);
  expect(withBrokenLlm.framing).toBe("guidance");
  expect(withBrokenLlm.narration).toContain("consistent with");
});
