# oracles/

Independent secondary cross-checks of the typed-evidence algebra and DP/EC-DP, written separately
from the reference study in `../js-study/`.

## Semantic algebra

- `semantic_oracle.py`: 14 algebraic checks of the typed-evidence operations. Eight cover
  provenance and support (provenance union, same-channel meet, unsupported absorption,
  weak-interior retention, associativity, idempotence, channel separation, and
  support-independence of provenance). Six cover applicability, scope and lineage: an
  inapplicable source is ignored; a channel applicable to every required source yields the
  same-channel minimum; a channel applicable to a required source but carrying no value makes
  the output channel **unavailable** rather than computed from the remaining sources; output
  scope is the intersection of the applicable sources' scopes; an empty scope intersection makes
  the channel unavailable; and lineage is the complete union over the source set.
  Run: `python3 semantic_oracle.py`.

The same six clauses are asserted against the *shipped* implementation (not this independent
model) by `../js-study/conformance_checks.cjs`.

## Cross-language DP/EC-DP differential

This is a genuine JavaScript↔Python differential over one shared corpus, not two separate tests
that happen to use the same fixture count. Run the whole thing with:

```bash
bash differential.sh
```

which performs, in order:

1. `make_corpus.mjs` regenerates the corpus and requires **byte identity** with the committed
   `fixtures/differential_2500.jsonl` (2,500 deterministic fixtures, 500 at each of the five
   tolerances; mulberry32 family, coordinates and supports rounded to 9 decimals so both
   languages parse identical decimals);
2. `js_differential.mjs` runs the **shipped** typed EC-DP (`../js-study/reference/compiled/`)
   plus an ordinary DP using the identical clamped-segment distance metric;
3. `dpecdp_differential.py` independently reimplements DP (recursive and iterative-stack) and
   EC-DP in Python and reads the same corpus file. It never calls JavaScript;
4. `compare_differential.py` requires, per fixture, identical ordinary-DP retained indices,
   identical EC-DP retained indices, identical source intervals, and complete-arc support
   agreeing within 1e-15, with exactly 500 fixtures at each tolerance.

Any disagreement exits non-zero. The differential detects retained-index, source-interval and
support disagreement even when ordinary-DP geometry matches; provenance conservation and
unsupported absorption are covered separately by the semantic oracle and the gap experiment in
`../js-study/`.

Both programs exit non-zero on any failure. The author's original reference oracle is
`../js-study/reference/python_emtrf_oracle.py`.
