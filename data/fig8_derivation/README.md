# Figure 8 derivation chain

Intermediate artifacts from the reconstructed StREAM Figure 8 pipeline (crop to typed contour
overlay), provided so each transformation is inspectable:

- `stream_dtm_full.json` - confidence-aware DTM (heights, confidence, coverage) from the crop.
- `stream_contour_segments.json` - production marching-squares segments per level.
- `stream_stitched_polylines.json` - segments stitched into polylines with per-vertex confidence.
- `stream_feature_runs_full.json` - display-grade feature runs before simplification.
- `stream_fig8_complete.json` - full record combining the above with the simplified export.

The compact overlay used by the figure is `../stream_feature_level_export.json`; its verification
against the frozen StREAM ablation targets is `../stream_fig8_summary.json`. These are reconstructed
derived data (see `../../docs/RECONSTRUCTED_DRIVERS.md`), not lost originals.
