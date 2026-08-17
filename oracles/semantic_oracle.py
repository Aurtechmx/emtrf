#!/usr/bin/env python3
"""Independent semantic oracle for the EMTRF typed-evidence algebra.

This is an independently written reference implementation of the typed-evidence
operations (provenance union, same-channel meet, unsupported absorption) used to
cross-check the JavaScript study. It asserts 14 properties reported in the paper
(Section 4.1): eight provenance/support algebra checks and six applicability, scope,
and lineage contract checks. It exits non-zero if any fails.

No third-party dependencies. Run: python3 semantic_oracle.py
"""
import sys

# ---- Typed evidence primitives -------------------------------------------------
# Provenance is a set of ancestry atoms drawn from {'M','I'}. Mixed == {'M','I'}.
# Support is a dict {channel: value in [0,1]}. 'U' (unsupported) is modelled as the
# Python value None for a required element and is absorbing.

M, I = frozenset({'M'}), frozenset({'I'})


def provenance_union(sources):
    out = frozenset()
    for p in sources:
        out |= p
    return out


def channel_meet(values):
    """Same-channel meet over required source values; None (unsupported) absorbs."""
    if any(v is None for v in values):
        return None            # unsupported absorption
    return min(values)


# ---- Applicability / scope / lineage (contract clauses A and l) -----------------
# A source declares, per channel, whether the channel is APPLICABLE to it and over what
# scope. This is what separates "not applicable to this source" (correctly ignored) from
# "applicable to this source but carrying no value" (output channel unavailable). The
# output is never computed from the remaining sources in the second case.
UNAVAILABLE = 'UNAVAILABLE'


def applicable_channel_meet(sources, channel):
    """sources: list of dicts {'support': {ch: val}, 'applicability': {ch: (bool, scope_or_None)},
    'lineage': [...]}. Returns (value_or_UNAVAILABLE_or_None, scope_or_None).
    None means the channel is absent (no source declares it applicable)."""
    applicable = []
    for s in sources:
        decl = s.get('applicability', {}).get(channel)
        if decl is not None:
            is_app = decl[0]
        elif channel in s.get('unavailable', []):
            # A channel already carried as unavailable stays applicable: it means
            # "applicable to a required source but not reportable", which is distinct from
            # absent and from inapplicable. Otherwise a second operation would reinterpret
            # it as inapplicable and drop it, so a composed chain would refuse less than the
            # equivalent direct meet.
            is_app = True
        else:
            is_app = channel in s.get('support', {})
        if is_app:
            applicable.append(s)
    if not applicable:
        return None, None                       # clause 1: do not invent the channel
    for s in applicable:
        if s.get('support', {}).get(channel) is None:
            return UNAVAILABLE, None            # clause 3: applicable but missing
    terms = None
    for s in applicable:
        decl = s.get('applicability', {}).get(channel)
        declared = decl[1] if decl is not None else None
        if declared is None:
            continue                            # unrestricted: no narrowing
        terms = list(declared) if terms is None else [t for t in terms if t in declared]
    if terms is not None and len(terms) == 0:
        return UNAVAILABLE, None                # clause 5: empty scope intersection
    return min(s['support'][channel] for s in applicable), terms   # clause 2/4


def lineage_union(sources):
    out = set()
    for s in sources:
        out |= set(s.get('lineage', []))
    return sorted(out)                          # clause 6: complete source lineage


