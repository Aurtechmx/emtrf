"""Composition on random operator chains (rules: docs/RULES_ADDITIONAL_TESTS.md, D11).

Uses the independent Python model of the evidence rules (semantic_oracle.py), never the JavaScript
implementation. 10,000 random cases with a fixed seed: each draws source records (per channel a support
value, applicable-but-missing, or not applicable; a declared scope or none; provenance; lineage), splits
them at random into consecutive groups, meets each group, then meets the group results. The composed
record must equal the record from meeting all sources at once: per channel the same value, unavailable
state or absence, and the same scope; the same provenance and lineage. Exits non-zero on any mismatch.
"""
import json
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from semantic_oracle import UNAVAILABLE, applicable_channel_meet, lineage_union, provenance_union  # noqa: E402

CASES, SEED = 10_000, 20261111
CHANNELS = ('measured', 'interp', 'model')
SCOPES = ('a', 'b', 'c')


def random_source(rng, k):
    src = {'support': {}, 'applicability': {}, 'lineage': [f's{k}'],
           'provenance': frozenset(rng.sample(['M', 'I'], rng.randint(1, 2)))}
    for ch in CHANNELS:
        state = rng.choice(['value', 'value', 'value', 'missing', 'inapplicable'])
        scope = None if rng.random() < 0.6 else rng.sample(SCOPES, rng.randint(1, 3))
        if state == 'value':
            src['support'][ch] = round(rng.random(), 3)
            src['applicability'][ch] = (True, scope)
        elif state == 'missing':
            src['applicability'][ch] = (True, scope)
        else:
            src['applicability'][ch] = (False, None)
    return src


def meet(sources):
    """The output record of one representation step over these sources."""
    out = {'support': {}, 'applicability': {}, 'unavailable': [],
           'lineage': lineage_union(sources), 'provenance': provenance_union(s['provenance'] for s in sources)}
    for ch in CHANNELS:
        v, scope = applicable_channel_meet(sources, ch)
        if v is None:
            out['applicability'][ch] = (False, None)           # absent: carried as not applicable
        elif v == UNAVAILABLE:
            out['unavailable'].append(ch)
        else:
            out['support'][ch] = v
            out['applicability'][ch] = (True, scope)
    return out


def summary(rec):
    chans = {}
    for ch in CHANNELS:
        if ch in rec['unavailable']:
            chans[ch] = 'unavailable'
        elif ch in rec['support']:
            sc = rec['applicability'][ch][1]
            chans[ch] = (rec['support'][ch], None if sc is None else tuple(sorted(sc)))
        else:
            chans[ch] = 'absent'
    return chans, tuple(sorted(rec['provenance'])), tuple(rec['lineage'])


def main():
    rng = random.Random(SEED)
    mismatches, groups_total, unavailable_cases = [], 0, 0
    for case in range(CASES):
        n = rng.randint(2, 9)
        sources = [random_source(rng, k) for k in range(n)]
        cuts = sorted(rng.sample(range(1, n), rng.randint(0, n - 1)))
        parts = [sources[a:b] for a, b in zip([0] + cuts, cuts + [n])]
        groups_total += len(parts)
        direct, composed = summary(meet(sources)), summary(meet([meet(p) for p in parts]))
        if 'unavailable' in direct[0].values():
            unavailable_cases += 1
        if direct != composed:
            mismatches.append({'case': case, 'direct': repr(direct), 'composed': repr(composed)})
    print(json.dumps({'cases': CASES, 'seed': SEED, 'groups': groups_total,
                      'casesWithAnUnavailableChannel': unavailable_cases,
                      'mismatches': len(mismatches), 'firstMismatches': mismatches[:3]}, indent=1))
    sys.exit(1 if mismatches else 0)


if __name__ == '__main__':
    main()
