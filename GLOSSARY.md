# Glossary

Domain vocabulary for the Bowled backend. Use these terms exactly as defined — do not drift to synonyms. Missing terms are a signal for `/domain-modeling`, not for inventing language.

## Domain terms

- **Delivery** — one uploaded video clip of a single ball bowled. The atomic unit of analysis. Distinct uploads are always distinct Deliveries; metrics are never merged across Deliveries.
- **Delivery Angle** — the filming perspective of a Delivery (e.g. side-on, behind). v1 supports side-on only. Each Delivery has exactly one Delivery Angle, declared at upload.
- **Capture FPS** — the frame rate at which the Delivery's video was recorded, declared at upload. Measures the quality tier of the footage.
- **Metric** — a single measurable biomechanical quantity computed from coordinates (v1: elbow extension). Each Metric declares a required minimum Capture FPS.
- **Metric Capability** — the per-Metric Capture FPS floor. A Metric whose floor exceeds a Delivery's Capture FPS is not computed and not shown for that Delivery. Never present a Metric with watered-down accuracy.
- **Capability Tier** — the device/recording quality class implied by Capture FPS. Tiers gate which Metrics are offered.
- **Confidence** — per-frame landmark confidence from pose extraction. Frames below threshold are dropped, and dropped frames are recorded, never silently interpolated.
- **Report** — the coaching guidance output for one Delivery: computed Metric values with guidance framing. Always guidance, never a regulatory or legality verdict.
- **Coaching Guidance Framing** — the fixed language register of Reports: "consistent with X, film Y to confirm". Regulatory/ICC-legality language is banned permanently.

## Pipeline terms

- **Extraction** — the stage converting video frames into a coordinate matrix (ffmpeg → MediaPipe Pose Landmarker), exposed through a single interface.
- **Analysis** — pure-geometry measurement over the coordinate matrix, producing Metric values.
- **Synthetic Fixture** — test asset rendering videos/coordinate sequences from known ground-truth Joint positions, used to prove Analysis accuracy within a stated tolerance.
