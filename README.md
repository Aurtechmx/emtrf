# EMTRF: Evidence-Monotone Terrain Representation Framework

Author: A. Urias ([ORCID 0009-0007-3147-323X](https://orcid.org/0009-0007-3147-323X)), Aurtech, Hermosillo, Sonora, Mexico.


Reference implementation and reproducibility package for the paper *Evidence-Monotone Terrain
Representation Framework (EMTRF): A provenance-conserving operator contract for derived terrain
geometry* (submitted to *Computers & Geosciences*).

EMTRF is an operator contract that carries provenance, typed support, applicability, and
complete-source lineage through representation-only terrain transformations (contour extraction,
stitching, smoothing, simplification, export), so a derived segment cannot report stronger or
different evidence than the complete source arc it replaces. Evidence-Constrained Douglas–Peucker
(EC-DP) keeps ordinary Douglas–Peucker geometry but inherits evidence from that complete arc.

The repository is self-contained and does not require OpenLiDARViewer (OLV). Every reported
mechanism rate and oracle result reproduces exactly from the artifacts here; the timing
benchmarks rerun on the same frozen corpora, but exact runtimes are machine-dependent. OLV appears
in the paper only as a separate real-terrain audit environment (see [OLV anchor](#audited-olv-anchor)).


> **Table numbering.** The manuscript's Tables 2, 3 and 4 are the finite-state, real-data
> audit and ablation results. Two files keep legacy names from an earlier draft numbering:
> `real-data-audit/run_table6.cjs` and its recorded `results/reproduction_stdout.txt` header
> both refer to the audit now published as **Table 3**. The filenames are retained so the
> archived SHA256 manifests stay verifiable.

## Repository layout

| Path | Contents | Paper reference |
|---|---|---|
| `js-study/conformance_checks.cjs` | Exact-truth conformance checks (Table 2 finite-state rows): measured support, interpolation sequence, 256 directional patterns, closed-ring invariance. | §4.1 |
| `js-study/` | Standalone JavaScript operator-contract study: reference support functions, directional classifier, ordinary DP, EC-DP, deterministic fixture generation (exhaustive finite-state + 10,000 adversarial polylines), unsupported-gap and closed-ring fixtures, timing harness. | §3, §4.1–4.3 |
| `oracles/` | `semantic_oracle.py` (typed-evidence algebra, 14 checks including the applicability/scope/lineage clauses) and a JavaScript↔Python DP/EC-DP differential over a shared frozen corpus (`fixtures/differential_2500.jsonl`): `make_corpus.mjs` freezes 2,500 fixtures, `js_differential.mjs` (shipped EC-DP) and `dpecdp_differential.py` (independent Python reimplementation) run on it, and `compare_differential.py` asserts identical indices/intervals and support within 1e-15. Run all of it via `differential.sh`. | §3.4, §4.1 |
| `real-data-audit/` | Real-data provenance/source-arc audit: Node harness (`run_table6.cjs`, `reproduce.sh`), four frozen public contour crops, production terrain/contour modules, raw outputs, `SHA256SUMS`. | Table 3, §4.7 |
| `gdal-audit/` | Third-party generalizer audit on `gdal_contour` geometry (`thirdparty_gdal_audit.py`, GDAL 3.13.1, no author code in the contour-extraction path). | §4.6 |
| `ablation/` | Four-pipeline (P0–P3) evidence ablation: runnable driver + per-site records (Table 4, Supplementary Table S2). | §4.8 |
| `bootstrap/` | Deterministic 10,000-replicate polyline-cluster bootstrap driver (Figure 7 intervals). | §4.7 |
| `benchmarks/` | Synthetic EC-DP overhead benchmark (640k vertices, 30 reps) and the real-contour benchmark driver (289 polylines / 5,305 vertices). | §4.3 |
| `figures/` | Figure-generation scripts (repo-root-relative paths). | Figs. 1–9, S1 |
| `data/` | Derived inputs used by figures (e.g. `stream_features.json`). | — |

## Requirements

- Node.js 22, pinned in `.nvmrc` (the JS study uses `--experimental-strip-types`, stable in Node 22; no `npm install` needed).
- Python 3.11 with numpy, matplotlib, and seaborn (`pip install -r requirements.txt`).
- GDAL 3.13.1 command-line tools (`gdal_contour`, `ogrinfo`, `ogr2ogr`) for the GDAL audit.

## Reproduce

Run everything with one command (see `docs/REPRODUCE.md` for details and `docs/USER_GUIDE.md`
for inputs, outputs, and expected behavior):

```bash
pip install -r requirements.txt
./run_all.sh
```

This runs the operator-contract study, the two Python oracles, the real-data audit (with SHA-256
check), figure regeneration (rebuilding the StREAM DTM input from the crop), the timing
benchmark, and a root manifest check. Each step exits non-zero on any mismatch. The GDAL audit
runs automatically as stage 10/11 when GDAL 3.13.1 is on `PATH`, and is reported as skipped
otherwise; to run it alone: `python gdal-audit/thirdparty_gdal_audit.py`.

Individual steps:

```bash
cd real-data-audit && ./reproduce.sh && shasum -a 256 -c SHA256SUMS   # Table 3
cd ../js-study && bash reproduce.sh                                    # adversarial stress + gap
cd ../oracles && python semantic_oracle.py && bash differential.sh     # algebra + JS<->Py differential
```

Repository integrity: `shasum -a 256 -c SHA256SUMS` at the root checks all committed source
files; `real-data-audit/SHA256SUMS` checks the audit bundle (both pass after a fresh rerun).

## Source identities

Two distinct source identities are used, and they are not the same code.

**A. Production-source falsification (the grade-to-provenance export defect).** The paper audits
the OpenLiDARViewer application release:

- repository: <https://github.com/Aurtechmx/openlidarviewer>
- audited release: v0.6.5, git commit `4fb00a784d860a2e24cc1834d6c1230dac550355`
- Zenodo concept DOI `10.5281/zenodo.21544619`; version DOI `10.5281/zenodo.21933671`
- source-archive SHA-256 `fdb510e3416fb0cb02c71031bb7f653b8e0dde83ae9916c85d1c44e844b122fa`

**B. Field-derived EMTRF audit (Table 3).** The terrain/contour modules under `real-data-audit/`
are a frozen study-local snapshot, identified by their own per-file SHA-256 in
`real-data-audit/SHA256SUMS`. They are **not** byte-identical to the v0.6.5 application release:
the snapshot uses a hardened `cellConfidence` that leaves otherwise-unreachable voids unsupported
unless a bounded fallback is authorized, whereas the release fills such voids by nearest support.
That difference changes the supported terrain domain and the downstream contour population, so
Table 3 is reproducible from this frozen snapshot rather than from the release modules. The
production-source defect audited in (A) is independent of this and is reproducible against the
release.

## License

MIT license; see [`LICENSE`](LICENSE). Code comments and documentation are in English.

## Citation

Archived release: version DOI [10.5281/zenodo.22134284](https://doi.org/10.5281/zenodo.22134284)
(`v1.1.1`, git commit `ffa6a07b746858457b4a07c9e3d26e7db2dce05f`); concept DOI
[10.5281/zenodo.21992294](https://doi.org/10.5281/zenodo.21992294) always resolves to the latest
version. See [`CITATION.cff`](CITATION.cff).
