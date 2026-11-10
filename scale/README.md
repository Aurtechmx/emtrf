# Scale test on public-agency tiles

Rules, written on 9 November 2026 before any crop was cut or scored.

**Tiles.** Every airborne LiDAR tile from a public agency programme that was on the author's disk on
that date: 8 USGS 3DEP tiles (AZ Coconino 2019), 4 USGS tiles (WI Racine and Kenosha 2017), 4
NOAA/USGS tiles (Hawaii 2020–2023), the USGS White Sands tile and the Estonian Land Board Tava tile.
The last two are the parent tiles of two of the paper's crops. The tiles were downloaded earlier for
other work. They are a convenience sample, not a random one.

**Crops.** Nine per tile, 100 m by 100 m, centred on the points at 1/4, 1/2 and 3/4 of the tile's
extent in each axis, lower-left corner floored to a whole metre. Ground returns only (class 2).

**Processing.** As for the paper's White Sands and Estonia crops: 1 m grid of 100 by 100 cells, 1 m
contour interval, one-cell Douglas–Peucker tolerance, the production modules, and the method set of
`ablation/baselines.cjs`.

**Exclusions.** A crop with fewer than 1,000 ground returns is skipped and counted. Rates are
reported for crops with at least 20 DP spans; pooled counts include every scored crop.

**Reported.** Crops scored; crops with at least one promoted span; the median, quartiles and range of
the per-crop promotion rate and provenance-loss rate under endpoint attribution; pooled rates by
survey; EC-DP promotion and loss (expected 0); and the vertex multiple of SPLIT-0 over DP. The paper's
two parent tiles are reported with and without.

**Amendment, 9 November 2026, after the crops were cut and before any crop was scored.** Cutting showed
two cases the rules did not cover. No crop had been scored when this was written.

1. Two Hawaii tiles are small (about 494 by 83 m and 46 by 204 m), so some of their nine crops overlap
   or coincide. Rule added: within a tile, crops are taken in order (south to north, west to east within
   a row) and a crop is dropped if its square overlaps a crop already kept. Dropped crops are counted as
   "overlap".
2. Both Kenosha tiles have ground returns only in one corner, and none of their crops reaches it. The
   White Sands parent tile has two crops outside its data. These fall under the existing rule (fewer
   than 1,000 ground returns: skipped and counted). Nothing is moved to find data.

Quartiles are computed by linear interpolation between order statistics.

`extract_crops.py` cuts the crops with PDAL; `scale_test.cjs` scores them. `heldout_scale.cjs` repeats the held-out ground
check on the scored crops (rules: `docs/RULES_ADDITIONAL_TESTS.md`, D2; output `results/heldout_scale_r1.json`). The crops are not in the
repository (size); their SHA-256 digests are in the result file.
