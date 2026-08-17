#!/usr/bin/env node
/*
 * Exact-truth conformance checks (Section 4.1 / Table 4 finite-state rows).
 * Asserts the closed-form results the manuscript reports and exits non-zero on any mismatch:
 *   - measured-support boundedness/monotonicity and single-return edge value;
 *   - interpolation-distance sequence;
 *   - 256 directional patterns, one-sided count, and 45-degree rotation invariance;
 *   - closed-ring 32 cyclic reindexings collapse to one output signature with zero promotions.
 * Node only, no dependencies.
 */
'use strict';
const path = require('path');
// the real typed EC-DP implementation used by the study (not a local reimplementation)
const { evidenceConstrainedDouglasPeuckerTyped } =
  require(path.join(__dirname, 'reference', 'compiled', 'evidenceConstrainedGeneralizeTyped.js'));
// the shipped typed-evidence algebra (applicability / scope / lineage clauses)
const { typedMeet } =
  require(path.join(__dirname, 'reference', 'compiled', 'typedEvidenceOperators.js'));

// ---- ordinary Douglas-Peucker, independent of the EC-DP module ------------
// Written here (not imported) so the Proposition 2 comparison below is against an
// independent geometric recursion rather than the module under test.
function perpDist(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy;
  if (len2 <= 1e-24) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
function dpIndices(v, a, b, tol) {
  if (b <= a + 1) return [a, b];
  let idx = -1, max = -1;
  for (let i = a + 1; i < b; i++) { const d = perpDist(v[i], v[a], v[b]); if (d > max) { max = d; idx = i; } }
  if (max > tol && idx > a) {
    const l = dpIndices(v, a, idx, tol), r = dpIndices(v, idx, b, tol);
    return [...l.slice(0, -1), ...r];
  }
  return [a, b];
}

// ---- reference support profiles (Eqs. 3-4) --------------------------------
const CM = (n, nt, h) => Math.min(1, n / nt) * (n / (n + h));
const CI = (d, rho, gamma, beta = 0.8, rhoStar = 1.0) =>
  (1 / (1 + d)) * (1 - beta * Math.min(1, rho / rhoStar)) * gamma;

// ---- directional classifier: 8 sectors, separation-gap rule --------------
function isOneSided(pattern) {
  const occ = [];
  for (let k = 0; k < 8; k++) if (pattern & (1 << k)) occ.push(k);
  if (occ.length === 0) return false;
  if (occ.length === 1) return true;
  let maxGap = 0;
  for (let i = 0; i < occ.length; i++) {
    const a = occ[i], b = occ[(i + 1) % occ.length];
    const gap = ((b - a + 8) % 8) || 8;          // angular separation between adjacent occupied rays
    if (gap > maxGap) maxGap = gap;
  }
  return maxGap > 4;
}
const rotate45 = p => ((p << 1) | (p >> 7)) & 0xFF;

// EC-DP on a closed ring: anchor at the lexicographically smallest vertex, unroll, and call the
// real typed EC-DP. The promotion check compares the implementation's ACTUAL assigned support
// against an independently computed complete-arc minimum (no tautology).
function ringSignature(coords, support, eps) {
  const n = coords.length;
  let anchor = 0;
  for (let i = 1; i < n; i++) {
    if (coords[i][0] < coords[anchor][0] ||
       (coords[i][0] === coords[anchor][0] && coords[i][1] < coords[anchor][1])) anchor = i;
  }
  const verts = [], rs = [];
  for (let k = 0; k <= n; k++) {                     // unroll: duplicate the anchor to close the ring
    const j = (anchor + k) % n;
    rs.push(support[j]);
    verts.push({ x: coords[j][0], y: coords[j][1], state: 'measured',
                 provenance: ['measured'], support: { 'raw-measured-support': support[j] } });
  }
  const r = evidenceConstrainedDouglasPeuckerTyped(verts, eps);
  let promo = 0; const assigned = [];
  for (const seg of r.segments) {
    const actual = seg.support['raw-measured-support'];          // implementation output
    let trueMin = Infinity;                                      // independent complete-arc minimum
    for (let t = seg.sourceStart; t <= seg.sourceEnd; t++) trueMin = Math.min(trueMin, rs[t]);
    assigned.push(actual);
    if (actual > trueMin + 1e-15) promo++;                       // genuine promotion test
  }
  return { sig: JSON.stringify([r.retainedIndices, assigned.map(x => Math.round(x * 1e6))]), promo };
}

// ---- run + assert ---------------------------------------------------------
const checks = [];
const record = (name, ok, detail) => checks.push({ name, ok, detail });

// measured support: monotone over n=1..40, range, single-return edge
const cm = []; for (let n = 1; n <= 40; n++) cm.push(CM(n, 10, 3));
record('measured support monotone n=1..40', cm.every((v, i) => i === 0 || v >= cm[i - 1]));
record('measured support range 0.025..0.930',
  Number(cm[0].toFixed(3)) === 0.025 && Number(cm[39].toFixed(3)) === 0.930,
  `[${cm[0].toFixed(3)}, ${cm[39].toFixed(3)}]`);
record('single-return C_M(1;1,3)=0.25', Number(CM(1, 1, 3).toFixed(3)) === 0.25);

// interpolation distance sequence d=1..4
const seq = [1, 2, 3, 4].map(d => Number(CI(d, 0, 1).toFixed(3)));
record('interpolation sequence 0.50,0.333,0.25,0.20',
  JSON.stringify(seq) === JSON.stringify([0.5, 0.333, 0.25, 0.2]), seq.join(', '));

// 256 directional patterns
let oneSided = 0, mismatch = 0;
for (let p = 0; p < 256; p++) { const a = isOneSided(p); if (a) oneSided++; if (a !== isOneSided(rotate45(p))) mismatch++; }
record('directional: 256 patterns, 64 one-sided', oneSided === 64, `${oneSided}/256`);
record('directional: 0 rotation mismatches', mismatch === 0, `${mismatch}`);

// closed ring: 32 cyclic reindexings collapse to one signature, zero promotions
const N = 32, cx = [], cs = [];
for (let i = 0; i < N; i++) { const th = 2 * Math.PI * i / N; cx.push([Math.cos(th) * 5, Math.sin(th) * 5]); cs.push(0.9); }
cs[7] = 0.2;                                       // one weak interior vertex
const sigs = new Set(); let ringPromo = 0;
for (let r = 0; r < N; r++) {
  const rc = [], rs = [];
  for (let k = 0; k < N; k++) { const j = (r + k) % N; rc.push(cx[j]); rs.push(cs[j]); }
  const { sig, promo } = ringSignature(rc, rs, 0.1);
  sigs.add(sig); ringPromo += promo;
}
record('closed ring: 32 reindexings -> 1 signature', sigs.size === 1, `${sigs.size} distinct`);
record('closed ring: 0 support promotions', ringPromo === 0, `${ringPromo}`);

// ---- applicability / scope / lineage clauses, asserted on the SHIPPED implementation ----
// These distinguish "not applicable to this source" (ignore) from "applicable to this
// source but carrying no value" (output channel unavailable, never computed from the rest).
const MS = 'model-support';
const src = (v, app, lineage) => {
  const e = { provenance: ['measured'], support: v == null ? {} : { [MS]: v } };
  if (app !== undefined) e.applicability = { [MS]: app };
  if (lineage) e.lineage = lineage;
  return e;
};
{
  const r = typedMeet([src(0.80, { applicable: true }), src(null, { applicable: false })]);
  record('applicability: not-applicable source ignored', r.support[MS] === 0.80 && !r.unavailable, `${r.support[MS]}`);
}
{
  const r = typedMeet([src(0.80, { applicable: true }), src(0.55, { applicable: true })]);
  record('applicability: applicable everywhere -> minimum', r.support[MS] === 0.55, `${r.support[MS]}`);
}
{
  // Applicable to a required source but carrying no value -> unavailable, and the refusal must
  // survive composition: re-meeting with an inapplicable source must still be unavailable, and
  // must agree with the equivalent direct meet (unavailable != absent != inapplicable).
  const r = typedMeet([src(0.80, { applicable: true }), src(null, { applicable: true })]);
  const composed = typedMeet([r, src(null, { applicable: false })]);
  const direct = typedMeet([src(0.80, { applicable: true }), src(null, { applicable: true }),
                            src(null, { applicable: false })]);
  const un = (x) => x.support[MS] === undefined && (x.unavailable || []).includes(MS);
  record('applicability: applicable-but-missing -> unavailable (and under composition)',
    un(r) && un(composed) && un(direct),
    `direct=${JSON.stringify(direct.unavailable || [])} composed=${JSON.stringify(composed.unavailable || [])}`);
}
{
  const r = typedMeet([src(0.70, { applicable: true, scope: ['bare-earth', 'vegetated'] }),
                       src(0.50, { applicable: true, scope: ['bare-earth'] })]);
  record('applicability: scope intersection does not broaden',
    r.support[MS] === 0.50 && JSON.stringify(r.scope?.[MS]) === JSON.stringify(['bare-earth']),
    JSON.stringify(r.scope?.[MS]));
}
{
  const r = typedMeet([src(0.70, { applicable: true, scope: ['bare-earth'] }),
                       src(0.50, { applicable: true, scope: ['urban'] })]);
  record('applicability: empty scope intersection -> unavailable',
    r.support[MS] === undefined && (r.unavailable || []).includes(MS), JSON.stringify(r.unavailable || []));
}
{
  const r = typedMeet([src(0.90, undefined, ['tileB', 'tileA']), src(0.40, undefined, ['tileA', 'tileC'])]);
  record('lineage: complete union over the source set',
    JSON.stringify(r.lineage) === JSON.stringify(['tileA', 'tileB', 'tileC']), JSON.stringify(r.lineage));
}
{
  // legacy records (no applicability declared) must behave exactly as before
  const r = typedMeet([{ provenance: ['measured'], support: { [MS]: 0.9 } },
                       { provenance: ['measured'], support: { [MS]: 0.2 } }]);
  record('backward compatibility: undeclared applicability == present',
    r.support[MS] === 0.2 && r.unavailable === undefined && r.scope === undefined, `${r.support[MS]}`);
}

// ---- EC-DP must forward the COMPLETE evidence payload into the arc meet -------------------
// Geometry may drop a vertex, but the dropped vertex's applicability, scope and lineage still
// constrain the segment. A partial evidence record here would strip applicability, so an
// applicable-but-unreported source would be misread as inapplicable and the segment could
// report a value the contract requires to be unavailable.
{
  const vtx = (x, s, scope, lin) => ({
    x, y: 0, state: 'measured', provenance: ['measured'],
    support: s == null ? {} : { [MS]: s },
    applicability: { [MS]: { applicable: true, ...(scope ? { scope } : {}) } },
    lineage: [lin],
  });
  // collinear, high tolerance: the interior vertex is dropped geometrically
  const r = evidenceConstrainedDouglasPeuckerTyped(
    [vtx(0, 0.80, null, 'v0'), vtx(1, null, null, 'v1'), vtx(2, 0.90, null, 'v2')], 10);
  const seg = r.segments[0];
  const geomOk = JSON.stringify(r.retainedIndices) === JSON.stringify([0, 2]);
  record('EC-DP: applicable-but-missing interior -> segment channel unavailable',
    geomOk && seg != null && seg.support[MS] === undefined && (seg.unavailable || []).includes(MS),
    `retained=${JSON.stringify(r.retainedIndices)} support=${JSON.stringify(seg && seg.support)}`);
  record('EC-DP: complete source lineage reaches the segment',
    seg != null && JSON.stringify(seg.lineage) === JSON.stringify(['v0', 'v1', 'v2']),
    JSON.stringify(seg && seg.lineage));

  const r2 = evidenceConstrainedDouglasPeuckerTyped(
    [vtx(0, 0.70, ['bare-earth', 'vegetated'], 'a'),
     vtx(1, 0.60, ['bare-earth', 'urban'], 'b'),
     vtx(2, 0.90, ['bare-earth'], 'c')], 10);
  const seg2 = r2.segments[0];
  record('EC-DP: scope intersection propagates through simplification',
    seg2 != null && seg2.support[MS] === 0.60 &&
    JSON.stringify(seg2.scope && seg2.scope[MS]) === JSON.stringify(['bare-earth']),
    `support=${seg2 && seg2.support[MS]} scope=${JSON.stringify(seg2 && seg2.scope && seg2.scope[MS])}`);
}

// ---- Proposition 2 across a provenance transition ----------------------------------------
// On fully supported input EC-DP must retain exactly the ordinary-DP indices even when the
// polyline changes provenance state. The collapsed transition is conserved in the evidence
// payload (provenance union, unlike channels kept separate), not by pinning geometry.
{
  const mv = (x, s) => ({ x, y: 0, state: 'measured', provenance: ['measured'],
    support: { 'empirical-measured-reliability': s } });
  const iv = (x, s) => ({ x, y: 0, state: 'interpolated', provenance: ['interpolated'],
    support: { 'geometric-interpolation-support': s } });
  const verts = [mv(0, 0.9), mv(1, 0.8), iv(2, 0.45), iv(3, 0.6)];   // straight line
  const ord = dpIndices(verts, 0, verts.length - 1, 10);
  const r = evidenceConstrainedDouglasPeuckerTyped(verts, 10);
  const seg = r.segments[0];
  record('EC-DP: geometry matches ordinary DP across a provenance transition',
    JSON.stringify(r.retainedIndices) === JSON.stringify(ord),
    `ecdp=${JSON.stringify(r.retainedIndices)} dp=${JSON.stringify(ord)}`);
  record('EC-DP: collapsed transition conserves both ancestries and unlike channels',
    seg != null && JSON.stringify(seg.provenance) === JSON.stringify(['measured', 'interpolated']) &&
    seg.support['empirical-measured-reliability'] === 0.8 &&
    seg.support['geometric-interpolation-support'] === 0.45,
    seg && `${JSON.stringify(seg.provenance)} ${JSON.stringify(seg.support)}`);
}

let allOk = true;
for (const c of checks) { console.log(`  [${c.ok ? 'PASS' : 'FAIL'}] ${c.name}${c.detail ? ' (' + c.detail + ')' : ''}`); if (!c.ok) allOk = false; }
console.log(`conformance checks: ${allOk ? 'PASS' : 'FAIL'} (${checks.length} exact-truth assertions)`);
process.exit(allOk ? 0 : 1);
