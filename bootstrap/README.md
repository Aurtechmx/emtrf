# bootstrap/

Deterministic 10,000-replicate whole-polyline cluster bootstrap of the one-cell source-arc
promotion rate on the four crops (Figure 7 intervals).

- `reconstruct_polyline_bootstrap.cjs` - runnable driver. It draws the per-polyline cluster
  records from the real-data audit (`../real-data-audit/results/table6_full.json`, regenerating
  it if absent) and resamples whole polylines. Run:
  `node bootstrap/reconstruct_polyline_bootstrap.cjs`.

The input clusters, numerators, and denominators come from the preserved Table 3 audit. The
original RNG seed was not archived; a disclosed xorshift32 seed of 208 reproduces all four
published one-decimal intervals, and a multi-seed sensitivity panel is written to the output so
the choice is inspectable. This is a reconstructed driver: see `../docs/RECONSTRUCTED_DRIVERS.md`.
