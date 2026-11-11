"""EC-wrap: attach complete-source evidence to the output of ANY simplifier.

Input: a source line (vertices in order, one evidence record per edge) and the simplifier's output,
which must be a subsequence of the source vertices that keeps both ends (true of Douglas-Peucker,
Visvalingam-Whyatt, Lang, Reumann-Witkam and the simplifiers of GDAL/GEOS, GRASS, SAGA, sf and
scikit-image). EC-wrap recovers which source edges each output segment replaces and gives it the
minimum support per channel, the provenance union and the support profile of those edges. The
simplifier is not touched.

Demonstration: Visvalingam-Whyatt (the `simplification` package, Rust implementation) on the strict
feature runs of the four crops at an effective area of one source cell squared, compared with
endpoint attribution of the same output.
"""
import json, sys
from pathlib import Path

THRESHOLDS = (66, 33)


def source_map(src, out):
    """Indices of src at which the output vertices occur, in order, ends pinned. Backtracks for
    lines that pass through the same point twice. None if `out` is not such a subsequence."""
    key = lambda p: (round(p[0], 9), round(p[1], 9))
    pos = {}
    for j, p in enumerate(src):
        pos.setdefault(key(p), []).append(j)
    sys.setrecursionlimit(max(10000, 4 * len(out)))
    ko = [key(p) for p in out]

    def go(k, lo):
        if k == len(ko):
            return []
        for j in pos.get(ko[k], []):
            if j < lo or (k == 0 and j != 0) or (k == len(ko) - 1 and j != len(src) - 1):
                continue
            rest = go(k + 1, j + 1)
            if rest is not None:
                return [j] + rest
        return None
    return go(0, 0)


class AmbiguousMatch(ValueError):
    """More than one assignment of output vertices to source indices exists, so the replaced
    source edges are not uniquely determined."""


def count_maps(src, out, cap=2):
    """Number of order-preserving assignments of the output vertices to source indices with both
    ends pinned (capped at `cap`)."""
    key = lambda p: (round(p[0], 9), round(p[1], 9))
    pos = {}
    for j, p in enumerate(src):
        pos.setdefault(key(p), []).append(j)
    ko = [key(p) for p in out]
    ways = {}
    for k, kk in enumerate(ko):
        cur = {}
        for j in pos.get(kk, []):
            if (k == 0 and j != 0) or (k == len(ko) - 1 and j != len(src) - 1):
                continue
            cur[j] = 1 if k == 0 else min(cap, sum(w for jp, w in ways.items() if jp < j))
        ways = cur
    return min(cap, sum(ways.values()))


def wrap(vertices, edges, out_vertices, channels=("M", "I")):
    """Complete-source records for each output segment: {interval, provenance, min, profile}.
    Raises ValueError if the output is not a vertex subsequence of the source, and AmbiguousMatch
    if the source indices cannot be recovered uniquely (the line is then reported, not guessed)."""
    idx = source_map(vertices, out_vertices)
    if idx is None:
        raise ValueError("output is not a vertex subsequence of the source with both ends kept")
    if count_maps(vertices, out_vertices) > 1:
        raise AmbiguousMatch("output vertices match the source in more than one way")
    recs = []
    for a, b in zip(idx[:-1], idx[1:]):
        rec = {"interval": [a, b], "provenance": sorted({c for k in range(a, b) for c in
               ({"M", "I"} if edges[k]["provenance"] == "X" else {edges[k]["provenance"]})}), "min": {}, "profile": {}}
        for ch in channels:
            tot = 0.0; above = {t: 0.0 for t in THRESHOLDS}; mn = None
            for k in range(a, b):
                v = edges[k].get(ch)
                if v is None:
                    continue
                l = ((vertices[k + 1][0] - vertices[k][0]) ** 2 + (vertices[k + 1][1] - vertices[k][1]) ** 2) ** 0.5
                tot += l; mn = v if mn is None else min(mn, v)
                for t in THRESHOLDS:
                    if v >= t:
                        above[t] += l
            rec["min"][ch] = mn
            rec["profile"][ch] = None if tot == 0 else {t: above[t] / tot for t in THRESHOLDS}
        recs.append(rec)
    return idx, recs


