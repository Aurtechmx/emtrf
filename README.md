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
rate and check reproduces exactly from the artifacts here; the timing benchmarks rerun on the
same frozen corpora, but exact runtimes are machine-dependent. OLV appears in the paper only as
a separate audit environment (see [Source identities](#source-identities)).

> **Numbering.** Section, table and figure numbers below are those of the current manuscript.
> The frozen `real-data-audit/` bundle keeps the labels of earlier drafts (`run_table6.cjs`,
> "Table 3" in its README) and `data/fig8_derivation/` keeps its directory name; these refer to
> what are now **Table 2** and **Figure 6**. They are left unchanged so the bundle's own SHA256
> manifest stays verifiable.

## Repository layout

| Path | Contents | Paper reference |
|---|---|---|
| `js-study/` | Standalone JavaScript study: reference support functions, directional classifier, ordinary DP, EC-DP, deterministic fixtures (10,000 adversarial lines, unsupported-gap and closed-ring cases), conformance checks (`conformance_checks.cjs`), timing harness. | §4.2–4.3, §5.1–5.2, Supplementary Table S10 |
| `oracles/` | The two independent Python checks: `semantic_oracle.py` (evidence rules, 14 assertions) and a JavaScript↔Python DP/EC-DP comparison over 2,500 frozen fixtures (`differential.sh`; identical indices and intervals, support within 1e-15). | §4.2, §5.1 |
| `real-data-audit/` | Real-data audit: Node harness (`run_table6.cjs`, `reproduce.sh`), four frozen public LiDAR crops, frozen terrain and contour modules, raw outputs, `SHA256SUMS`. | Table 2, §4.4, §5.3 |
| `ablation/` | Alternative methods and P0–P3 ablation, support-function sensitivity, worked example and attribute query, support profile, position uncertainty, held-out ground check, fewest-vertex bounds, EC-wrap (see `ablation/README.md`). | Table 3, §4.5–4.6, §4.8, §5.4–5.5, §5.7, Supplementary Methods S7–S8, S10, S12–S13, S15–S17 |
| `toolchain-audit/` | Six third-party open-source toolchains (GDAL, GRASS, SAGA, WhiteboxTools, lidR, SciPy/scikit-image) rebuilding DTM, contours and simplification from the same returns (`reproduce.sh`). | Table 4, §4.7, §5.6, Supplementary Methods S9 |
| `external-audit/` | Contours and LiDAR points published by other authors (Zenodo 10.5281/zenodo.12771247, CC0), evidence assigned by a rule fixed beforehand, six simplifiers through EC-wrap (`external_audit.py`; rules in `PREREGISTRATION.md`). | §5.6, Supplementary Methods S19 |
| `tools/` | `ecwrap_cli.py`: attach complete-source records to lines simplified by any tool (QGIS, GDAL/OGR, mapshaper, GRASS); Python standard library only; usage in its header. | §2.4 |
| `prevalence/` | Probability sample of 60 USGS 3DEP work units, one 100 m crop each (`draw_sample.py` fetches the crops with PDAL; `score_sample.cjs` scores them; `query_sample.cjs` runs the attribute query on them; rules in `docs/RULES_ADDITIONAL_TESTS.md`, D4 and D5; the 60 crops are in `prevalence/crops/`). | §5.3, §5.7, Supplementary Methods S22, S23 |
| `scale/` | Scale test: 129 crops cut by a fixed rule from 18 public-agency tiles (`extract_crops.py`, `scale_test.cjs`; rules in `scale/README.md`; crops not in the repository). | §5.4, Supplementary Methods S18 |
| `source-audit/` | Source-level audit record of the OLV v0.6.5 export path. | §4.7, §5.6, Supplementary source audit |
| `external-check/` | The 104 independent RTK checkpoints of the Marsh Island release and the driver that compares their errors with cell support (rules D10). | §5.3, Supplementary Methods S26 |
| `gdal-audit/` | First-submission audit on `gdal_contour` geometry from a synthetic surface (`thirdparty_gdal_audit.py`, GDAL 3.13.1). | Supplementary Note N3 |
| `bootstrap/` | Deterministic 10,000-replicate bootstrap over whole contour lines. | Figure 5, §4.4 |
| `benchmarks/` | Synthetic overhead benchmark (640,000 vertices, 30 repetitions) and the real-contour benchmark (289 lines, 5,305 vertices). | §4.9, §5.8 |
| `figures/` | Figure-generation scripts (repo-root-relative paths). | Figures 1–8, S1–S3 |
| `supplementary/` | Generator for Supplementary Methods S15–S18 tables; Figure S1. | Supplementary Material |
| `data/` | Derived inputs used by figures (e.g. `stream_features.json`). | — |

## Requirements

- Node.js 22, pinned in `.nvmrc` (the JS study uses `--experimental-strip-types`, stable in Node 22; no `npm install` needed).
- Python 3.11 with numpy, matplotlib, and seaborn (`pip install -r requirements.txt`).
- GDAL 3.13.1 command-line tools (`gdal_contour`, `ogrinfo`, `ogr2ogr`) for the GDAL audit.
- Optional, for EC-wrap on further simplifiers and the external audit: QGIS 3.40 (`qgis_process`) and mapshaper 0.6.102
  (`QGIS_PROCESS` and `MAPSHAPER` override the lookup).
- Optional, for the six-toolchain audit: the tools and versions listed in `toolchain-audit/README.md`, with
  `EMTRF_TOOLCHAIN_PY` pointing at a Python that has `toolchain-audit/requirements.txt` installed.

## Reproduce

Run everything with one command (see `docs/REPRODUCE.md` for details and `docs/USER_GUIDE.md`
for inputs, outputs, and expected behavior):

```bash
pip install -r requirements.txt
./run_all.sh
```

This runs 22 steps: the JavaScript study, the two Python checks, the real-data audit (with SHA-256
check), the alternative-method, sensitivity, worked-example and bound drivers, figure regeneration,
the timing benchmark, and a root manifest check. Each step exits non-zero on any mismatch. The GDAL
audit, the six-toolchain audit and the scale test run when their tools or inputs are present and are
reported as not run otherwise.

Individual steps:

```bash
cd real-data-audit && ./reproduce.sh && shasum -a 256 -c SHA256SUMS   # Table 2
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

**B. Field-derived EMTRF audit (Table 2).** The terrain/contour modules under `real-data-audit/`
are a frozen study-local snapshot, identified by their own per-file SHA-256 in
`real-data-audit/SHA256SUMS`. They are **not** byte-identical to the v0.6.5 application release:
the snapshot uses a hardened `cellConfidence` that leaves otherwise-unreachable voids unsupported
unless a bounded fallback is authorized, whereas the release fills such voids by nearest support.
That difference changes the supported terrain domain and the downstream contour population, so
Table 2 is reproducible from this frozen snapshot rather than from the release modules. The
production-source defect audited in (A) is independent of this and is reproducible against the
release.

## License

MIT license; see [`LICENSE`](LICENSE). The Supplement source and PDF in this package are covered by the same licence; the version published with the article is governed by the journal's terms. Third-party data keep their own licences ([`DATA_LICENSES.md`](DATA_LICENSES.md)). The audit scripts run GDAL, GRASS GIS, SAGA GIS, WhiteboxTools, lidR, SciPy, scikit-image, QGIS, GeoPandas and mapshaper as separate programs; none is bundled, and each keeps its own licence. Code comments and documentation are in English.

## Citation

Archived on Zenodo under concept DOI [10.5281/zenodo.21992294](https://doi.org/10.5281/zenodo.21992294), which resolves to the latest version. Each tagged release has its own version DOI; see the repository Releases and [`CITATION.cff`](CITATION.cff).
