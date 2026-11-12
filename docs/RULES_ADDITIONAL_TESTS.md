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

Note to D8, 11 November 2026, before any D8 run: support is stored as whole points (0-100), so two
return counts can round to the same value under one h and not another. The invariance to h above
therefore holds up to that rounding; D8 does not test it.

Correction to D8, 11 November 2026, after the D8 run: the invariance argument above is incomplete.
Lines are split into feature runs where the display grade changes, and the grade depends on h
through the thresholds 33 and 66, so the spans compared, and hence promotion counts, can change
with h. D8 results are unchanged; they hold for the published h only.

## D9. Threshold split with complete-source records on the four crops (`ablation/baselines.cjs`)

Added on 11 November 2026, before any D9 code was written or run. D1-D8 are unchanged.

On the four frozen crops and the inputs of the alternative-method comparison, one method is
added: SPLIT-T-EC, the SPLIT-T geometry of D6 with complete-source records (minimum support and
provenance union over every replaced edge), as D7 on the sample. Reported with the measures of
the other methods (extra vertices against DP, lines whose geometry differs from DP, support
promotion, provenance loss). The run fails unless SPLIT-T-EC keeps the same vertices as SPLIT-T
and has no support promotion and no provenance loss at any site.

## D10. Support against independent RTK checkpoints at Marsh Island (`external-check/marsh_checkpoints.cjs`)

Added on 11 November 2026, before any D10 code was written or run. D1-D9 are unchanged.

Disclosure: the absolute errors of these checkpoints against a DTM of this crop were computed
earlier in separate OpenLiDARViewer validation work (summary accuracy only). Their relation to
support has not been computed before these rules were committed.

Data: the 104 RTK check shots (Emlid RS3) of the USGS Marsh Island UAS release (Over et al., 2024;
NAD83(2011) UTM 19N, NAVD88), in the crop's local frame (origin 340303, 4612812), independent of the
aerial control. The DTM is the one every Marsh Island result uses (frozen snapshot, 0.5 m cells,
point-in-cell mean, buildDtmGrid).

Matching: each checkpoint takes the cell that contains it (no interpolation). Its support is the
cell's support on the 0-100 scale in the cell's channel (measured cells: measured support;
interpolated cells: interpolation support). A checkpoint in an unsupported cell or outside the grid
is not scored and is counted. Error = |DTM height of the cell - checkpoint height|.

Primary measure: Spearman rank correlation between support and error over all scored checkpoints,
with a 95% interval from 2,000 bootstrap replicates over checkpoints (xorshift32, seed 20261111).
Secondary: median error and count per support band (below 33, 33 to below 66, 66 or above) and per
channel; the primary measure without errors above 1 m (the physical bare-earth threshold of the
earlier validation, fixed independently of these results), reported alongside, not instead.
Every checkpoint's support, channel and error are written out. No result is excluded.
No direction is required for the run to pass; a negative correlation would mean higher support,
smaller error. The outcome is reported whatever it is.

## D11. Composition checked on random operator chains (`oracles/composition_property.py`)

Added on 11 November 2026, before any D11 code was written or run. A property test, not an
empirical study. In the independent Python model: 10,000 random cases (fixed seed), each a list of
source records (per channel: a support value, unavailable, or not applicable; provenance; at least
one supported source) split at random into consecutive groups. Applying the meet to each group and
then to the group results must equal applying it once to all sources: same value or unavailable
state per channel, same provenance and lineage. The run fails on any mismatch.

## D12. Support against independent checkpoints in forest terrain, Coconino (`external-check/coconino_checkpoints.cjs`)

Added on 11 November 2026, after D10 was run and before any D12 code was written or run. D12 was
designed because D10 had too little range in support to test the relation (96 of 104 checkpoints in
cells of support 94 or above). D1-D11 are unchanged.

Disclosure: the errors of these checkpoints against a 1 m DTM were computed earlier in separate
OpenLiDARViewer validation work, and it is known from that work that one vegetated checkpoint has an
error of about 0.7 m in a cell holding a single return, and that two vegetated checkpoints have no
ground return in their cell. The relation between support and error has not been computed.

Data: USGS AZ Coconino B1 2019 (3DEP project 19049, public domain): the 60 accuracy checkpoints
(38 non-vegetated NVA, 22 vegetated VVA; independent of the LiDAR control points) that fall inside
the 57 tiles of the earlier work, and the class-2 ground returns within 3 m of each (16,614 returns),
both in a local Conus Albers frame, NAVD88 (Geoid12B) for LiDAR and checkpoints alike.

