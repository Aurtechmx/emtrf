"use strict";
/**
 * cellConfidence.ts
 *
 * Pure-data leaf — and the load-bearing one for the honesty
 * contract. Takes a raw `DemRaster` (which leaves empty cells as `NaN`)
 * and produces a complete `DtmGrid`: every cell has an elevation AND a
 * 0..100 confidence describing how much that elevation can be trusted.
 *
 * WHY this matters. The key reliability principle
 * was that a confidence band you never derive from real evidence is
 * unfalsifiable — i.e. dishonest. Here confidence is computed once, per
 * cell, from observable quantities, and becomes the single source of
 * truth every downstream view reads: contour solid/dashed/gap, the
 * confidence-map overlay, and the per-contour banding in exports. No
 * other module recomputes uncertainty.
 *
 * Confidence model (documented so it can be argued with, not hidden):
 *   - MEASURED cell (>=1 ground return): confidence rises with sample
 *     density relative to the scene's typical density (median count).
 *     A cell sampled at or above the median is fully trusted on the
 *     density axis; a thinly-sampled cell is proportionally less so.
 *   - INTERPOLATED cell (no ground return, value filled from nearest
 *     data): confidence falls with distance-to-data (each cell of
 *     interpolation distance costs trust) AND with local surface
 *     roughness (interpolating across rough ground is a bigger guess
 *     than across flat ground).
 *   - A cell with no reachable data at all stays `value: null`
 *     equivalent — confidence 0, coverage `none` — so the UI renders a
 *     true "—"/gap rather than a fabricated height.
 *
 * The thresholds are constants here, not magic numbers buried in a
 * renderer: `solid`/`dashed`/`gap` cutoffs live with the data so the
 * grammar is consistent everywhere.
 *
 * Pure data: no DOM, no three.js, no I/O. Deterministic.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.EVIDENCE_THRESHOLDS = void 0;
exports.gradeForConfidence = gradeForConfidence;
exports.buildDtmGrid = buildDtmGrid;
exports.isHonestDtm = isHonestDtm;
exports.distanceToData = distanceToData;
exports.directionalSupport = directionalSupport;
const groundFilter_1 = require("./groundFilter");
const idwFill_1 = require("./idwFill");
const geodesicFill_1 = require("./geodesicFill");
const terrainDerivatives_1 = require("./terrainDerivatives");
const horizontalScale_1 = require("./horizontalScale");
/** Confidence cutoffs for the evidence grades (single source of truth). */
exports.EVIDENCE_THRESHOLDS = {
    /** >= solid → drawn as a confident, continuous line. */
    solid: 66,
    /** >= dashed (and < solid) → drawn dashed: "interpolated, uncertain". */
    dashed: 33,
    // < dashed → `gap`: not drawn / drawn as an explicit break.
};
/** Map a 0..100 confidence to its evidence grade. */
function gradeForConfidence(confidence) {
    if (!Number.isFinite(confidence) || confidence < exports.EVIDENCE_THRESHOLDS.dashed)
        return 'gap';
    if (confidence < exports.EVIDENCE_THRESHOLDS.solid)
        return 'dashed';
    return 'solid';
}
/**
 * Build a confidence-aware DTM from a raw raster. Deterministic.
 */
