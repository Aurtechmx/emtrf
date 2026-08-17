"use strict";
/**
 * rasterizeDtm.ts
 *
 * Pure-data leaf. Turns classified ground returns into a raw
 * Digital Terrain Model raster: one elevation per grid cell, plus the
 * source-point count behind each cell. Empty cells stay `NaN` — this
 * module does NOT invent data. Inpainting and confidence are the job of
 * `cellConfidence.ts` (A3), which is where the honesty about
 * interpolated cells gets encoded.
 *
 * WHY a separate step from `groundFilter`. The SMRF filter produces a
 * provisional *opened* surface as a side effect of removing buildings;
 * that surface is an intermediate, not a deliverable DTM (it is biased
 * low by the morphological opening). The DTM the contours actually run
 * on is aggregated from the points the filter classified as ground —
 * keeping the two concerns separate means each is independently
 * testable and the contour surface is honest about its real samples.
 *
 * The raster aligns to a caller-supplied grid when one is given (so it
 * shares cell indices with the `groundFilter` result and the confidence
 * layer); otherwise it derives a grid from the ground points' extent.
 *
 * Pure data: no DOM, no three.js, no I/O. Deterministic.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.rasterizeDtm = rasterizeDtm;
const quantile_1 = require("../quantile");
const gridBudget_1 = require("../quality/gridBudget");
function axes(p, v) {
    return v === 'y' ? [p.x, p.z, p.y] : [p.x, p.y, p.z];
}
/**
 * Rasterise the ground-classified subset of `points` into a DTM.
 *
 * `isGround` is the parallel mask from {@link classifyGroundSmrf}; only
 * returns with `isGround[i] === 1` contribute. Pass an all-ones mask to
 * rasterise every point.
 */
