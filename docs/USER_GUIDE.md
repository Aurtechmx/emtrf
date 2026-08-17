# User guide

## What this repository is
The reference implementation and reproducibility package for EMTRF, an operator contract that
preserves terrain evidential provenance through representation-only transformations, and EC-DP,
its evidence-constrained Douglas-Peucker variant.

## Directory map
- `js-study/` - standalone operator-contract study (typed operators, typed EC-DP, adversarial
  source-arc stress, gap and closed-ring fixtures, timing). Entry point: `js-study/reproduce.sh`.
- `oracles/` - two independent Python oracles (typed-evidence algebra; DP/EC-DP differential).
- `real-data-audit/` - Node harness over four committed public contour crops (Table 6),
  self-checksummed. Entry point: `real-data-audit/reproduce.sh`.
- `gdal-audit/` - third-party generalizer audit on `gdal_contour` geometry.
- `ablation/` - frozen P0-P3 evidence-ablation results (Table 7 / Supplementary Table S2).
- `benchmarks/` - EC-DP overhead microbenchmark (runnable) and reported timing values.
- `figures/` - figure-generation scripts (repo-root-relative paths).
- `data/` - `make_stream_features.cjs` regenerates the StREAM DTM coverage from the crop.

## Inputs, outputs, expected behavior
Each runnable step writes to a local `results/` directory and exits non-zero on any mismatch
against its frozen expectations. Inputs are the committed crops in `real-data-audit/crops/`
(third-party licenses in `DATA_LICENSES.md`) and deterministic seeded fixtures; no network or
external data is required except GDAL for the GDAL audit.

## Figures
`make_figures_restyle.py` and `make_figures_contour_example.py` are self-contained.
`make_figures_nextlevel.py` draws the StREAM map (Figure 8) from `data/stream_features.json`;
run `node data/make_stream_features.cjs` first to rebuild it from the crop. That step merges the
real DTM coverage with the committed feature-level contour overlay
(`data/stream_feature_level_export.json`, a reconstructed derived export; see
`RECONSTRUCTED_DRIVERS.md`), so Figure 8 regenerates completely, both the background and the
typed-contour overlay.
