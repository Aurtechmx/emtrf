# Rules for three additional tests

Written on 9 November 2026, 19:20 CST, before any of the three tests was run and before any of
their outputs existed. Every outcome is reported, whichever way it falls. A tool that is not
installed is listed as not run. No rule below is changed after a result is seen; if a rule turns
out to be unworkable, the change is recorded here as a dated amendment with the reason.

## D1. Default attribute handling when line segments are dissolved (`ablation/dissolve_tools.py`)

Question: when per-segment evidence is stored as attributes and a standard GIS tool joins the
segments of a line into one feature, which record does the tool write, and does it report more
support or less provenance than the segments it joined? No attribution code of this study is in
the loop: the tool writes the record.

Input: the production contour runs of the four crops (`results/feature_runs.json`). Each source
edge is written as one two-vertex line feature with the fields `line_id` (index of its run),
`seq` (position along the run), `prov` (`M`, `I` or `X`), `m_sup` and `i_sup` (support on the
0-100 scale, null where the channel does not apply). Features are written in source order.

Tools and calls, each with its default attribute behaviour:

| Label | Call |
|---|---|
| QGIS dissolve | `native:dissolve`, `FIELD=line_id`, all other arguments default |
| GeoPandas dissolve | `GeoDataFrame.dissolve(by="line_id")` (default `aggfunc`) |
| mapshaper dissolve | `-dissolve line_id copy-fields=prov,m_sup,i_sup` |
| GDAL/OGR SQL | `ogr2ogr -dialect SQLite -sql "SELECT ST_Union(geometry), line_id, prov, m_sup, i_sup FROM <layer> GROUP BY line_id"` |

Secondary (a common user choice, reported separately): the mean of the support fields, with
GeoPandas (`aggfunc="mean"` on `m_sup`, `i_sup`) and OGR SQL (`AVG`).

Scoring, per dissolved line with at least two source edges:
- reference record: per channel, the minimum over the line's edges that carry the channel;
  provenance, the union over its edges (`X` counts as `M` and `I`);
- support promotion: the tool's value exceeds the reference minimum by more than 1e-9 in either
  channel (a null tool value is not a promotion);
- provenance loss: a provenance type of the union is absent from the tool's `prov` value
  (scored only for the default calls, which carry `prov`).
Lines with one edge are counted and reported, not scored. If a tool drops the fields, that is
reported as "record dropped" and the tool is not scored. Sensitivity: the same calls with the
features written in reverse order.

Reported per site and tool: lines scored, promotions (count, %), provenance losses (count, %).

Note added on 9 November 2026 after the run; the rules above are unchanged. "Default attribute
behaviour" is accurate for QGIS and GeoPandas only. mapshaper drops other fields when it dissolves
unless `copy-fields` names them, and SQLite does not guarantee which row supplies a bare column of a
grouped query. The four calls were run exactly as written in the table; the reports describe them as
four dissolve workflows.

## D2. Held-out ground check on the scale-test crops (`scale/heldout_scale.cjs`)

Question: the held-out check on the four crops (Supplementary Methods S15) could not answer
whether the segments an endpoint record hides have larger terrain error, for lack of promoted
spans. The same question is put to the scale-test crops.

Crops: every crop with status `scored` in `results/scale_test_r1.json`. Definitions of split,
build, cell error, edge error, hidden edges, end edges and the three questions are those in the
header of `ablation/heldout_check.cjs`, unchanged. Grid: the crop's 100 x 100 cells of 1 m.
Seeds 1 to 5.

Primary statistic (question 2). For each promoted DP span with held-out data on at least one
hidden edge and at least one end edge, d = mean hidden-edge error - mean end-edge error. Spans
are pooled over crops within a seed. S = share of spans with d > 0. Uncertainty: 2,000 bootstrap
replicates resampling whole crops (xorshift32, seed 20261109), 2.5 and 97.5 percentiles. Reported:
the median over seeds of S and of each interval bound, the number of spans, the median of d and
the median ratio hidden/end.

Reading, fixed now: if the interval lies wholly above 50 %, hidden segments have larger held-out
error than the end segments the record reads; if it contains 50 %, the data do not show a
difference; if it lies wholly below 50 %, hidden segments have smaller error.

Also reported: question 1 per crop (number of crops in which RMSE rises from measured cells at or
above 66 to 33-66 to below 33, among crops with at least 30 cells in each class; median and
interquartile range of Spearman's rho); question 3 pooled the same way as question 2 (share of
endpoint-solid spans that EC-DP downgrades whose largest edge error exceeds the pooled median of
those it keeps, with the same bootstrap). Sensitivity: the same without the two parent tiles of
the paper's crops.

## D3. Raster resampling (`ablation/resample_gdal.py`)

Question: does the contract's failure also occur for a second representation operator, the
resampling of a terrain raster to coarser cells?

