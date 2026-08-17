"use strict";
/**
 * contoursAt.ts
 *
 * isolines from a confidence-aware DTM, graded by the
 * evidence behind each segment. Implements marching squares directly in
 * TypeScript (zero dependency) rather than wrapping d3-contour.
 *
 * WHY hand-rolled instead of d3-contour (a documented deviation from
 * an alternative to d3-contour):
 *   - Per-segment honesty. d3-contour stitches whole isoband polygons;
 *     here every emitted segment lives inside exactly one grid cell, so
 *     it can be tagged with that cell's confidence directly — no
 *     post-hoc spatial join, no ambiguity about which cell a vertex
 *     "belongs" to. Evidence grading is the whole point of this feature,
 *     and per-cell segments are the natural unit for it.
 *   - Gap-aware breaks. A cell touching a no-data corner emits NO
 *     segment, so contours break honestly across data gaps instead of
 *     being interpolated straight through them.
 *   - Zero new dependency / zero lazy-chunk + build-guard churn, which
 *     matches the dependency-free, Node-testable ethos of the other pure-data
 *     leaves. Marching squares is a deterministic 50-year-old algorithm;
 *     correctness is pinned against analytic surfaces in the tests.
 *
 * The threshold→grade mapping is NOT redefined here: it is imported from
 * `cellConfidence` (`gradeForConfidence`) so the visual grammar has one
 * source of truth everywhere.
 *
 * Pure data: no DOM, no three.js, no I/O. Deterministic.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.contoursAt = contoursAt;
const cellConfidence_1 = require("../ground/cellConfidence");
/**
 * The single spacing an ascending level list has, or `null` when it has none.
 *
 * A list of two or more levels whose consecutive gaps agree (within a relative
 * tolerance, so float-built lists are not rejected for their last bit) has one
 * interval, and reporting it is correct. An irregular list does not: there is
 * no number a reader could apply to predict the next level, and any single
 * value stamped on the artifact would be wrong for most of the gaps. Fewer
 * than two levels has no gap at all.
 */
function uniformSpacing(values) {
    if (values.length < 2)
        return null;
    const first = values[1] - values[0];
    if (!(first > 0))
        return null;
    for (let i = 2; i < values.length; i++) {
        const gap = values[i] - values[i - 1];
        if (Math.abs(gap - first) > first * 1e-6)
            return null;
    }
    return first;
}
/**
 * Marching-squares segment table, indexed by the 4-bit corner mask
 * `b0|b1<<1|b2<<2|b3<<3` where corners are CCW from bottom-left
 * (v0 BL, v1 BR, v2 TR, v3 TL). Each entry lists edge pairs to connect;
 * edges are 0=bottom(v0-v1) 1=right(v1-v2) 2=top(v2-v3) 3=left(v3-v0).
 * Saddle cases 5 and 10 are resolved at runtime with the exact bilinear
 * saddle rule — see {@link saddlePairs}; the table entries for 5/10 hold
 * the saddle-BELOW-level pairing (high corners isolated).
 */
const SEGMENT_TABLE = [
    [], // 0
    [[3, 0]], // 1
    [[0, 1]], // 2
    [[3, 1]], // 3
    [[1, 2]], // 4
    [
        [3, 0],
        [1, 2],
    ], // 5 (saddle, centre below level)
    [[0, 2]], // 6
    [[3, 2]], // 7
    [[2, 3]], // 8
    [[2, 0]], // 9
    [
        [0, 1],
        [2, 3],
    ], // 10 (saddle, centre below level)
    [[2, 1]], // 11
    [[1, 3]], // 12
    [[1, 0]], // 13
    [[0, 3]], // 14
    [], // 15
];
// Saddle pairings for the centre-ABOVE-level topology. Case 5 (v0+v2 high):
// a high centre connects the two high corners diagonally, so each LOW corner
// (v1, v3) is cut off by its own segment — bottom+right around v1, top+left
// around v3. Case 10 (v1+v3 high) is the mirror: the low corners v0, v2 get
// left+bottom and right+top. These are exactly the OTHER case's table rows.
const SADDLE5_CENTRE_HIGH = [
    [0, 1],
    [2, 3],
];
const SADDLE10_CENTRE_HIGH = [
    [3, 0],
    [1, 2],
];
/**
 * Resolve a marching-squares saddle (mask 5 or 10) with the EXACT bilinear
 * decider. Inside the cell the surface is the bilinear interpolant of the
 * four corners; its level sets are hyperbolas whose asymptotes cross at the
 * saddle point, where the surface value is
 *
 *   z* = (v0·v2 − v1·v3) / (v0 + v2 − v1 − v3).
 *
 * The two HIGH corners are connected through the cell exactly when the
 * level does not exceed z* (the {z ≥ level} region contains the saddle
 * point), and isolated when it does. The previous cell-average rule used
 * the corner MEAN as a stand-in for z*; the two agree on symmetric saddles
 * but disagree on asymmetric ones (e.g. one dominant corner), where the
 * mean overstates the saddle height and mislinks the contour topology.
 * Ties (level exactly z*) resolve as "connected", matching the `>=` corner
 * rule. A degenerate denominator cannot arise for a true saddle mask
 * (v0+v2 ≥ 2·level > v1+v3 forces it non-zero) but is guarded anyway —
 * non-finite input falls back to the old cell-average rule.
 */
