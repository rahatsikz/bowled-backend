## Problem Statement

A cricket fast bowler has no accessible way to check their own bowling action for known faults (e.g., elbow extension at release). Professional biomechanics assessment requires multi-camera motion capture that costs hundreds of dollars per session; a coach may not be available or affordable. The bowler records themselves on a phone but has no way to turn that footage into trustworthy, specific feedback.

## Solution

A bowler uploads a single side-on, slow-motion (≥120fps) clip of one Delivery from the mobile app. The backend extracts skeletal coordinates frame-by-frame, computes elbow extension from those coordinates using pure geometry, and generates a coaching-style Report that states the measured values, explains them in pre-approved fault language, and suggests one corrective focus — with honest framing that this is guidance, not a regulatory verdict. The Report is returned via API and pushed to the device when ready.

## User Stories

1. As a bowler, I want to upload a trimmed side-on clip of a single Delivery, so that I can get feedback on my action without a coach or lab.
2. As a bowler, I want my analysis to run in the background while I do something else, so that I don't have to keep the app open.
3. As a bowler, I want a push notification when my Report is ready, so that I don't have to poll the app.
4. As a bowler, I want to see the status of my submitted clip (queued / processing / complete / failed), so that I know whether it worked.
5. As a bowler, I want a clear failure reason if my clip is unusable (too blurry, too short, wrong Delivery Angle), so that I can re-film it correctly instead of receiving nonsense numbers.
6. As a bowler, I want the Report to use guidance framing ("consistent with…"), so that I don't believe my action is legally "cleared" by an app.
7. As a bowler on a phone that records 60fps, I want to only see metrics that are valid at my Capability Tier, so that I never receive confident-looking numbers I can't trust.
8. As a bowler, I want the Report to suggest one focused corrective point, so that I know what to change rather than being overwhelmed.
9. As a bowler, I want my Report to be retrievable by ID later, so that I can compare across sessions in the future.
10. As a bowler, I want to register my device for notifications once, so that future submissions don't require re-registration.
11. As a worker, I want to process videos with bounded concurrency, so that a burst of uploads can't exhaust the server's CPU or memory.
12. As an API, I want large video uploads streamed to disk rather than buffered in memory, so that an 80MB upload cannot OOM the process.
13. As an API, I want per-route upload size limits, so that malformed or oversized requests are rejected cheaply.
14. As an operator, I want a failed video to fail its job and mark its analysis as failed with a reason, so that one poisoned file can't wedge the queue.
15. As an operator, I want queue depth and job state visible via logs/metrics, so that I can tell when the bounded-concurrency model is saturated.
16. As a developer, I want the extraction stage behind a single interface, so that analysis logic can be tested without MediaPipe flakiness.
17. As a developer, I want a synthetic fixture that renders videos with known ground-truth joint angles, so that I can prove the math pipeline is accurate to within a stated tolerance.
18. As a developer, I want the report generator to render without the LLM when the LLM call fails, so that Report delivery never depends on an external text model's availability.
19. As a developer, I want the LLM constrained to only describe faults the math returned, so that no hallucinated biomechanics advice ever reaches a user.
20. As a developer, I want low-confidence frames dropped and recorded as dropped, so that degraded footage yields honest results rather than smoothly-interpolated lies.

## Implementation Decisions