Input: the production DTM grid of each of the four crops. Three aligned GeoTIFFs are written:
`m_sup` (measured support 0-100, no-data outside measured cells), `i_sup` (interpolation support
0-100, no-data outside interpolated cells), `prov` (1 = measured, 2 = interpolated, no-data 0 =
unsupported).

Operator: GDAL `gdalwarp` to cells 2 and 4 times the source cell, aligned on the grid origin,
with resampling `near`, `average` and `mode` (`mode` for `prov` only; `average` for the support
bands only), and `min` as the contract's reference rule for the support bands.

Scoring, per coarse cell, with its block of source cells as the complete required source set:
- support promotion: the resampled value of a support band exceeds the minimum of that band over
  the block's cells that carry it, by more than 1e-6;
- provenance loss: the resampled `prov` code omits a provenance type present in the block;
- value over unsupported cells: the resampled raster carries a value in a coarse cell whose block
  contains at least one unsupported cell.
Coarse cells whose block has no supported cell are not scored. Reported per site, factor and
resampling: coarse cells scored and the count and share of each failure; and, as a check, that
`min` shows no support promotion.

## D4. Probability sample of USGS 3DEP work units (`prevalence/`)

Added on 9 November 2026, 19:32 CST, after D1-D3 had been run; the text of D1-D3 above is
unchanged. Written before any sample crop was fetched. One crop of one work unit chosen by hand
(MN_SwiftCo_2010) had been fetched earlier to test access; no evidence was computed from it, and
it has no special status in the draw.

Question: in what share of the work units of a national LiDAR programme does endpoint attribution
promote support, and at what rate?

Frame: the 2,283 work units of the public 3DEP point-cloud index,
`boundaries/resources.geojson` of github.com/hobuinc/usgs-lidar at commit `ba8a11d1`, as
downloaded (8,775,238 bytes, SHA-256 `8d11cf33fe0418b69cef4a14e795f53e3a931f998313a5c91b58fdd4a350ee08`).
Data: U.S. Government public domain.

Draw: the units are sorted by name and shuffled once (Fisher-Yates, mulberry32 seeded 20261109).
Units are taken in that order until 60 valid crops are obtained or 200 units have been tried.

Crop: for unit number i of the sorted list, points are drawn uniformly in longitude and latitude
inside the bounding box of its boundary (mulberry32 seeded 20261109 + 1 + i) until one falls
inside the boundary. The crop is the 100 m x 100 m square centred on that point in the UTM zone of
its longitude (WGS 84), origin floored to whole metres. Ground returns (class 2) are read from the
unit's public EPT resource, reprojected to that UTM zone and cut to the square. Up to three points
are tried per unit.

Valid crop: at least 1,000 ground returns, and a determined vertical unit. Vertical unit: the
EPT resources do not state it, so the median elevation of the crop is compared with the elevation
of the USGS Elevation Point Query Service at the crop centre (metres). If the crop median is
nearer to that value as metres than as feet, by at least 5 m, elevations are taken as metres; if
nearer as feet (x 0.3048) by at least 5 m, they are converted to metres; otherwise the unit is
undetermined and the crop is not valid. A unit with no valid crop after three points, or whose
data cannot be read, is recorded with the reason and the next unit in the order is taken.

Scoring: as the scale test (`scale/README.md`): 1 m cells, contours at 1 m, strict feature runs,
one-cell Douglas-Peucker, support promotion of endpoint records and of EC-DP records.

Reported:
- P1: the share of valid crops with at least one promoted span, with a Wilson 95 % interval. A
  crop with no contour span counts as having none.
- P2: among valid crops with at least 20 spans, the per-crop promotion rate: median, quartiles,
  and the mean with a 95 % interval from 2,000 bootstrap replicates over crops (xorshift32, seed
  20261109); the pooled rate as a description.
- EC-DP promotions (expected 0), the number of units tried, and every unit not used with its reason.

Limits fixed now: the sample speaks for work units with classified ground returns and a
determinable vertical unit; one 100 m crop per unit; evidence and scoring are this study's.

## D5. Attribute query on the probability sample (`prevalence/query_sample.cjs`)

Added on 10 November 2026, before any query result on the sample existed. D1-D4 above are
unchanged. Extends the four-site query (Supplementary Methods S10, Table S9) to the 60 valid
crops of D4: one crop per sampled work unit, under this study's evidence model, processing
settings and eligibility rules. It does not represent national contour length.

Query, as in S10: keep a span when its exported measured support is at or above t and its
exported provenance is measured only. t = 66 is primary; t = 33 is reported as a check. The
reference test applies the same query to each source edge's own record. Spans and records are
those of the scale test (`scale/README.md`): strict feature runs, one-cell Douglas-Peucker;
endpoint attribution reads the two end edges, EC-DP all replaced edges.

