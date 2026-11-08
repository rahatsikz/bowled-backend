# Bowled backend

A bowler uploads one side-on, slow-motion (≥120fps) clip of a single **Delivery**; the backend extracts skeletal coordinates frame-by-frame, computes **elbow extension** by pure geometry, and returns a coaching-style **Report** — guidance framing, no legality verdicts. Push notification on terminal state.

This is the backend of the Bowled product; the mobile app lives elsewhere. The spec behind v1 lives at `.scratch/elbow-extension-loop/spec.md`. Decision records go in `docs/adr/`; the fixed domain vocabulary is in `GLOSSARY.md`.

## Layout

| Package | Role |
| --- | --- |
| `packages/shared` | Domain types, the Metric Capability FPS floor, the DB schema |
| `packages/analysis` | **Analysis**: pure-geometry elbow measurement over the coordinate matrix, frozen-template Reports, the LLM-constrained paraphraser seam, and the Synthetic Fixture |
| `packages/api` | Upload (streamed, per-route size limit), device registration, status/Report retrieval |
| `packages/worker` | Bounded-concurrency worker: Extraction (ffmpeg + MediaPipe Pose Landmarker behind one `FrameExtractor` interface), pipeline orchestration, FCM notifications |

## Pipeline

```
upload (streamed to disk, BullMQ hand-off)
  → Extraction   ffmpeg → MediaPipe Pose Landmarker → FrameCoordinates[] (per-frame Confidence)
  → Analysis     elbow angle per frame → Confidence drop → confidence-weighted release aggregation
  → Report       frozen templates (facts from the math only) → optional LLM paraphrase (claims re-validated, hallucinations discarded)
  → notify       FCM on terminal state
```

Analysis never frames measurement as verdict: the elbow extension **Metric** under-reports ulna rotation in 2D, so Reports say "consistent with…", never "legal/illegal".

## Metric Capability

Each Metric declares its required minimum Capture FPS (`METRIC_FPS_FLOOR`). Filmed at 60fps, elbow extension is **withheld** — nothing is shown, no confident-looking numbers on footage that can't support them. The Report explains the gate honestly.

## Accuracy — the Synthetic Fixture

`packages/analysis/src/fixture/synthetic.ts` is a validation deliverable, not a test util: it authors MediaPipe-style coordinate sequences from known 3D poses (orthographic side-on projection, motion in the image plane, exactly-known elbow angles, exactly-authored release frame and follow-through).

**Stated tolerance: ±5°** for every seam-level assertion (release angle, max flexion, extension delta) between the pipeline output and the fixture's ground truth.

The one smoke seam test (`packages/worker/test/smoke.test.ts`, run with `SMOKE_FULL=1`, needs ffmpeg + a MediaPipe model) pushes a real fixture-encoded video through the full worker and asserts a broad ±15° tolerance — proving the fixture is MediaPipe-realistic, not proving math.

## Trade-offs deliberately made for v1

- **BullMQ at day one** despite zero users — hand-off between API and worker needs "uploads outlive the request"; Redis is the cheapest honest answer.
- **Uploads streamed through Express/busboy** instead of presigned object storage — video goes to local disk via `busboy` streams; an 80MB upload never buffers in memory. Presigned S3 comes when storage moves off the VPS.
- **Metric Capability gating instead of disclaimers** — a 60fps Delivery gets *no* elbow numbers, not watered-down ones with asterisks.
- **Frozen templates + re-validated LLM claims** — the paraphraser may reword math-derived Facts; claims re-anchor to fact IDs and re-check numbers, so hallucinated biomechanics never reach a user.
- Node runs the packages via `tsx` (TS sources) — no build step in v1; fine at single-VPS scale, revisit on the container image size.

## Known open risk

Motion blur at 120fps around the fastest joints degrades landmark Confidence. Mitigation: the Confidence-drop path records dropped frames rather than interpolating, and a low-usable-frame count is a clear failure reason — the app tells the user to re-film. A deblurring spike is *out of scope* (would need a pre-agreed kill metric).

## Running

```sh
corepack pnpm install
docker compose up --build
# API on :3000
```

Local dev without Docker needs Postgres + Redis (`DATABASE_URL`, `REDIS_URL`) and, for the worker, ffmpeg plus a MediaPose model mounted at `./models`.

```sh
corepack pnpm -F @bowled/analysis test   # seam tests (no infra needed)
SMOKE_FULL=1 corepack pnpm -F @bowled/worker test   # the one smoke test (needs ffmpeg + model)
```

## API sketch

```
POST /deliveries     multipart: video=<mp4>, captureFps=<int>, deliveryAngle=side-on
                     → 201 { deliveryId, status: "queued" }
POST /devices        { pushToken }  → 201 { deviceId }
GET  /deliveries/:id → { status, failureReason?, report? }   (report present only on terminal states)
GET  /healthz        → { ok: true }
```

Auth is minimal key-based attribution in v1 (`x-user-key` header → user upsert). Notifications fire when an analysis reaches a terminal state, to devices registered by the same user key.
