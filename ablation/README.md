# ablation/

Four-pipeline (P0-P3) evidence ablation on the four committed real-data crops, evaluated at
one source-cell tolerance on a single retained-geometry set. Behind Table 7 (summary) and
Supplementary Table S2 (per-site detail).

- `reconstruct_ablation.cjs` - runnable driver. Rebuilds contours from the crops, applies the
  P0-P3 metadata rules, and reports per-site spans, promotions, and provenance losses. Run:
  `node ablation/reconstruct_ablation.cjs` (add `--strict` for the production eligibility rule).
- `ablation_summary.csv` - P0-P3 promotion/loss ranges (Table 7).
- `ablation_site_results.csv` - per-site frozen values (Supplementary Table S2).

The driver reproduces every frozen P0-P3 event count and denominator. One documented difference:
the reconstructed Marsh Island vertex-reduction rounds to 87.6% versus the archived 87.5%; the
driver reports the difference rather than overwriting it. This is a reconstructed driver, not the
original: see `../docs/RECONSTRUCTED_DRIVERS.md`. Pipelines: P0 grade-derived provenance +
endpoint-only support; P1 typed endpoint provenance/support; P2 grade-derived provenance +
complete-source EC-DP support; P3 typed provenance/support + complete-source EC-DP.