- **Monorepo layout**: pnpm workspaces with `api`, `worker`, and `analysis` packages; shared TypeScript types for Delivery metadata, frame coordinates, metrics, and Reports. Node.js + TypeScript; deployed via Docker Compose (api, worker, Redis, Postgres; ffmpeg bundled in the worker image).
- **Data model**: users (minimal key-based auth in v1), devices (push tokens), Deliveries (video file path, declared Delivery Angle, Capture FPS, status), analyses (status, computed metric values, dropped-frame record, Report text, failure reason).
- **Upload path**: multipart POST to the API, streamed directly to disk (no full-body buffering), per-route size limit; validated fields: Delivery Angle, Capture FPS.
- **Queue**: BullMQ over Redis for API→worker handoff; worker concurrency capped at 1–2; terminal states on failure; bounded retries for transient errors only.
- **Extraction**: worker extracts frames (ffmpeg) and runs MediaPipe Pose Landmarker per frame, emitting a coordinate matrix with per-frame Confidence. The whole stage is exposed through one interface consumed by analysis.
- **Analysis**: pure TypeScript geometry over the coordinate matrix — elbow extension angle per frame across the delivery window, Confidence-weighted aggregation, frames below a Confidence threshold dropped and recorded. 2D elbow angle is known to under-report ulna rotation; therefore analysis output frames measurement, never verdict. Each Metric declares its required minimum Capture FPS; **Metric Capability gating** filters results by the Delivery's declared Capture FPS (decision: elbow extension requires ≥120fps).
- **Report**: frozen fault-description templates parameterized by computed numbers only; an LLM (cheap text model) may paraphrase strictly within the templates' factual claims; a fallback path renders templates without the LLM if the call fails. No regulatory/ICC-legality language — guidance framing is mandatory and enforced by template content.
- **Notification**: FCM push (firebase-admin) when an analysis reaches a terminal state.
- **API surface**: upload Delivery (multipart), register device (push token), get Delivery/analysis status and Report.
- **Domain terms (fixed)**: **Delivery** (one uploaded clip), **Delivery Angle** (e.g. side-on), **Capture FPS**, **Metric Capability** (per-metric fps floor), **Confidence** (per-frame landmark confidence), **Report**, **Capability Tier** (device fps class). These seed `GLOSSARY.md`.

## Testing Decisions

- A good test tests observable behavior at a module boundary — inputs to output artifacts — never internal call graphs or data structure shapes.
- **Primary seam (the one designed seam)**: the analysis pipeline boundary — frame coordinates in → Report out. Tests drive it with synthetic coordinate sequences generated from the fixture of known 3D poses projected to 2D. Assertions: computed angles within stated tolerance of ground truth; correct Metric Capability gating at/under fps floors; correct dropping of low-Confidence frames; correctness of the LLM-free fallback Report; LLM-assisted Report contains only math-derived claims.
- **Smoke seam (exactly one test, may be demoted to dev-only)**: a real fixture-encoded video file through the full worker; asserts completion and broad metric tolerance — proves the fixture is MediaPipe-realistic.
- Prior art: none — greenfield. The analysis package and fixture are the first tests in the repo and establish the convention (build test-first per the `tdd` skill; tests colocated, behavioral).

## Out of Scope

- The mobile app itself (separate project/repo; this spec defines only the API it consumes). iOS. Web uploader.
- Merging metrics across multiple Deliveries or Delivery Angles; any cross-Delivery session model.
- Additional faults (knee flexion, front-on/behind angles) beyond the one Metric, v1 scope.
- ICC legality/pass-fail verdicts — excluded as a product claim permanently.
- Deblurring/super-resolution handling — only a possible *timeboxed spike* with a pre-agreed kill metric, not this spec.
- Payments, coach accounts, academies, dashboards, report-comparison UI.
- Auth beyond minimal key-based attribution; hardened rate limiting.
- CI/cloud deployment beyond Docker Compose and a single-VPS deploy script.

## Further Notes

- The validation fixture is a deliverable, not a hidden test util: it gets documented in the README with its accuracy tolerance, and is a portfolio headline.
- Trade-offs deliberately made for this loop (to be documented in the README): BullMQ at day one despite zero users; uploads through Express (streamed) instead of presigned object storage; Metric Capability gating instead of disclaimers.
- Known open risk: motion blur at 120fps around the fastest joints. Mitigation is the Confidence-drop + re-film prompt path, plus the timeboxed spike.
- First docs to exist in the repo: `GLOSSARY.md` seeded from the domain terms above when scaffolding begins; this spec is the first issue.

_Origin: derived from a design grilling session; consensus reached on framing (guidance, not legality), single-Delivery data model, per-metric fps gating, streamed uploads, frozen-template LLM reports, and synthetic-fixture-first testing._