function rasterizeDtm(points, isGround, params = {}) {
    const warnings = [];
    const vertical = params.verticalAxis ?? 'z';
    const aggregation = params.aggregation ?? 'mean';
    // mean/min aggregate with O(1) state per cell (running sum / running min);
    // median/percentile/robust need every value in the cell, so they buffer a
    // small per-cell list and reduce it once at the end.
    const needsLists = aggregation === 'median' || aggregation === 'percentile' || aggregation === 'robust';
    const percentile = aggregation === 'percentile' ? clampUnit(params.percentile ?? 0.5) : 0.5;
    // Collect the ground returns (finite only).
    const gx = [];
    const gy = [];
    const gz = [];
    let groundOffered = 0;
    for (let i = 0; i < points.length; i++) {
        if (isGround[i] !== 1)
            continue;
        groundOffered++;
        const [h1, h2, v] = axes(points[i], vertical);
        if (!Number.isFinite(h1) || !Number.isFinite(h2) || !Number.isFinite(v))
            continue;
        gx.push(h1);
        gy.push(h2);
        gz.push(v);
    }
    const analyzed = gx.length;
    // Resolve the grid.
    let grid = params.grid;
    if (!grid) {
        if (analyzed === 0) {
            warnings.push('no ground returns — empty DTM');
            return emptyRaster(params.cellSizeM ?? 1, warnings);
        }
        const cellSizeM = finitePositive(params.cellSizeM ?? 1, 1, 'cellSizeM', warnings);
        let minH1 = Infinity;
        let minH2 = Infinity;
        let maxH1 = -Infinity;
        let maxH2 = -Infinity;
        for (let i = 0; i < analyzed; i++) {
            if (gx[i] < minH1)
                minH1 = gx[i];
            if (gy[i] < minH2)
                minH2 = gy[i];
            if (gx[i] > maxH1)
                maxH1 = gx[i];
            if (gy[i] > maxH2)
                maxH2 = gy[i];
        }
        grid = {
            originH1: minH1,
            originH2: minH2,
            cols: Math.max(1, Math.floor((maxH1 - minH1) / cellSizeM) + 1),
            rows: Math.max(1, Math.floor((maxH2 - minH2) / cellSizeM) + 1),
            cellSizeM,
        };
    }
    const { originH1, originH2, cols, rows, cellSizeM } = grid;
    // Central allocation guard: a manual/mosaic grid can ask for a tiny cell over
    // a huge extent (the 3.7-billion-cell case), which would exhaust memory before
    // a single cell is written. Refuse a blocked grid fail-closed rather than
    // attempt the allocation. `coarsen` is allowed through with a warning — the
    // grid is large but representable, and rasterizeDtm cannot re-pick the cell.
    const budget = (0, gridBudget_1.checkGridBudget)({ cols, rows });
    if (budget.verdict === 'blocked') {
        warnings.push(`DTM grid refused — ${budget.reason}`);
        return emptyRaster(cellSizeM, warnings);
    }
    if (budget.verdict === 'coarsen')
        warnings.push(budget.reason);
    const nCells = cols * rows;
    const z = new Float32Array(nCells).fill(Number.NaN);
    const counts = new Uint32Array(nCells);
    const accum = new Float64Array(nCells); // sum for mean
    // Per-cell value lists, only allocated for list-needing modes. Sparse: a cell
    // gets its small array only when it first receives a return, so memory tracks
    // the number of *filled* cells, not the full grid.
    const lists = needsLists
        ? new Array(nCells)
        : null;
    // Points materially outside the grid extent are REJECTED, not edge-clamped:
    // clamping pulls a point that is physically off the raster onto its border,
    // contaminating boundary cells on crops, tiles, mosaics and checkpoint-local
    // rasters. A point within a numerical epsilon of an edge (e.g. exactly on the
    // far corner) is a legitimate boundary point and is binned into the edge cell.
    const EPS_CELLS = 1e-6;
    let outsideGridPointCount = 0;
    for (let i = 0; i < analyzed; i++) {
        const fx = (gx[i] - originH1) / cellSizeM;
        const fy = (gy[i] - originH2) / cellSizeM;
        if (fx < -EPS_CELLS || fx > cols + EPS_CELLS || fy < -EPS_CELLS || fy > rows + EPS_CELLS) {
            outsideGridPointCount++;
            continue;
        }
        let col = Math.floor(fx);
        if (col < 0)
            col = 0;
        else if (col >= cols)
            col = cols - 1; // ε-boundary point → last cell
        let row = Math.floor(fy);
        if (row < 0)
            row = 0;
        else if (row >= rows)
            row = rows - 1;
        const c = row * cols + col;
        if (lists) {
            let list = lists[c];
            if (list === undefined) {
                list = [];
                lists[c] = list;
            }
            list.push(gz[i]);
        }
        else if (counts[c] === 0) {
            z[c] = gz[i];
            accum[c] = gz[i];
        }
        else if (aggregation === 'min') {
            if (gz[i] < z[c])
                z[c] = gz[i];
        }
        else {
            accum[c] += gz[i];
        }
        counts[c]++;
    }
    if (aggregation === 'mean') {
        for (let c = 0; c < nCells; c++) {
            if (counts[c] > 0)
                z[c] = accum[c] / counts[c];
        }
    }
    else if (lists) {
        // Reduce each filled cell's small list once. Sorting is per-cell (small),
        // never a global O(N log N) sort over all returns.
        for (let c = 0; c < nCells; c++) {
            const list = lists[c];
            if (list === undefined || list.length === 0)
                continue;
            list.sort((a, b) => a - b);
            if (aggregation === 'median')
                z[c] = (0, quantile_1.quantileSorted)(list, 0.5);
            else if (aggregation === 'percentile')
                z[c] = (0, quantile_1.quantileSorted)(list, percentile);
            else
                z[c] = robustEstimateSorted(list);
        }
    }
    let filledCellCount = 0;
    for (let c = 0; c < nCells; c++)
        if (counts[c] > 0)
            filledCellCount++;
    if (analyzed < groundOffered) {
        warnings.push(`${groundOffered - analyzed} non-finite ground returns skipped`);
    }
    if (filledCellCount < nCells) {
        warnings.push(`${nCells - filledCellCount} of ${nCells} cells have no ground data (will need interpolation)`);
    }
    return {
        z,
        counts,
        cols,
        rows,
        cellSizeM,
        originH1,
        originH2,
        coverage: 'full',
        sourcePointCount: groundOffered,
        analyzedPointCount: analyzed,
        filledCellCount,
        outsideGridPointCount,
        warnings,
    };
}
function emptyRaster(cellSizeM, warnings) {
    return {
        z: new Float32Array(0),
        counts: new Uint32Array(0),
        cols: 0,
        rows: 0,
        cellSizeM,
        originH1: 0,
        originH2: 0,
        coverage: 'full',
        sourcePointCount: 0,
        analyzedPointCount: 0,
        filledCellCount: 0,
        outsideGridPointCount: 0,
        warnings,
    };
}
function finitePositive(v, fallback, name, warnings) {
    if (Number.isFinite(v) && v > 0)
        return v;
    warnings.push(`${name} invalid (${v}); using ${fallback}`);
    return fallback;
}
/** Clamp a fraction to [0, 1]; non-finite collapses to 0.5 (median). */
function clampUnit(p) {
    if (!Number.isFinite(p))
        return 0.5;
    if (p < 0)
        return 0;
    if (p > 1)
        return 1;
    return p;
}
// Quantiles use the project-wide type-7 helper (`../quantile`) — the local
// copy this file used to carry was one of the three conventions the v0.4.3
// audit flagged; it is now the single shared definition.
/**
 * Robust cell estimator over an ASCENDING-sorted, non-empty list.
 *
 * Definition: a MAD-clipped trimmed mean centred on the median.
 *   1. m   = median(values)
 *   2. MAD = median(|value − m|)              (median absolute deviation)
 *   3. σ̂  = 1.4826 · MAD                       (MAD → Gaussian-σ estimate)
 *   4. Keep values within m ± 3·σ̂; the result is the MEAN of the kept set.
 *
 * Rationale: the median (breakdown 50 %) sets a resistant centre, MAD gives a
 * resistant scale, and the 3σ̂ gate (the standard outlier-rejection threshold)
 * discards gross blunders — high (vegetation) or low (multipath) — before
 * averaging the inliers, so the estimate is both outlier-resistant and smoother
 * than a bare median when the cell's inliers are clustered.
 *
 * Degenerate cases: with MAD = 0 (e.g. a tie-heavy cell like [10,10,10,50])
 * the inlier band collapses to exactly the median value, so only returns equal
 * to the median survive and the result is the median itself — the outlier is
 * rejected. n = 1 returns that single value.
 */
function robustEstimateSorted(sorted) {
    const n = sorted.length;
    if (n === 1)
        return sorted[0];
    const m = (0, quantile_1.quantileSorted)(sorted, 0.5);
    // MAD: median of absolute deviations from m.
    const dev = new Array(n);
    for (let i = 0; i < n; i++)
        dev[i] = Math.abs(sorted[i] - m);
    dev.sort((a, b) => a - b);
    const mad = (0, quantile_1.quantileSorted)(dev, 0.5);
    const sigma = 1.4826 * mad;
    // MAD = 0 → no spread among the bulk; keep only values at the median so a
    // tie-heavy cell rejects its outliers and returns the median exactly.
    const band = sigma; // gate is m ± 3σ̂ below; band==0 keeps only |dev| <= 0.
    let sum = 0;
    let kept = 0;
    for (let i = 0; i < n; i++) {
        if (Math.abs(sorted[i] - m) <= 3 * band) {
            sum += sorted[i];
            kept++;
        }
    }
    // Safety: if the gate somehow rejects everything (shouldn't, the median is
    // always within the band), fall back to the median.
    return kept > 0 ? sum / kept : m;
}