function buildDtmGrid(raster, params = {}) {
    const warnings = [...raster.warnings];
    const { cols, rows, cellSizeM, originH1, originH2 } = raster;
    const nCells = cols * rows;
    if (nCells === 0) {
        return {
            z: new Float32Array(0),
            confidence: new Float32Array(0),
            coverage: new Uint8Array(0),
            counts: new Uint32Array(0),
            interpDistanceCells: new Float32Array(0),
            cols,
            rows,
            cellSizeM,
            originH1,
            originH2,
            crs: params.crs ?? null,
            horizontalEpsg: params.horizontalEpsg ?? null,
            verticalDatum: params.verticalDatum ?? null,
            verticalEpsg: params.verticalEpsg ?? null,
            verticalUnitToMetres: params.verticalUnitToMetres ?? null,
            coverageMode: 'full',
            sourcePointCount: raster.sourcePointCount,
            analyzedPointCount: raster.analyzedPointCount,
            meanConfidence: Number.NaN,
            warnings,
        };
    }
    // had-data mask from counts.
    const hadData = new Uint8Array(nCells);
    for (let i = 0; i < nCells; i++)
        hadData[i] = raster.counts[i] > 0 ? 1 : 0;
    // Fill heights. IDW (inverse-distance over the k nearest measured
    // cells) gives a smooth, locally-supported interpolant; nearest-finite
    // is the fallback for reachable cells that fall outside the IDW search
    // radius, so every reachable cell still gets a finite height and the
    // coverage semantics below are unchanged. Measured cells keep their
    // own value verbatim. (v0.4.0 — was nearest-neighbour everywhere.)
    // Per-axis cell size in METRES — one derivation shared by the geodesic step
    // cost below and the Horn slope further down, so the two stages can never
    // disagree about how long a cell is. For a geographic frame the cell is in
    // degrees, so convert per axis — longitude shrinks by cos(latitude) — or the
    // E–W run is overstated off-equator and every cell reads as near-vertical.
    const cellM = (0, horizontalScale_1.horizontalCellMetresXY)(cellSizeM, params.isGeographic, 
    // Prefer the caller's WORLD latitude: the raster origin is render-
    // recentred for viewer-fed grids (≈ 0 → cos φ silently 1). The origin
    // fallback stays correct for grids built in absolute coordinates.
    //
    // Sign checked: rasterizeDtm sets originH2 = minH2 (the SOUTH edge) and
    // bins with row = floor((y − originH2)/cell), so rows run NORTHWARD and
    // origin + half the rows is the grid centre, not its mirror. This now
    // steers interpolated heights as well as slope, so it is worth pinning.
    params.latitudeDeg ?? originH2 + (rows / 2) * cellSizeM, params.horizontalUnitToMetres);
    const nearest = (0, groundFilter_1.inpaintNearest)(raster.z, hadData, cols, rows);
    const idw = params.interpolation === 'geodesic'
        ? (0, geodesicFill_1.geodesicFill)(raster.z, hadData, cols, rows, {
            // The geodesic cost adds a horizontal step to a vertical rise, so
            // both must be metres. Passing the raw cell size collapsed the cost
            // to vertical-only on a degree grid (~1e-5 beside metre heights).
            cellMetresX: cellM.x,
            cellMetresY: cellM.y,
            verticalUnitToMetres: params.verticalUnitToMetres,
        })
        : (0, idwFill_1.idwFill)(raster.z, hadData, cols, rows, {});
    // Distance-to-data in cells (multi-source BFS, 8-connectivity).
    const interpDistanceCells = distanceToData(hadData, cols, rows);
    // Fill contract (v0.6.5 hardening): a void the interpolator can defend gets
    // its IDW value (INTERPOLATED); a void beyond IDW's support radius is
    // UNSUPPORTED and stays NaN — nearest-fill would otherwise invent a height
    // from arbitrarily far away, making the interpolation radius meaningless. A
    // caller that genuinely wants nearest-fill must opt in with an explicit
    // bounded distance (`nearestFallbackMaxCells`); beyond that bound it is still
    // NaN, and such cells carry lower confidence downstream.
    const nearestBound = params.nearestFallbackMaxCells;
    const z = new Float32Array(nCells);
    for (let i = 0; i < nCells; i++) {
        if (hadData[i] === 1) {
            z[i] = raster.z[i];
            continue;
        }
        if (Number.isFinite(idw[i])) {
            z[i] = idw[i];
            continue;
        }
        z[i] = nearestBound != null && interpDistanceCells[i] <= nearestBound ? nearest[i] : Number.NaN;
    }
    // Target density: explicit, else median of measured counts.
    const target = params.targetCount ?? medianMeasuredCount(raster.counts);
    const safeTarget = target > 0 ? target : 1;
    const roughFull = params.roughnessFullPenaltySlope ?? 1.0;
    const absoluteHalfCount = Math.max(0, params.absoluteHalfCount ?? 3);
    const maxInterpDist = params.maxInterpDistanceCells;
    const maxInterpSlope = params.maxInterpSlope;
    const guard = params.extrapolationGuard != null;
    const guardRadius = Math.max(1, Math.round(params.extrapolationGuard?.radiusCells ?? 8));
    const guardPenalty = clamp01(params.extrapolationGuard?.penalty ?? 0.5);
    const guardDrop = params.extrapolationGuard?.dropSingleDirection ?? false;
    // Horn 3x3 slope — isotropic, the same estimator GDAL/ArcGIS use —
    // drives the interpolation roughness penalty. (v0.4.0 — was a crude
    // max-neighbour difference.) Reuses the `cellM` derived above the fill.
    const slope = (0, terrainDerivatives_1.hornSlope)(z, cols, rows, cellM.x, cellM.y, params.verticalUnitToMetres ?? 1);
    const confidence = new Float32Array(nCells);
    const coverage = new Uint8Array(nCells);
    let confSum = 0;
    let confCells = 0;
    const anyData = raster.filledCellCount > 0;
    for (let i = 0; i < nCells; i++) {
        if (!anyData) {
            coverage[i] = 0;
            confidence[i] = 0;
            continue;
        }
        if (raster.counts[i] > 0) {
            // measured. Density confidence combines RELATIVE adequacy (count vs
            // the scene's typical density) with ABSOLUTE adequacy (count vs a
            // half-saturation floor), so a single-return cell is never fully
            // trusted just because the whole scene is sparse. absoluteHalfCount
            // = 0 disables the floor (pre-0.4 relative-only behaviour).
            coverage[i] = 2;
            const count = raster.counts[i];
            const relative = clamp01(count / safeTarget);
            const absolute = absoluteHalfCount > 0 ? count / (count + absoluteHalfCount) : 1;
            confidence[i] = Math.round(100 * relative * absolute);
        }
        else if (Number.isFinite(z[i]) && Number.isFinite(interpDistanceCells[i])) {
            // interpolated from reachable data — unless DTM hardening withholds it.
            // Requires a finite filled value: a BFS-reachable cell the IDW interpolator
            // could not defend (z left NaN, no nearest policy) is UNSUPPORTED, not
            // interpolated, so coverage never disagrees with the height it describes.
            const tooFar = maxInterpDist != null && interpDistanceCells[i] > maxInterpDist;
            const tooSteep = maxInterpSlope != null && slope[i] > maxInterpSlope;
            if (tooFar || tooSteep) {
                // Far-reach or steep interpolation is the least trustworthy surface —
                // leave it a genuine gap rather than invent it.
                coverage[i] = 0;
                confidence[i] = 0;
            }
            else {
                const interpScore = 1 / (1 + interpDistanceCells[i]);
                const roughPenalty = clamp01(slope[i] / (roughFull > 0 ? roughFull : 1)) * 0.8;
                let base = interpScore * (1 - roughPenalty);
                // Extrapolation guard: a fill supported only on one side is a
                // directional guess, not a bracketed interpolation. Demote it (or
                // drop it to a gap when configured) so one-sided surface can't read
                // as confident.
                if (guard) {
                    const sup = directionalSupport(hadData, cols, rows, i % cols, (i - (i % cols)) / cols, guardRadius);
                    if (guardDrop && sup.directions <= 1) {
                        coverage[i] = 0;
                        confidence[i] = 0;
                        continue;
                    }
                    if (sup.directions > 0 && sup.oneSided)
                        base *= guardPenalty;
                }
                coverage[i] = 1;
                confidence[i] = Math.round(100 * base);
            }
        }
        else {
            // unreachable — genuine gap
            coverage[i] = 0;
            confidence[i] = 0;
        }
        if (coverage[i] > 0) {
            confSum += confidence[i];
            confCells++;
        }
    }
    if (params.crs == null) {
        warnings.push('CRS unknown — exports must resolve a CRS before they are usable downstream');
    }
    return {
        z,
        confidence,
        coverage,
        counts: raster.counts,
        interpDistanceCells,
        cols,
        rows,
        cellSizeM,
        originH1,
        originH2,
        crs: params.crs ?? null,
        horizontalEpsg: params.horizontalEpsg ?? null,
        verticalDatum: params.verticalDatum ?? null,
        verticalEpsg: params.verticalEpsg ?? null,
        verticalUnitToMetres: params.verticalUnitToMetres ?? null,
        coverageMode: raster.coverage,
        sourcePointCount: raster.sourcePointCount,
        analyzedPointCount: raster.analyzedPointCount,
        meanConfidence: confCells > 0 ? confSum / confCells : Number.NaN,
        warnings,
    };
}
/**
 * Structural honesty guard for a DtmGrid. A DtmGrid
 * is honest when its arrays are length-consistent, confidences are in
 * range, and no `measured`/`interpolated` cell carries a non-finite
 * height (only `coverage: none` cells may lack a height).
 */
