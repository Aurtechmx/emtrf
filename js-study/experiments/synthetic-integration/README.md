# Synthetic integration experiment (optional)

This optional layer exercises the EMTRF contour path on a compiled OpenLiDARViewer terrain core, which is not bundled here (set `EMTRF_OLV_CORE` to run it; see the harness header). It is separate from the standalone typed-evidence reference modules and is not required to reproduce any reported result. The manuscript's audited OpenLiDARViewer release is v0.6.5 (see the top-level `real-data-audit/`).

## Scientific role

The experiment distinguishes three questions:

1. **geometric correctness** against analytic surfaces;
2. **evidence-state correctness** for measured/interpolated/unsupported masks;
3. **terrain-estimator accuracy**, which is reported separately and is not treated as EMTRF representation conformance.

The main deterministic fixtures are:

- **P01** fully measured 2-D plane, `z = 100 + 0.08 x + 0.06 y`;
- **P02** same plane with a 20 m observation strip removed and accepted as interpolation-derived terrain;
- **P03** same raw points as P02 with a four-cell interpolation refusal rule, producing explicit unsupported cells;
- **A02** identical elevation/geometry with a changed evidence state, proving that geometry does not identify provenance;
- **P04** one-sided support / extrapolation-guard ablation;
- **P05** Gaussian hill with a central observation band removed.

Exact outputs are recorded in `../../results/synthetic-integration.json`.

## Important density note

The fixture variable is **controlled ground returns per raster cell**, not acquisition pulse density. It must not be labelled as a USGS 3DEP quality level. USGS Lidar Base Specification 2025 rev. A defines QL2 using aggregate nominal pulse density of at least 2 pulses/m² and a 1 m DEM cell size. Those acquisition quantities are not interchangeable with retained ground-return counts in this synthetic rasterization fixture.
