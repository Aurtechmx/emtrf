#!/usr/bin/env python3
"""Exact JavaScript<->Python differential comparator.

Reads results/js_differential.jsonl and results/py_differential.jsonl -- both produced from
the SAME shared corpus (oracles/fixtures/differential_2500.jsonl) -- and asserts, per fixture:
  * ordinary-DP retained indices identical;
  * EC-DP retained indices identical;
  * EC-DP source intervals identical;
  * per-interval complete-arc support difference <= 1e-15;
and that both sides cover exactly 500 fixtures at each of the five tolerances (2,500 total).
Exits non-zero on any mismatch. No third-party dependencies.
"""
import json
import os
import sys

HERE = os.path.dirname(__file__)
TOLERANCES = [0.02, 0.05, 0.10, 0.20, 0.40]
PER_TOL = 500


def load(name):
    d = {}
    with open(os.path.join(HERE, 'results', name)) as f:
        for line in f:
            line = line.strip()
            if line:
                r = json.loads(line)
                d[r['fixture_id']] = r
    return d


def main():
    js = load('js_differential.jsonl')
    py = load('py_differential.jsonl')
    fails = []
    if set(js) != set(py):
        fails.append(f"fixture id sets differ (js {len(js)} vs py {len(py)})")
    per_tol = {t: 0 for t in TOLERANCES}
    max_support_diff = 0.0
    for fid in sorted(set(js) & set(py)):
        a, b = js[fid], py[fid]
        if a['tolerance'] != b['tolerance']:
            fails.append(f"fixture {fid}: tolerance {a['tolerance']} != {b['tolerance']}"); continue
        per_tol[a['tolerance']] = per_tol.get(a['tolerance'], 0) + 1
        if a['dp'] != b['dp']:
            fails.append(f"fixture {fid}: ordinary-DP indices differ")
        if a['ecdp'] != b['ecdp']:
            fails.append(f"fixture {fid}: EC-DP indices differ")
        if a['intervals'] != b['intervals']:
            fails.append(f"fixture {fid}: source intervals differ")
        if len(a['support']) != len(b['support']):
            fails.append(f"fixture {fid}: support length differs")
        else:
            for sa, sb in zip(a['support'], b['support']):
                diff = abs(sa - sb)
                if diff > max_support_diff:
                    max_support_diff = diff
                if diff > 1e-15:
                    fails.append(f"fixture {fid}: support diff {diff} > 1e-15")
    for t in TOLERANCES:
        if per_tol.get(t, 0) != PER_TOL:
            fails.append(f"tolerance {t}: {per_tol.get(t,0)} fixtures != {PER_TOL}")
    total = sum(per_tol.values())
    print(f"  matched fixtures             : {total} (500 per tolerance)")
    print(f"  ordinary-DP indices identical: {'yes' if not any('ordinary-DP' in f for f in fails) else 'NO'}")
    print(f"  EC-DP indices identical      : {'yes' if not any('EC-DP indices' in f for f in fails) else 'NO'}")
    print(f"  source intervals identical   : {'yes' if not any('intervals' in f for f in fails) else 'NO'}")
    print(f"  max support difference       : {max_support_diff:g} (threshold 1e-15)")
    if fails:
        print("js<->py differential: FAIL")
        for f in fails[:20]:
            print("  - " + f)
        sys.exit(1)
    print(f"js<->py differential: PASS ({total} cross-language fixtures, max support diff {max_support_diff:g})")
    sys.exit(0)


if __name__ == '__main__':
    main()
