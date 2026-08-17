"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.typedMeet = typedMeet;
exports.contourEvidence = contourEvidence;
exports.stitchEvidence = stitchEvidence;
exports.smoothEvidence = smoothEvidence;
const PROV_ORDER = ['measured', 'interpolated'];
const SUPPORT_ORDER = [
    'raw-measured-support',
    'empirical-measured-reliability',
    'geometric-interpolation-support',
    'model-support',
];
function normalizeProvenance(xs) {
    const set = new Set(xs);
    return PROV_ORDER.filter((x) => set.has(x));
}
function validateSupport(channels) {
    for (const key of SUPPORT_ORDER) {
        const v = channels[key];
        if (v == null)
            continue;
        if (!Number.isFinite(v) || v < 0 || v > 1)
            throw new RangeError(`invalid support channel ${key}`);
    }
}
/**
 * A_i for one channel, inferring the declaration when none is given.
 * A channel already carried as UNAVAILABLE stays applicable: unavailable means "applicable
 * to a required source but not reportable", which is distinct from absent and from
 * inapplicable. Without this, a second representation operation would reinterpret an
 * unavailable channel as inapplicable and silently drop it, so a composed chain could
 * report less refusal than the equivalent direct meet (Theorem 1).
 */
function applicabilityOf(input, meaning) {
    const declared = input.applicability?.[meaning];
    if (declared != null)
        return declared;
    if ((input.unavailable ?? []).includes(meaning)) {
        return { applicable: true, scope: input.scope?.[meaning] };
    }
    return { applicable: input.support[meaning] != null, scope: input.scope?.[meaning] };
}
/**
 * Evidence meet for representation-only operators.
 * - provenance: set union
 * - support: minimum WITHIN each semantic channel, over the sources the channel applies to
 * - applicability: a channel applicable to a required source but missing a value makes the
 *   output channel UNAVAILABLE (never computed from the remaining sources)
 * - scope: intersection of the applicable sources' declared scopes; empty => unavailable
 * - lineage: union over all sources
 * No comparison is made between unlike meanings.
 */
function typedMeet(inputs) {
    if (inputs.length === 0)
        throw new RangeError('empty evidence source set');
    const provenance = [];
    const support = {};
    const scope = {};
    const unavailable = [];
    const lineage = new Set();
    for (const input of inputs) {
        validateSupport(input.support);
        provenance.push(...input.provenance);
        for (const src of input.lineage ?? [])
            lineage.add(src);
    }
    for (const meaning of SUPPORT_ORDER) {
        const applicableSources = inputs.filter((i) => applicabilityOf(i, meaning).applicable);
        // Clause 1: no source declares the channel applicable -> do not invent it.
        if (applicableSources.length === 0)
            continue;
        // Clause 3: applicable somewhere but missing a value there -> unavailable.
        const missing = applicableSources.some((i) => i.support[meaning] == null);
        // Any source that already carries the channel as unavailable propagates that.
        const inheritedUnavailable = inputs.some((i) => (i.unavailable ?? []).includes(meaning));
        if (missing || inheritedUnavailable) {
            unavailable.push(meaning);
            continue;
        }
        // Clause 4/5: scope is the intersection over applicable sources; empty -> unavailable.
        let terms = null;
        for (const i of applicableSources) {
            const declared = applicabilityOf(i, meaning).scope ?? i.scope?.[meaning];
            if (declared == null)
                continue; // unrestricted: no narrowing
            terms = terms == null ? [...declared] : terms.filter((t) => declared.includes(t));
        }
        if (terms != null && terms.length === 0) {
            unavailable.push(meaning);
            continue;
        }
        // Clause 2: same-channel minimum over the applicable sources.
        let min = Infinity;
        for (const i of applicableSources)
            min = Math.min(min, i.support[meaning]);
        support[meaning] = min;
        if (terms != null)
            scope[meaning] = terms;
    }
    const out = { provenance: normalizeProvenance(provenance), support };
    // Optional fields stay absent when empty, so legacy records round-trip unchanged.
    if (unavailable.length > 0)
        out.unavailable = SUPPORT_ORDER.filter((m) => unavailable.includes(m));
    if (Object.keys(scope).length > 0)
        out.scope = scope;
    if (lineage.size > 0)
        out.lineage = [...lineage].sort();
    return out;
}
function contourEvidence(corners) {
    if (corners.some((c) => c.state === 'unsupported'))
        return null;
    return typedMeet(corners);
}
function stitchEvidence(a, b) {
    return typedMeet([a, b]);
}
function smoothEvidence(a, b) {
    return typedMeet([a, b]);
}
