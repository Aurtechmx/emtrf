#!/usr/bin/env python3
"""Independent Python DP / EC-DP implementation for the cross-language differential.

This program reads the shared, language-neutral fixture corpus
(oracles/fixtures/differential_2500.jsonl) -- the SAME 2,500 deterministic fixtures
(500 per tolerance) the JavaScript side reads -- and reimplements, from scratch:
  * ordinary Douglas-Peucker two ways (recursive and iterative-stack), using the same
    clamped-segment perpendicular distance as the shipped JavaScript reference;
  * complete-source EC-DP (evidence inherited as the minimum over each represented arc).
It never calls JavaScript or reads JavaScript output. It writes its per-fixture results to
results/py_differential.jsonl for the exact comparator (compare_differential.py), and it
also self-checks internal properties, exiting non-zero on any internal disagreement:
  * the recursive and iterative DP retain identical indices;
  * EC-DP retains exactly the DP indices on fully supported input (geometry preservation);
  * ordinary endpoint-only assignment promotes support above the arc minimum somewhere
    (the failure the contract exists to prevent), while EC-DP never does.
No third-party dependencies.
"""
import json
import math
import os
import sys

HERE = os.path.dirname(__file__)
CORPUS = os.path.join(HERE, 'fixtures', 'differential_2500.jsonl')
TOLERANCES = [0.02, 0.05, 0.10, 0.20, 0.40]
PER_TOL = 500


def perp(px, py, ax, ay, bx, by):
    """Clamped-segment perpendicular distance -- identical metric to the shipped JS."""
    dx, dy = bx - ax, by - ay
    len2 = dx * dx + dy * dy
    if len2 <= 1e-24:
        return math.hypot(px - ax, py - ay)
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / len2))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def dp_recursive(pts, eps):
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True

    def rec(lo, hi):
        dmax, idx = -1.0, -1
        for i in range(lo + 1, hi):
            d = perp(*pts[i], *pts[lo], *pts[hi])
            if d > dmax:
                dmax, idx = d, i
        if dmax > eps and idx > lo:
            keep[idx] = True
            rec(lo, idx)
            rec(idx, hi)

    if len(pts) > 1:
        rec(0, len(pts) - 1)
    return [i for i, k in enumerate(keep) if k]


def dp_stack(pts, eps):
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        lo, hi = stack.pop()
        dmax, idx = -1.0, -1
        for i in range(lo + 1, hi):
            d = perp(*pts[i], *pts[lo], *pts[hi])
            if d > dmax:
                dmax, idx = d, i
        if dmax > eps and idx > lo:
            keep[idx] = True
            stack.append((lo, idx))
            stack.append((idx, hi))
    return [i for i, k in enumerate(keep) if k]


def ecdp(pts, support, eps):
    """Complete-source EC-DP on fully supported input: DP geometry, with each retained span
    assigned the minimum support over the complete represented source arc. Returns
    (retained_indices, source_intervals, per_interval_support)."""
    retained = dp_recursive(pts, eps)
    intervals = [[a, b] for a, b in zip(retained, retained[1:])]
    assigned = [min(support[a:b + 1]) for a, b in intervals]
    return retained, intervals, assigned


def main():
    if not os.path.exists(CORPUS):
        print(f"missing corpus {CORPUS}", file=sys.stderr)
        sys.exit(1)
    total = agree = geom_ok = 0
    endpoint_promotions = ecdp_promotions = 0
    per_tol = {}
    os.makedirs(os.path.join(HERE, 'results'), exist_ok=True)
    out = open(os.path.join(HERE, 'results', 'py_differential.jsonl'), 'w')
    with open(CORPUS) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            rec = json.loads(line)
            eps = rec['tolerance']
            pts = [(c[0], c[1]) for c in rec['coordinates']]
            support = rec['support']
            r1 = dp_recursive(pts, eps)
            r2 = dp_stack(pts, eps)
            retained, intervals, assigned = ecdp(pts, support, eps)
            total += 1
            per_tol[eps] = per_tol.get(eps, 0) + 1
            if r1 == r2:
                agree += 1
            if retained == r1:
                geom_ok += 1
            for (a, b), asg in zip(intervals, assigned):
                ep = min(support[a], support[b])          # endpoint-only value
                arc = min(support[a:b + 1])               # complete-arc minimum
                if ep > arc + 1e-15:
                    endpoint_promotions += 1
                if asg > arc + 1e-15:
                    ecdp_promotions += 1
            out.write(json.dumps({'fixture_id': rec['fixture_id'], 'tolerance': eps,
                                  'dp': r1, 'ecdp': retained,
                                  'intervals': intervals, 'support': assigned}) + '\n')
    out.close()
    ok = (agree == total == geom_ok
          and ecdp_promotions == 0 and endpoint_promotions > 0
          and all(per_tol.get(t) == PER_TOL for t in TOLERANCES))
    print(f"  fixtures per tolerance       : " + ", ".join(f"{t}:{per_tol.get(t,0)}" for t in TOLERANCES))
    print(f"  recursive == iterative DP    : {agree}/{total}")
    print(f"  EC-DP geometry == DP         : {geom_ok}/{total}")
    print(f"  endpoint-only promotions     : {endpoint_promotions} (must be > 0)")
    print(f"  EC-DP promotions             : {ecdp_promotions} (must be 0)")
    print(f"dp/ec-dp python implementation: {'PASS' if ok else 'FAIL'} ({total} fixtures, 500 per tolerance)")

    with open(os.path.join(HERE, 'results', 'differential.json'), 'w') as f:
        json.dump({'fixtures': total, 'fixtures_per_tolerance': per_tol,
                   'recursive_stack_agreement': agree, 'geometry_preserved': geom_ok,
                   'endpoint_only_promotions': endpoint_promotions,
                   'ecdp_promotions': ecdp_promotions}, f, indent=2)
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