function saddlePairs(mask, zc, level) {
    const denom = zc[0] + zc[2] - zc[1] - zc[3];
    const zSaddle = Math.abs(denom) > 1e-12
        ? (zc[0] * zc[2] - zc[1] * zc[3]) / denom
        : (zc[0] + zc[1] + zc[2] + zc[3]) / 4; // degenerate → cell-average fallback
    if (zSaddle >= level) {
        return mask === 5 ? SADDLE5_CENTRE_HIGH : SADDLE10_CENTRE_HIGH;
    }
    return SEGMENT_TABLE[mask];
}
/**
 * Compute graded contour segments from a DTM. Deterministic. Cells that
 * touch a no-data corner (coverage 0 or non-finite height) are skipped
 * so contours break across gaps rather than being faked through them.
 */
function contoursAt(dtm, params) {
    const warnings = [];
    const { cols, rows, cellSizeM, originH1, originH2, z, confidence, coverage } = dtm;
    // Elevation range over covered cells.
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < z.length; i++) {
        if (coverage[i] === 0 || !Number.isFinite(z[i]))
            continue;
        if (z[i] < minZ)
            minZ = z[i];
        if (z[i] > maxZ)
            maxZ = z[i];
    }
    if (!Number.isFinite(minZ) || cols < 2 || rows < 2) {
        warnings.push('insufficient covered cells for contours');
        return {
            levels: [],
            // No levels were emitted, so there is no emitted spacing to report.
            intervalM: null,
            requestedIntervalM: params.intervalM,
            crs: dtm.crs,
            verticalDatum: dtm.verticalDatum,
            minZ: Number.NaN,
            maxZ: Number.NaN,
            warnings,
        };
    }
    // Resolve levels.
    const maxLevels = params.maxLevels ?? 200;
    let levelValues;
    // True when the level list came from the caller, so its spacing has to be
    // measured rather than taken from `params.intervalM`.
    let levelsWereGiven = false;
    if (params.levels && params.levels.length > 0) {
        levelValues = [...params.levels].filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
        levelsWereGiven = true;
    }
    else {
        const interval = params.intervalM;
        if (!Number.isFinite(interval) || interval <= 0) {
            warnings.push('intervalM invalid — no contours produced');
            return {
                levels: [],
                intervalM: null,
                requestedIntervalM: interval,
                crs: dtm.crs,
                verticalDatum: dtm.verticalDatum,
                minZ,
                maxZ,
                warnings,
            };
        }
        levelValues = [];
        // Compute levels as `first + k*interval` (not repeated `+=`) so float
        // error cannot accumulate and shift later levels off their interval.
        const first = Math.ceil(minZ / interval) * interval;
        const count = Math.floor((maxZ - first) / interval + 1e-9) + 1;
        for (let k = 0; k < count; k++)
            levelValues.push(first + k * interval);
    }
    // The spacing of the levels that end up emitted, so every field derived from
    // it describes the level list that actually ships. A caller-supplied list is
    // measured (null unless uniform); a derived list starts at the requested
    // interval and is rewritten by the thinning branch below.
    let effectiveIntervalM = levelsWereGiven
        ? uniformSpacing(levelValues)
        : params.intervalM;
    if (levelValues.length > maxLevels) {
        // THIN evenly rather than truncate from the top: the old slice kept only
        // the LOWEST maxLevels levels, so an over-fine interval silently deleted
        // every contour above the cut — summits vanished from the map with a
        // warning that never said so. Keeping every k-th level preserves the full
        // elevation range (the bottom level survives by construction; the top
        // level is forced in) at an effective interval of k × the requested one.
        const n = levelValues.length;
        const k = Math.ceil(n / maxLevels);
        const thinned = [];
        for (let i = 0; i < n; i += k)
            thinned.push(levelValues[i]);
        // Force the top level in so the summit contour survives the thinning.
        // (ceil(n / k) ≤ maxLevels entries, so replacing — not appending — keeps
        // the cap honest.)
        thinned[thinned.length - 1] = levelValues[n - 1];
        warnings.push(`level count ${n} exceeds cap ${maxLevels} — ${n} levels thinned to ` +
            `${thinned.length} (one level in every ${k} kept; the effective ` +
            `interval is ${k}× the requested one)`);
        levelValues = thinned;
        effectiveIntervalM = levelsWereGiven
            ? uniformSpacing(levelValues)
            : k * params.intervalM;
    }
    const levels = levelValues.map((value) => ({ value, segments: [] }));
    // Corner world positions for the marching square spanning cells
    // (col,row)…(col+1,row+1).
    //
    // CELL-CENTRE REGISTRATION: a DTM value z[row*cols+col] is the
    // representative elevation of the whole cell, i.e. it "lives" at the cell
    // CENTRE (originH + (col + 0.5)·cell), not at the cell's lower-left node.
    // Marching squares samples the four cell VALUES of a 2×2 block, so the
    // square's geometric corners are those four cell centres — hence the
    // +0.5·cellSizeM on both axes. v0.4.3 omitted the offset, shifting every
    // contour half a cell toward the south-west of where the surface actually
    // crosses the level.
    const cornerXY = (col, row) => [
        [originH1 + (col + 0.5) * cellSizeM, originH2 + (row + 0.5) * cellSizeM], // v0 BL
        [originH1 + (col + 1.5) * cellSizeM, originH2 + (row + 0.5) * cellSizeM], // v1 BR
        [originH1 + (col + 1.5) * cellSizeM, originH2 + (row + 1.5) * cellSizeM], // v2 TR
        [originH1 + (col + 0.5) * cellSizeM, originH2 + (row + 1.5) * cellSizeM], // v3 TL
    ];
    // Interpolate the crossing point on an edge for level v.
    const edgePoint = (edge, p, zc, v) => {
        const [aIdx, bIdx] = EDGE_CORNERS[edge];
        const za = zc[aIdx];
        const zb = zc[bIdx];
        const denom = zb - za;
        const t = Math.abs(denom) < 1e-12 ? 0.5 : (v - za) / denom;
        const tc = Math.max(0, Math.min(1, t));
        return [p[aIdx][0] + tc * (p[bIdx][0] - p[aIdx][0]), p[aIdx][1] + tc * (p[bIdx][1] - p[aIdx][1])];
    };
    for (let row = 0; row < rows - 1; row++) {
        for (let col = 0; col < cols - 1; col++) {
            const i0 = row * cols + col;
            const i1 = row * cols + (col + 1);
            const i2 = (row + 1) * cols + (col + 1);
            const i3 = (row + 1) * cols + col;
            // Gap-aware: any no-data corner → no honest contour through here.
            if (coverage[i0] === 0 ||
                coverage[i1] === 0 ||
                coverage[i2] === 0 ||
                coverage[i3] === 0 ||
                !Number.isFinite(z[i0]) ||
                !Number.isFinite(z[i1]) ||
                !Number.isFinite(z[i2]) ||
                !Number.isFinite(z[i3])) {
                continue;
            }
            const zc = [z[i0], z[i1], z[i2], z[i3]];
            const cellConf = Math.min(confidence[i0], confidence[i1], confidence[i2], confidence[i3]);
            const grade = (0, cellConfidence_1.gradeForConfidence)(cellConf);
            const p = cornerXY(col, row);
            for (let li = 0; li < levelValues.length; li++) {
                const v = levelValues[li];
                const mask = (zc[0] >= v ? 1 : 0) |
                    (zc[1] >= v ? 2 : 0) |
                    (zc[2] >= v ? 4 : 0) |
                    (zc[3] >= v ? 8 : 0);
                const pairs = mask === 5 || mask === 10 ? saddlePairs(mask, zc, v) : SEGMENT_TABLE[mask];
                if (pairs.length === 0)
                    continue;
                for (const [ea, eb] of pairs) {
                    const a = edgePoint(ea, p, zc, v);
                    const b = edgePoint(eb, p, zc, v);
                    // Skip degenerate zero-length segments (a corner sat exactly on
                    // the level), which would otherwise pollute counts and exports.
                    if (a[0] === b[0] && a[1] === b[1])
                        continue;
                    levels[li].segments.push({
                        x1: a[0],
                        y1: a[1],
                        x2: b[0],
                        y2: b[1],
                        confidence: cellConf,
                        grade,
                    });
                }
            }
        }
    }
    // Say WHY the set is empty. A caller that gets zero segments cannot tell a
    // flat surface from a computed contour set without counting geometry, so the
    // reason is stated here in the same shape the all-gap path uses. No tolerance
    // is invented: "flat" is an exact min == max over the same samples the levels
    // were derived from, and "effectively flat" is the weaker, equally decidable
    // condition that no level lies strictly inside the observed range — the whole
    // z-range sits between two adjacent levels, so there is nothing to cross.
    if (levels.every((l) => l.segments.length === 0)) {
        if (levelValues.length === 0) {
            warnings.push('no levels to trace — no contours');
        }
        else if (minZ === maxZ) {
            warnings.push(`flat surface (z = ${minZ}) — no contours`);
        }
        else if (!levelValues.some((v) => v > minZ && v < maxZ)) {
            warnings.push(`elevation range ${minZ}…${maxZ} falls between adjacent levels — no contours`);
        }
        else {
            warnings.push('no cell crosses any level — no contours');
        }
    }
    return {
        levels,
        intervalM: effectiveIntervalM,
        requestedIntervalM: params.intervalM,
        crs: dtm.crs,
        verticalDatum: dtm.verticalDatum,
        minZ,
        maxZ,
        warnings,
    };
}
/** Corner indices each edge sits between (matches SEGMENT_TABLE edges). */
const EDGE_CORNERS = [
    [0, 1], // edge 0 bottom: v0-v1
    [1, 2], // edge 1 right:  v1-v2
    [2, 3], // edge 2 top:    v2-v3
    [3, 0], // edge 3 left:   v3-v0
];
