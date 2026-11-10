# Rules fixed before the run (9 November 2026)

Two tests were added to the study. Their rules were written here before either was run, and every
outcome is reported whichever way it falls. Only the geometry of the inputs (extent, point density,
vertex spacing, agreement of contour and point elevations) was inspected beforehand; no promotion
count was computed before this file was written.

## A. Further simplifiers on the four crops (`ablation/ecwrap_tools.py`)

Input: the production contour runs of the four crops (`results/feature_runs.json`, the input of the
Visvalingam-Whyatt test in Supplementary Methods S12).

Simplifiers, each at a tolerance of one source cell as that tool defines it:

| Label | Tool | Call |
|---|---|---|
| QGIS DP | QGIS `native:simplifygeometries`, method 0 (distance; GEOS) | `TOLERANCE` = one cell |
| QGIS VW | QGIS `native:simplifygeometries`, method 2 (Visvalingam; QGIS's own code) | `TOLERANCE` = one cell |
| mapshaper DP | mapshaper `-simplify dp planar` | `interval` = one cell |
| mapshaper VW | mapshaper `-simplify visvalingam planar` | `interval` = one cell |

Each output line is matched to its source vertices by EC-wrap (`ablation/ecwrap.py`). A line whose
output is not a vertex subsequence of its source with both ends kept is counted as unmatched and
reported. Scoring is the scoring of S12: an output span shows support promotion if, in either
channel, the record built from its two end segments exceeds the minimum over all segments it
replaces; it shows provenance loss if a provenance type among the replaced segments is absent from
the two end segments. EC-wrap's own records are scored by the same rule.

## B. Third-party contours and points (`external-audit/external_audit.py`)

Data: Zenodo record 10.5281/zenodo.12771247 (You and Lee, 2024; CC0), both files as published
(`Contour.ods`, md5 e37117dc7096b9d67e8cb16fac66e2b4; `LidarData.ods`, md5
87fb43301630729da67a0af493ae5a95), converted to CSV by `ods2csv.py` without editing. The point file
is kept as X, Y, Z; its twelve tensor columns are not used. The record does not state how the
contours were produced; they are used as published.

1. **Lines.** Each `LineNum` is one line, vertices in file order. Lines with fewer than three
   vertices cannot be simplified and are left out; the number left out is reported.
2. **Grid.** Square cells of side L = sqrt(bounding-box area of the points / number of points),
   rounded up to a whole metre (5 m). The grid starts at the south-west corner of the joint bounding
   box of points and contour vertices; a point belongs to the cell whose half-open square contains it.
3. **Cell evidence.** A cell with at least one point is measured, with its point count. A cell with
   none is interpolated, with the distance from its centre to the centre of the nearest measured cell.
4. **Segment evidence.** A source segment (two consecutive published vertices) takes the evidence of
   the cell that contains its midpoint: provenance M or I; measured channel = point count;
   interpolated channel = distance to data. Only the order of these values is used (more points =
   more support; greater distance = less support), as in the third-party toolchain audit (S9).
5. **Simplifiers.** Douglas-Peucker and Visvalingam-Whyatt from the Rust `simplification` package,
   and the four simplifiers of part A, each at a tolerance of one cell (area of one cell squared for
   the Rust Visvalingam-Whyatt).
6. **Scoring.** As in part A.
7. **Sensitivity.** The Rust Douglas-Peucker run is repeated with cells, and tolerance, of half and
   double the size (2.5 m and 10 m).
8. **Reported.** Lines, source and retained vertices, spans, endpoint promotion and provenance loss
   (count and share of spans), the same for EC-wrap's records, and unmatched lines, for every
   simplifier and cell size. The attribute columns of the published contour file are listed as found.

What this test can and cannot show: the geometry and the points come from other authors, so it tests
whether endpoint records fail on contours the author did not make. The evidence rule (items 2-4) is
ours, because the published contours carry none. It is not a measurement of how often published
products misreport evidence.