def endpoint_records(edges, idx, channels=("M", "I")):
    recs = []
    for a, b in zip(idx[:-1], idx[1:]):
        ends = [edges[a], edges[b - 1]]
        recs.append({ch: (min(v for v in (e.get(ch) for e in ends) if v is not None)
                          if any(e.get(ch) is not None for e in ends) else None) for ch in channels})
    return recs


if __name__ == "__main__":
    from simplification.cutil import simplify_coords_vw
    runs_file = Path(sys.argv[1]); out_json = Path(sys.argv[2])
    sites = json.loads(runs_file.read_text()); result = []
    for s in sites:
        area = s["cellSizeM"] ** 2
        acc = dict(lines=0, src=0, ret=0, spans=0, prom=0, loss=0, unmatched=0, ambiguous=0, wprom=0, wloss=0)
        for run in s["runs"]:
            V = run["vertices"]; E = run["edges"]
            out = [list(p) for p in simplify_coords_vw(V, area)]
            try:
                idx, recs = wrap(V, E, out)
            except AmbiguousMatch:
                acc["ambiguous"] += 1; continue
            except ValueError:
                acc["unmatched"] += 1; continue
            ep = endpoint_records(E, idx)
            acc["lines"] += 1; acc["src"] += len(V); acc["ret"] += len(idx); acc["spans"] += len(recs)
            for r, e in zip(recs, ep):
                acc["prom"] += any(e[ch] is not None and r["min"][ch] is not None and e[ch] > r["min"][ch] + 1e-12 for ch in ("M", "I"))
                a, b = r["interval"]
                carried = {c for k in (a, b - 1) for c in ({"M", "I"} if E[k]["provenance"] == "X" else {E[k]["provenance"]})}
                acc["loss"] += not set(r["provenance"]) <= carried
                # EC-wrap's own records, scored by the same rule against the replaced edges.
                truth_min = {ch: min((E[k].get(ch) for k in range(a, b) if E[k].get(ch) is not None), default=None) for ch in ("M", "I")}
                truth_prov = {c for k in range(a, b) for c in ({"M", "I"} if E[k]["provenance"] == "X" else {E[k]["provenance"]})}
                acc["wprom"] += any(r["min"][ch] is not None and r["min"][ch] > truth_min[ch] + 1e-12 for ch in ("M", "I"))
                acc["wloss"] += not truth_prov <= set(r["provenance"])
        pct = lambda n, d: round(100 * n / d, 1) if d else 0.0
        result.append({"site": s["label"], "simplifier": "Visvalingam-Whyatt (simplification package)", "areaM2": area,
                       "lines": acc["lines"], "linesNotSubsequence": acc["unmatched"], "linesAmbiguousMatch": acc["ambiguous"], "sourceVertices": acc["src"], "retainedVertices": acc["ret"],
                       "vertexReductionPct": pct(acc["src"] - acc["ret"], acc["src"]), "spans": acc["spans"],
                       "endpointPromotion": acc["prom"], "endpointPromotionPct": pct(acc["prom"], acc["spans"]),
                       "endpointProvenanceLoss": acc["loss"], "endpointProvenanceLossPct": pct(acc["loss"], acc["spans"]),
                       "ecwrapPromotion": acc["wprom"], "ecwrapProvenanceLoss": acc["wloss"]})
    out_json.write_text(json.dumps({"driver": "EC-wrap on a non-DP simplifier", "sites": result}, indent=1) + "\n")
    for r in result:
        print(f"{r['site']:13s} lines {r['lines']:3d} red {r['vertexReductionPct']:5.1f}% spans {r['spans']:4d} endpoint prom {r['endpointPromotion']} ({r['endpointPromotionPct']}%) loss {r['endpointProvenanceLoss']} ({r['endpointProvenanceLossPct']}%) ecwrap {r['ecwrapPromotion']}/{r['ecwrapProvenanceLoss']} unmatched {r['linesNotSubsequence']}")