# ---- Eight algebraic checks ----------------------------------------------------
def run_checks():
    checks = []

    # 1. Mixed-provenance union: {M} ∪ {I} == mixed (X)
    checks.append(("mixed-provenance union",
                   provenance_union([M, I]) == frozenset({'M', 'I'})))

    # 2. Separation of unlike channels: meet acts per-channel; unlike channels
    #    are never combined into one value.
    src = [{'measured': 0.72, 'interp': 0.41}, {'measured': 0.60, 'interp': 0.90}]
    per_channel = {c: channel_meet([s[c] for s in src]) for c in ('measured', 'interp')}
    checks.append(("separation of unlike channels",
                   per_channel == {'measured': 0.60, 'interp': 0.41}))

    # 3. Same-channel minimum
    checks.append(("same-channel minimum",
                   channel_meet([0.9, 0.3, 0.55]) == 0.3))

    # 4. Unsupported absorption: any required U yields U
    checks.append(("unsupported absorption",
                   channel_meet([0.9, None, 0.4]) is None))

    # 5. Associativity of the meet
    a, b, c = 0.7, 0.2, 0.5
    checks.append(("associativity",
                   channel_meet([channel_meet([a, b]), c])
                   == channel_meet([a, channel_meet([b, c])])))

    # 6. Idempotence
    checks.append(("idempotence", channel_meet([0.42, 0.42]) == 0.42))

    # 7. Weak-interior retention: a weak interior source cannot be hidden by strong
    #    endpoints (this is the endpoint-only failure the contract forbids).
    endpoints_only = channel_meet([0.93, 0.93])         # what endpoint reconstruction sees
    complete_arc = channel_meet([0.93, 0.18, 0.93])     # complete-source meet
    checks.append(("weak-interior retention",
                   complete_arc == 0.18 and complete_arc < endpoints_only))

    # 8. Independence of provenance from support magnitude: two source records with
    #    the SAME ancestry but very different support must yield identical provenance.
    rec_lo = [(M, {'measured': 0.05}), (I, {'interp': 0.10})]
    rec_hi = [(M, {'measured': 0.97}), (I, {'interp': 0.93})]
    prov_lo = provenance_union([p for p, _ in rec_lo])
    prov_hi = provenance_union([p for p, _ in rec_hi])
    checks.append(("provenance independent of support",
                   prov_lo == prov_hi == frozenset({'M', 'I'})))

    # ---- Applicability, scope and lineage clauses (A_i and l_i) -----------------
    # 9. A channel NOT applicable to a source is ignored: the output is the minimum over
    #    the sources it does apply to, not a value invented for the inapplicable source.
    v, _ = applicable_channel_meet([
        {'support': {'model': 0.80}, 'applicability': {'model': (True, None)}},
        {'support': {}, 'applicability': {'model': (False, None)}},
    ], 'model')
    checks.append(("not-applicable source ignored by meet", v == 0.80))

    # 10. A channel applicable to EVERY required source, all values present: same-channel
    #     minimum (the ordinary case).
    v, _ = applicable_channel_meet([
        {'support': {'model': 0.80}, 'applicability': {'model': (True, None)}},
        {'support': {'model': 0.55}, 'applicability': {'model': (True, None)}},
    ], 'model')
    checks.append(("applicable everywhere -> same-channel minimum", v == 0.55))

    # 11. THE distinguishing clause: applicable to a required source but MISSING there.
    #     The output channel must be unavailable, never the 0.80 the other source can supply.
    #     The refusal must also SURVIVE COMPOSITION: feeding that result through a further
    #     meet with an inapplicable source must still be unavailable, never silently dropped
    #     (unavailable != absent != inapplicable). A composed chain must refuse exactly as
    #     much as the equivalent direct meet.
    v, _ = applicable_channel_meet([
        {'support': {'model': 0.80}, 'applicability': {'model': (True, None)}},
        {'support': {}, 'applicability': {'model': (True, None)}},
    ], 'model')
    intermediate = {'support': {}, 'unavailable': ['model']} if v == UNAVAILABLE else {'support': {'model': v}}
    v2, _ = applicable_channel_meet([
        intermediate,
        {'support': {}, 'applicability': {'model': (False, None)}},
    ], 'model')
    direct, _ = applicable_channel_meet([
        {'support': {'model': 0.80}, 'applicability': {'model': (True, None)}},
        {'support': {}, 'applicability': {'model': (True, None)}},
        {'support': {}, 'applicability': {'model': (False, None)}},
    ], 'model')
    checks.append(("applicable-but-missing -> unavailable (and under composition)",
                   v == UNAVAILABLE and v2 == UNAVAILABLE and direct == UNAVAILABLE))

    # 12. Scope does not broaden: the output scope is the intersection of the applicable
    #     sources' declared scopes.
    v, scope = applicable_channel_meet([
        {'support': {'model': 0.70}, 'applicability': {'model': (True, ['bare-earth', 'vegetated'])}},
        {'support': {'model': 0.50}, 'applicability': {'model': (True, ['bare-earth'])}},
    ], 'model')
    checks.append(("scope intersection does not broaden",
                   v == 0.50 and scope == ['bare-earth']))

    # 13. Disjoint scopes leave no scientifically meaningful scope: unavailable.
    v, _ = applicable_channel_meet([
        {'support': {'model': 0.70}, 'applicability': {'model': (True, ['bare-earth'])}},
        {'support': {'model': 0.50}, 'applicability': {'model': (True, ['urban'])}},
    ], 'model')
    checks.append(("empty scope intersection -> unavailable", v == UNAVAILABLE))

    # 14. Lineage is the complete union over the source set (no source dropped).
    checks.append(("lineage union is complete",
                   lineage_union([{'lineage': ['tileB', 'tileA']}, {'lineage': ['tileA', 'tileC']}])
                   == ['tileA', 'tileB', 'tileC']))

    return checks


def main():
    checks = run_checks()
    passed = sum(1 for _, ok in checks if ok)
    for name, ok in checks:
        print(f"  [{'PASS' if ok else 'FAIL'}] {name}")
    print(f"semantic oracle: {passed}/{len(checks)} checks passed")
    sys.exit(0 if passed == len(checks) else 1)


if __name__ == '__main__':
    main()
