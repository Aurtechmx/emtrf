# data/

Inputs for the StREAM map figure (Figure 8).

- `make_stream_features.cjs` - reads `../real-data-audit/crops/sl-field.bin`, runs the production
  rasterization and confidence-aware DTM, and merges the committed contour overlay into
  `stream_features.json` (`node data/make_stream_features.cjs`).
- `stream_features.json` - generated: the DTM coverage grid (2 = measured, 1 = interpolated,
  0 = none) plus the simplified typed-contour overlay. Deterministic; not hand-authored.
- `stream_feature_level_export.json` - the feature-level contour overlay for Figure 8
  (coordinates, display grade, and per-segment typed provenance). This is a reconstructed
  derived export (see `../docs/RECONSTRUCTED_DRIVERS.md`) that reproduces the StREAM ablation
  targets; `stream_fig8_summary.json` records the verification against those targets.

Figure 8 regenerates completely from these: `make_figures_nextlevel.py` draws the coverage as
background and the overlay as the two-panel grade-vs-typed comparison.
