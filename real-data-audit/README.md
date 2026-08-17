# EMTRF Table 6 crop-processing bundle

This bundle isolates the code and committed crop inputs used to reproduce the four real-data diagnostics summarized in Table 6:

- raw contour segment count;
- measured-derived segment assigned the `dashed` display grade (`M -> dashed`);
- mixed measured/interpolated ancestry (`X`);
- endpoint-only source-arc support promotion at one source-cell tolerance;
- ordinary Douglas-Peucker vertex reduction at one source-cell tolerance.

It also emits the two-cell promotion audit reported in the surrounding Results text.

## Run

Requires Node.js only (no npm install):

```bash
./reproduce.sh
# or
node run_table6.cjs
```

The script writes:

- `results/table6.csv`
- `results/table6_full.json`
- `results/source_arc_2cell.csv`

and exits non-zero if any reported Table 6 count or rounded rate does not reproduce.

## Processing chain

For each committed crop:

1. Decode the frozen crop points.
2. Run the OLV production `rasterizeDtm(..., aggregation='mean')` implementation.
3. Run the production confidence-aware `buildDtmGrid` implementation.
4. Run production marching-squares `contoursAt` at a 0.5 m contour interval.
5. Recover each emitted segment's originating 2x2 DTM source block using geometry plus the segment's frozen confidence value. When a segment lies exactly on a shared block boundary, candidate blocks are confidence-matched and then deterministically resolved by nearest block centre and row/column order. This is the source-block recovery used for the frozen real-data audit and avoids an arbitrary midpoint-only assignment.
6. Derive source ancestry from the recovered block's `coverage` states: measured-only `M`, interpolated-only `I`, or mixed `X`.
7. Count `M -> dashed` directly from source ancestry versus the production display grade.
8. Stitch the production contour segment soup with `stitchContourSet`.
9. For closed rings, rotate to the lexicographically smallest `(x,y)` source vertex and duplicate the anchor to create a deterministic open sequence.
10. Run ordinary Douglas-Peucker with point-to-segment distance at one and two source-cell tolerances.
11. For every retained span, compare the retained-endpoint confidence minimum with the minimum across the complete represented source interval. An endpoint value above that complete-source minimum is a support-promotion event.
12. Compute one-cell vertex reduction from the same retained index sets. Open two-vertex polylines are excluded from the simplification denominator because they contain no interior source vertex to simplify.

The bundle also performs an exact generation-order source-block cross-check against the production marching-squares topology before applying the historical source-block recovery rule.

## Frozen Table 6 target

| Dataset | Segments | M -> dashed | X ancestry | Promote 1 cell | Vertex reduction |
|---|---:|---:|---:|---:|---:|
| USGS White Sands 2020 | 956 | 481 (50.3%) | 22 (2.3%) | 20/152 (13.2%) | 80.9% |
| StREAM 2026 | 766 | 85 (11.1%) | 453 (59.1%) | 6/152 (3.9%) | 75.2% |
| Estonia Tava 2020 | 1,315 | 83 (6.3%) | 682 (51.9%) | 7/344 (2.0%) | 66.3% |
| USGS Marsh Island | 1,980 | 9 (0.45%) | 39 (2.0%) | 9/175 (5.1%) | 88.8% |

Two-cell promotion targets are in `expected/source_arc_2cell_reported.csv`.

## Source provenance

The modules in `src/` are a frozen study-local snapshot of the OpenLiDARViewer terrain/contour
source, identified by their own per-file SHA-256 in `SHA256SUMS`. This snapshot is **not**
byte-identical to the v0.6.5 application release (git commit
`4fb00a784d860a2e24cc1834d6c1230dac550355`): it uses a hardened `cellConfidence` that leaves
otherwise-unreachable voids unsupported unless a bounded fallback is authorized, whereas the
release fills such voids by nearest support. That policy difference changes the supported terrain
domain and the downstream contour population, so Table 6 reproduces from this frozen snapshot, not
from the release modules. The production-source export defect audited in the paper is separate and
reproduces against the v0.6.5 release itself.

`dist/` contains a CommonJS compilation of the minimal dependency closure so the audit can be rerun with Node.js without rebuilding the full web application.

The original project license is included as `LICENSE`. Dataset metadata/citations are retained in `metadata/dataset_manifest.json`; crop hashes from the source tree are retained in `metadata/original_terrain_field_SHA256SUMS.txt` and independently recorded in `results/table6_full.json`.

## Scope

This bundle reproduces the Table 6 real-crop processing path. It is not the entire EMTRF supplementary artifact and does not include the separate synthetic adversarial fixtures, Python differential oracles, GDAL third-party audit, or the feature-level P0-P3 ablation.