Processing: for each checkpoint, the 5 x 5 block of whole 1 m cells centred on the cell that contains
it (aligned to whole metres of the local frame; the block lies inside the 6 m patch), built with the
frozen snapshot (point-in-cell mean, buildDtmGrid) as for the 1 m sites. The target return count of
the support function is one value for the whole site: the median return count over the measured
cells of all 60 blocks, fixed from counts alone. Support, channel and error as in D10. A checkpoint
whose cell is unsupported is counted, not scored.

Primary measure: Spearman rank correlation between support and error over the scored checkpoints,
95% interval from 2,000 bootstrap replicates over checkpoints (xorshift32, seed 20261111).
Secondary: the same within measured cells only; median error and count per support band and per
channel; median support and median error for NVA and for VVA checkpoints. Every checkpoint's
values are written out; nothing is excluded. No direction is required for the run to pass, and the
outcome is reported whatever it is. Limits fixed here: 6 m patches (support of interpolated cells
uses only returns within the block), one project, errors known beforehand.

## D13. Composition checked on the JavaScript implementation (`js-study/composition_property.cjs`)

Added on 11 November 2026, before any D13 code was written or run. A property test, as D11, but on
the JavaScript `typedMeet` that EC-DP and EC-wrap use, not on the Python model. 10,000 random cases
(fixed seed): 2-9 source records, each channel a value, applicable but missing, or not applicable,
with or without a declared scope, with provenance and lineage; the records are split at random into
consecutive groups. The meet of the group results must equal the meet of all sources: the same
support per channel, the same unavailable channels, scopes, provenance and lineage. The run fails
on any mismatch. A control with a deliberately broken composition must fail.

## D14. Evidence layers published by a DEM producer: Copernicus DEM GLO-90 (`external-check/copdem_masks.cjs`)

Added on 11 November 2026, before any Copernicus DEM tile was downloaded. Only the product handbook,
the licence and the bucket listing had been read. D1-D13 are unchanged.

Purpose: in every earlier test the support values come from this study's own functions. Here both
provenance and support come from the producer. Copernicus DEM (ESA/Airbus) ships, per pixel, an
editing mask (EDM) and a height error mask (HEM, the standard deviation of the height error).

Data: the GLO-90 tiles (public AWS bucket `copernicus-dem-90m`) that contain the five field sites of
this paper (White Sands, StREAM, Estonia Tava, Marsh Island, Coconino), fixed by the sites'
coordinates alone. From each tile, the window of 300 x 300 pixels centred on the site's pixel,
shifted where needed to stay inside the tile. No other tile or window is tried.

Evidence, by the producer's masks only: a pixel is measured when EDM = 1 (not edited) and HEM is a
valid value; void when EDM = 0; otherwise edited (infilled, interpolated, smoothed, flattened or
water), which carries no height error estimate. Support in the measured channel is compared by
order only: a smaller HEM is stronger.

Processing: the window is treated as a grid in pixel units. Contours at a 10 m interval with the
frozen snapshot extractor; whole stitched lines (no splitting at grades); Douglas-Peucker at a
one-pixel tolerance. Each segment takes the evidence of its 2 x 2 pixel block, as in the paper.

Measures per site and pooled: spans; spans where the endpoint record reports a smaller height error
than the largest among the measured pixels of the segments it replaces (support promotion); spans
where the endpoint record omits a provenance type present in the replaced segments (for instance a
span that crosses edited pixels and is recorded as measured only); the same two counts for
complete-source records, which must be zero for the run to pass. A site with fewer than 20 spans is
reported and not rated. No direction or size is required of the endpoint counts; they are reported
whatever they are.

## D15. Amendment to D10 and D12: the measured-channel correlation is the principal measure

Added on 11 November 2026, after D10 and D12 were run, and before the Marsh Island measured-only
correlation was computed. D1-D14 are unchanged and their results stay reported.

Reason: D10 and D12 named the Spearman correlation over all scored checkpoints as primary. Support in
measured cells and in interpolated cells are different channels, and the contract (Section 2.2) never
ranks one against the other; a pooled rank correlation does. The principal measure reported in the
paper is therefore the Spearman correlation over checkpoints in measured cells only, with the same
95% interval (2,000 bootstrap replicates over checkpoints, xorshift32, seed 20261111). Checkpoints in
interpolated cells are reported separately and descriptively (count, support, error).

Status of each value: Coconino measured-only was already specified as secondary in D12 (computed
before this amendment: -0.353, 95% interval -0.568 to -0.102). Marsh Island measured-only was not
specified in D10; it is computed by the same procedure after this amendment, and its status as a
post hoc choice of principal measure is stated in the paper. The pooled correlations of D10 (-0.024)
and D12 (-0.343) remain reported as originally specified. No direction is required of the result.