function isHonestDtm(g) {
    const n = g.cols * g.rows;
    if (g.z.length !== n ||
        g.confidence.length !== n ||
        g.coverage.length !== n ||
        g.counts.length !== n ||
        g.interpDistanceCells.length !== n) {
        return false;
    }
    for (let i = 0; i < n; i++) {
        const c = g.confidence[i];
        if (!Number.isFinite(c) || c < 0 || c > 100)
            return false;
        if (g.coverage[i] > 0 && !Number.isFinite(g.z[i]))
            return false;
    }
    return true;
}
// ── helpers ─────────────────────────────────────────────────────────
/**
 * Distance (in cells) from each cell to the nearest cell that had data,
 * by multi-source BFS over 8-connectivity. Measured cells are 0.
 * Unreachable cells (no data anywhere connected) are `Infinity`.
 */
function distanceToData(hadData, cols, rows) {
    const n = cols * rows;
    const dist = new Float32Array(n).fill(Infinity);
    let frontier = [];
    for (let i = 0; i < n; i++) {
        if (hadData[i] === 1) {
            dist[i] = 0;
            frontier.push(i);
        }
    }
    let step = 0;
    while (frontier.length > 0) {
        step++;
        const next = [];
        for (const i of frontier) {
            const col = i % cols;
            const row = (i - col) / cols;
            for (let dr = -1; dr <= 1; dr++) {
                for (let dc = -1; dc <= 1; dc++) {
                    if (dr === 0 && dc === 0)
                        continue;
                    const r = row + dr;
                    const c = col + dc;
                    if (r < 0 || r >= rows || c < 0 || c >= cols)
                        continue;
                    const j = r * cols + c;
                    if (dist[j] !== Infinity)
                        continue;
                    dist[j] = step;
                    next.push(j);
                }
            }
        }
        frontier = next;
    }
    return dist;
}
/**
 * Directional data support around an interpolated cell. Marches the eight
 * compass rays out to `radius` cells and records, for each, whether a
 * measured (had-data) cell is encountered. Returns how many of the eight
 * directions found data and whether that data is "one-sided" — i.e. confined
 * to an arc narrower than 180°, the signature of an extrapolation rather than
 * a bracketed interpolation.
 *
 * Exported for testing. Deterministic, pure.
 */
