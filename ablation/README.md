# ablation/

Four-pipeline (P0-P3) evidence ablation on the four committed real-data crops, evaluated at
one source-cell tolerance on a single retained-geometry set. Behind Table 3 (summary) and
Supplementary Table S2 (per-site detail).

- `reconstruct_ablation.cjs` - runnable driver. Rebuilds contours from the crops, applies the
  P0-P3 metadata rules, and reports per-site spans, promotions, and provenance losses. Run:
  `node ablation/reconstruct_ablation.cjs` (add `--strict` for the production eligibility rule).
- `ablation_summary.csv` - P0-P3 promotion/loss ranges (Table 3).
- `ablation_site_results.csv` - per-site frozen values (Supplementary Table S2).

The driver reproduces every frozen P0-P3 event count and denominator. One documented difference:
the reconstructed Marsh Island vertex-reduction rounds to 87.6% versus the archived 87.5%; the
driver reports the difference rather than overwriting it. This is a reconstructed driver, not the
original: see `../docs/RECONSTRUCTED_DRIVERS.md`. Pipelines: P0 grade-derived provenance +
endpoint-only support; P1 typed endpoint provenance/support; P2 grade-derived provenance +
complete-source EC-DP support; P3 typed provenance/support + complete-source EC-DP.

## Revision analyses

- `baselines.cjs` - compares ordinary DP (endpoint attribution), DP with length-weighted mean attribution over the replaced edges, DP with a vertex forced at every provenance-class change,
  DP on runs split to homogeneous evidence (exact, and with support binned at 10 and 25 points),
  and EC-DP, on the same strict feature runs and the same one-cell tolerance. Reports vertex
  cost, geometry change relative to DP, support promotion, provenance loss, and length-weighted
  over- and understatement of support. Output: `results/baselines_r2.json`,
  `baselines_site_results.csv`.
- `support_profiles.cjs` - replaces the cell support field with three alternative profiles
  (exponential count/distance, simple-kriging posterior variance, survey-style standard error)
  and re-runs the endpoint, grade-derived, and EC-DP attribution rules. Contour geometry is
  unchanged across profiles. Profile parameters are fixed in the file header. Output:
  `results/support_profiles_r3.json`, `support_profiles_site_results.csv`.
- `worked_example.cjs` - a downstream attribute query on the exported records ("measured support
  at least t and provenance measured only", with t the solid threshold 66 and, as a check, the
  dashed threshold 33). For DP with endpoint attribution and for EC-DP it reports, per site, the
  contour length the query accepts although a source edge under it fails the test, and the length
  it rejects although its source edge passes. It also traces one span chosen by a fixed rule
  (largest support promotion among DP spans that pass the query at t = 66) from the returns in
  each source cell to the two exported records. Output: `results/worked_example_r2.json`,
  `worked_example_site_results.csv`; figure: `figures/make_figure_worked_example.py`.
- `evidence_profile.cjs` - the support-profile record: per span, the fraction of represented source length
  at or above each display threshold (66, 33) in each channel, beside the minimum. Reports, per site, the
  well-supported length each record states against the true source length (endpoint, minimum, profile);
  checks that profiles of two-cell spans equal the length-weighted merge of one-cell spans; and checks that
  every scalar above the arc minimum admits a threshold at which the query accepts a partly failing span.
  Support only (no provenance condition), so lengths differ from the worked-example query. Output:
  `results/evidence_profile_r1.json`, `evidence_profile_site_results.csv`.
- `dissolve_tools.py` - default attribute handling of QGIS, GeoPandas, mapshaper and GDAL/OGR when per-segment
  records are dissolved into lines (rules: `docs/RULES_ADDITIONAL_TESTS.md`, D1); output
  `results/dissolve_tools_r1.json`.
- `export_dtm_grids.cjs` + `resample_gdal.py` - the contract applied to raster resampling with GDAL (rules: D3);
  output `results/resample_gdal_r1.json`.
- `ecwrap_tools.py` - EC-wrap on the Douglas-Peucker and Visvalingam simplifiers of QGIS and mapshaper, same runs and
  scoring (rules in `external-audit/PREREGISTRATION.md`, part A); output `results/ecwrap_tools_r1.json`. Also imported by
  `external-audit/external_audit.py`.
- `export_runs.cjs` + `ecwrap.py` - EC-wrap: given a source line with per-edge evidence and ANY simplifier's
  output that is a vertex subsequence keeping both ends, recovers the replaced interval of each output segment
  and attaches the complete-source minimum, provenance union and support profile. Demonstrated on
  Visvalingam-Whyatt (`simplification` package) at an area of one source cell squared. Output:
  `results/ecwrap_vw_r1.json`.
- `positional_uncertainty.cjs` - converts each cell's vertical standard error (standard-error profile) and the
  bilinear slope of each contour block (floored at 0.05 m/m) into a horizontal position uncertainty, and
  reports how often and by how much endpoint records understate a span's worst value. Rules are fixed in the
  file header. Output: `results/positional_uncertainty_r1.json`.
- `heldout_check.cjs` - held-out ground check. Splits each crop's ground returns at random into two halves
  (20 seeds), builds terrain, support and contours from one half and scores each cell against the mean of the
  held-out returns in it. Reports error by support class, the rank correlation of support and error, and
  whether the cells a promoted endpoint record hides have larger error. Rules are fixed in the file header.
  Output: `results/heldout_check_r1.json`.
- `optimal_bound.cjs` - exact search (shortest path over admissible shortcuts) for the fewest retained
  vertices within one-cell tolerance under four conditions: none; endpoint records never promote or lose
  provenance; endpoint records exact; and, for comparison, homogeneous splitting. Output:
  `results/optimal_bound_r1.json`.
- `positional_sensitivity.cjs` - repeats `positional_uncertainty.cjs` over a grid of instrument precision and
  slope floor (36 settings). Output: `results/positional_sensitivity_r1.json`.
- `../scale/` - the same method comparison on 129 crops cut by a fixed rule from 18 public-agency tiles; rules
  in `scale/README.md`. Output: `results/scale_test_r1.json`.
- `../supplementary/gen_methods_s15_s18.py` - writes Supplementary Methods S15-S18 from the four result files.