Per crop, per method, per threshold, using source-edge length:
- correctly accepted (edge passes, span accepted), falsely accepted (edge fails, span accepted),
  wrongly rejected (edge passes, span rejected), correctly rejected (edge fails, span rejected);
- false acceptance and wrong rejection in metres per kilometre of scored contour;
- retention: correctly accepted length / qualifying source length. Undefined when no source
  length qualifies; such crops are counted and reported, not set to 0 or 100.

Coverage and accounting assertions (the run fails if any is violated): every source edge of
every run lies in exactly one DP span (no gap, no overlap, spans in order from the first to the
last vertex); for each method the four lengths sum to the scored length within 1e-6 m; scored
and qualifying lengths are identical for the two methods.

Reported: the median crop value and quartiles of each measure, over the crops where it is
defined; the pooled value from summed lengths; and, for the pooled values and the paired
differences EC-DP minus endpoint, 2,000 bootstrap replicates resampling whole crops
(xorshift32, seed 20261109), recomputing each ratio from the summed lengths, 2.5 and 97.5
percentiles. Crops with no false acceptance are kept.

## D6. Threshold-aligned splitting (`ablation/baselines.cjs`, SPLIT-T; `prevalence/query_split.cjs`)

Added on 10 November 2026, before any SPLIT-T code was run or any SPLIT-T result existed. D1-D5
above are unchanged.

Method SPLIT-T. A vertex is forced wherever two consecutive source edges differ in class. The
class of an edge is its provenance (M, I, X or U) together with, for each support channel, the
band of its value: below 33, 33 to below 66, 66 or above, or no value. Each piece between forced
vertices is simplified with the production Douglas-Peucker rule at one source cell, and each span
carries the record of its first and last source edges (endpoint attribution, as for DP).

Stated beforehand:
1. For the query of D5 at t = 66 and t = 33, SPLIT-T has no false acceptance and no wrong
   rejection, because every edge of a span shares the band and provenance of its end edges. The
   run fails if either is non-zero; this is a check of the implementation, not a finding.
2. Its cost is retained vertices beyond those of DP.
3. Inside a band its records can still exceed the span minimum (support promotion), which a query
   at a threshold other than 33 or 66 can expose. The query is therefore also run at t = 50, a
   threshold not stored in the bands, for DP endpoint records, SPLIT-T and EC-DP.

Reported, on the four crops (as Supplementary Methods S7): retained vertices, their multiple of
DP's, support promotion and provenance loss as shares of spans. On the 60 valid crops of D4, with
the settings of D5: the multiple of DP's retained vertices, per crop (median and quartiles, crops
with at least 20 DP spans) and pooled; the share of spans with support promotion; and, at t = 66,
33 and 50, false acceptance and wrong rejection per kilometre and retention, with the coverage and
accounting assertions of D5 applied to every method. Pooled values carry 2,000 bootstrap
replicates resampling whole crops (xorshift32, seed 20261109). Every outcome is reported.

## D7. Threshold-aligned splitting with complete-source records (`prevalence/query_split.cjs`)

Added on 11 November 2026, before any D7 code was written or run. D1-D6 are unchanged.

Method SPLIT-T+EC: the geometry of SPLIT-T (D6), with each span carrying the complete-source
record of EC-DP (minimum support per channel and provenance union over every replaced edge).

Stated beforehand: no false acceptance at any threshold, because the record is the span minimum;
no false acceptance and no wrong rejection at t = 66 and 33, because every edge of a span lies in
one band. The run fails if either is violated; these check the implementation. Its vertices equal
SPLIT-T's. Reported with the D6 measures, on the same 60 crops and thresholds 66, 33 and 50; the
informative outcome is retention at t = 50 against EC-DP and SPLIT-T.

## D8. Sensitivity of the sample promotion rate to cell size and tolerance (`prevalence/sensitivity_sample.cjs`)

Added on 11 November 2026, before any D8 code was written or run. D1-D7 are unchanged.

On the 60 valid crops of D4, the D4 measures (crops with at least one promoted span; per-crop
promotion rate of DP endpoint records over crops with at least 20 spans: median and quartiles;
EC-DP promotions) are computed under three settings:
- C0, as D4: 1 m cells, contour interval 1 m, Douglas-Peucker tolerance of one cell.
- C1: the cell is the smallest whole metre at or above the crop's nominal point spacing,
  sqrt(10,000 m^2 / ground returns), and at least 1 m; the grid covers the same 100 m square
  (floor(100 / cell) cells per side); contour interval and tolerance equal one cell.
- C2: 1 m cells and contour interval, tolerance of two cells.
Reported: each measure under each setting, the number of crops whose cell changes under C1, and
every crop's rate under each setting. No direction is predicted.

The half-saturation constant h of Eq. 5 is not varied: promotion compares support values by order
only, and Eq. 5 is strictly increasing in return count for every h > 0, so promotion counts do not
depend on h (Methods S9). h does affect the threshold query, which D8 does not cover.