function directionalSupport(hadData, cols, rows, col, row, radius) {
    // Eight rays, in degrees around the circle (order matters for the gap calc).
    const rays = [
        [1, 0, 0], // E
        [1, 1, 45], // SE (screen-space; sign is irrelevant to the arc width)
        [0, 1, 90], // S
        [-1, 1, 135], // SW
        [-1, 0, 180], // W
        [-1, -1, 225], // NW
        [0, -1, 270], // N
        [1, -1, 315], // NE
    ];
    const hitAngles = [];
    for (const [dc, dr, deg] of rays) {
        for (let t = 1; t <= radius; t++) {
            const c = col + dc * t;
            const r = row + dr * t;
            if (c < 0 || c >= cols || r < 0 || r >= rows)
                break;
            if (hadData[r * cols + c] === 1) {
                hitAngles.push(deg);
                break;
            }
        }
    }
    const directions = hitAngles.length;
    if (directions === 0)
        return { directions: 0, oneSided: false };
    if (directions === 1)
        return { directions: 1, oneSided: true };
    // Largest empty arc between consecutive hit directions (wrapping 360°).
    hitAngles.sort((a, b) => a - b);
    let maxGap = 360 - hitAngles.at(-1) + hitAngles[0];
    for (let k = 1; k < hitAngles.length; k++) {
        const gap = hitAngles[k] - hitAngles[k - 1];
        if (gap > maxGap)
            maxGap = gap;
    }
    // Data confined to an arc < 180° ⇒ the cell is not bracketed ⇒ one-sided.
    return { directions, oneSided: maxGap > 180 };
}
/** Median of the positive (measured) counts; 0 when none are measured. */
function medianMeasuredCount(counts) {
    const measured = [];
    for (const c of counts)
        if (c > 0)
            measured.push(c);
    if (measured.length === 0)
        return 0;
    measured.sort((a, b) => a - b);
    const mid = measured.length >> 1;
    return measured.length % 2 === 1 ? measured[mid] : (measured[mid - 1] + measured[mid]) / 2;
}
function clamp01(v) {
    if (!Number.isFinite(v))
        return 0;
    if (v < 0)
        return 0;
    if (v > 1)
        return 1;
    return v;
}
