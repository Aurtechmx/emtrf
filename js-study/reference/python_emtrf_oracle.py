#!/usr/bin/env python3
"""Independent Python oracle for the EMTRF typed evidence algebra.

This module is written from the manuscript contract rather than importing or
executing the TypeScript reference implementation. It is intentionally small:
it verifies the semantic algebra and complete-source-arc evidence aggregation,
not terrain-estimator accuracy.
"""
from __future__ import annotations
from dataclasses import dataclass
from typing import Dict, FrozenSet, Iterable, Optional, Sequence
import json

@dataclass(frozen=True)
class Evidence:
    provenance: FrozenSet[str]
    support: Dict[str, float]
    unsupported: bool = False


def meet(items: Iterable[Evidence]) -> Optional[Evidence]:
    xs = list(items)
    if not xs:
        raise ValueError("meet requires at least one source")
    if any(x.unsupported for x in xs):
        return None
    provenance = frozenset().union(*(x.provenance for x in xs))
    meanings = set().union(*(x.support.keys() for x in xs))
    support: Dict[str, float] = {}
    for mu in meanings:
        vals = [x.support[mu] for x in xs if mu in x.support]
        if not vals:
            continue
        if any(not 0.0 <= v <= 1.0 for v in vals):
            raise ValueError(f"support outside [0,1] in channel {mu}")
        support[mu] = min(vals)
    return Evidence(provenance, support)


def arc_evidence(vertices: Sequence[Evidence], a: int, b: int) -> Optional[Evidence]:
    if a < 0 or b >= len(vertices) or a > b:
        raise ValueError("invalid source arc")
    return meet(vertices[a:b+1])


def canon(e: Optional[Evidence]):
    if e is None:
        return None
    return {
        "provenance": sorted(e.provenance),
        "support": {k: e.support[k] for k in sorted(e.support)},
    }


def main() -> None:
    M = lambda **s: Evidence(frozenset({"measured"}), s)
    I = lambda **s: Evidence(frozenset({"interpolated"}), s)
    U = Evidence(frozenset(), {}, unsupported=True)

    # Independent equivalent of typed contour evidence.
    mixed = meet([
        M(**{"empirical-measured-reliability": 0.91}),
        M(**{"empirical-measured-reliability": 0.78}),
        I(**{"geometric-interpolation-support": 0.62}),
        I(**{"geometric-interpolation-support": 0.44}),
    ])
    assert canon(mixed) == {
        "provenance": ["interpolated", "measured"],
        "support": {
            "empirical-measured-reliability": 0.78,
            "geometric-interpolation-support": 0.44,
        },
    }

    # Unsupported absorption.
    assert meet([M(**{"raw-measured-support": 0.9}), U]) is None

    # Associativity and idempotence.
    a = M(**{"raw-measured-support": 0.8})
    b = I(**{"geometric-interpolation-support": 0.5})
    c = M(**{"raw-measured-support": 0.6})
    left = meet([meet([a, b]), c])
    right = meet([a, meet([b, c])])
    assert canon(left) == canon(right)
    assert canon(meet([a, a])) == canon(a)

    # Complete-source-arc weak interior retention.
    arc = [
        M(**{"empirical-measured-reliability": 0.95}),
        M(**{"empirical-measured-reliability": 0.31}),
        M(**{"empirical-measured-reliability": 0.92}),
    ]
    arc_out = arc_evidence(arc, 0, 2)
    assert arc_out is not None
    assert arc_out.support["empirical-measured-reliability"] == 0.31

    # Cross-semantic M->I arc retains both channels without comparing them.
    mixed_arc = arc_evidence([
        M(**{"empirical-measured-reliability": 0.80}),
        I(**{"geometric-interpolation-support": 0.45}),
    ], 0, 1)
    assert canon(mixed_arc) == {
        "provenance": ["interpolated", "measured"],
        "support": {
            "empirical-measured-reliability": 0.80,
            "geometric-interpolation-support": 0.45,
        },
    }

    # Unsupported source arc cannot produce a supported descendant.
    assert arc_evidence([a, U, c], 0, 2) is None

    # Cross-implementation expectations recorded by the independent TS modules.
    with open("results/typed-evidence-conformance.json", "r", encoding="utf-8") as f:
        ts_typed = json.load(f)
    with open("results/typed-ecdp-conformance.json", "r", encoding="utf-8") as f:
        ts_ecdp = json.load(f)
    ts_mixed = ts_typed["results"][0]
    assert sorted(ts_mixed["provenance"]) == canon(mixed)["provenance"]
    assert ts_mixed["support"] == canon(mixed)["support"]
    ts_weak = ts_ecdp["results"][0]
    assert ts_weak["support"]["empirical-measured-reliability"] == arc_out.support["empirical-measured-reliability"]
    ts_transition = ts_ecdp["results"][1]
    assert sorted(ts_transition["provenance"]) == canon(mixed_arc)["provenance"]
    assert ts_transition["support"] == canon(mixed_arc)["support"]

    result = {
        "schema": "emtrf-independent-python-oracle/1.0",
        "status": "PASS",
        "implementation": "independent Python standard-library oracle",
        "checks": 8,
        "results": {
            "mixed_contour": canon(mixed),
            "unsupported_absorption": True,
            "associativity": True,
            "idempotence": True,
            "weak_interior_arc": canon(arc_out),
            "mixed_semantic_arc": canon(mixed_arc),
            "unsupported_arc_absorbed": True,
            "cross_implementation_match_to_recorded_typescript_results": True,
        },
    }
    print(json.dumps(result, indent=2, sort_keys=True))

if __name__ == "__main__":
    main()
