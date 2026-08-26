# Provenance of these drivers

These three files are **reconstructed reproduction drivers**, not rediscovered originals:

- `ablation/reconstruct_ablation.cjs`
- `bootstrap/reconstruct_polyline_bootstrap.cjs`
- `benchmarks/reconstruct_real_contour_timing.cjs`

The original source files that produced the paper's P0–P3 ablation, deterministic
polyline-cluster bootstrap, and 289-polyline timing numbers were not present in the
surviving EMTRF/OLV archives searched on 2026-08-16. The reconstruction is therefore
explicitly provenance-labeled rather than back-dated or represented as original code.

## Reconstruction anchors

1. The exact four public crop files and the preserved terrain/contour modules.
2. `real-data-audit/run_table6.cjs`, which reproduces the paper's four-crop Table 3
   source-arc audit and exposes the per-polyline cluster records.
3. The frozen manuscript definitions of P0, P1, P2, P3.
4. The production `contourFeatureModel` single-grade run split.
5. The production `contourGeometryProduct` Douglas–Peucker implementation, including
   its unbounded perpendicular-line projection used by the feature-level ablation.
6. Frozen per-site ablation CSVs, bootstrap intervals, and timing values.

## What reproduces exactly

### Ablation
In archive-compatible mode, the reconstructed driver reproduces **all frozen event
counts and denominators**:

- White Sands: 82 spans, 20 support promotions, 77 grade-provenance losses, 0 typed-endpoint losses.
- Estonia Tava: 172, 11, 172, 13.
- StREAM: 54, 12, 54, 1.
- Marsh Island: 184, 8, 182, 0.

P2/P3 support promotion is zero by complete-source aggregation and P3 provenance loss
is zero by complete-source ancestry union.

**The paper reports `--strict`.** Strict retains every eligible span and applies no
result-defined exclusion: Marsh Island is 186 spans, 87.4% vertex reduction, 183 grade-
provenance losses. Archive-compatible mode drops the two one-edge Marsh feature runs
required to land on the 2026 archived 184-span denominator; because that exclusion is
defined by the target number rather than by an independent eligibility rule, it is kept
only as a historical cross-check, not as the reported result. The original Marsh
eligibility bookkeeping is not recoverable from the surviving artifacts. `run_all.sh`
verifies strict against the published Table S2 values and separately confirms that
archive-compatible still reproduces the 2026 frozen counts.

Switching modes changes no reported range in the paper: grade-provenance loss stays
93.9-100%, endpoint-only promotion stays 4.3-24.4%, and P2/P3 stay zero on all four sites.
Only Marsh Island moves (184 -> 186 spans, 87.5/87.6% -> 87.4% reduction).

### Bootstrap
The input clusters, observed numerators, and denominators come directly from the preserved
Table 3 audit. The original bootstrap RNG seed was not archived. A disclosed xorshift32
seed of `208` reproduces all four published one-decimal intervals exactly with 10,000
whole-polyline resamples. Because that seed was chosen to match published values, the driver
also runs six independent seeds and writes every interval to the output. Across all seven
seeds the bounds move by at most 0.3 percentage points (Estonia Tava is identical on every
seed), so the seed choice does not affect any reported bound.

### Real-contour timing
The driver reconstructs the exact documented corpus identity: **289 eligible stitched
polylines and 5,305 source vertices per pass**. It uses 5 warmups, 30 paired repetitions,
alternating order, and 100 corpus passes per timed repetition. Retained geometry is asserted
identical between the ordinary DP and complete-source evidence pass.

Historical wall-clock values are not asserted to reproduce on another CPU/Node/JIT build.
The frozen values are retained beside the new run for comparison.
