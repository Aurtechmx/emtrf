# Reproduction guide

Prerequisites: Node 22 (`.nvmrc`), Python 3.11 (`.python-version`), and for the GDAL audit,
GDAL 3.13.1 command-line tools. Install Python deps with `pip install -r requirements.txt`.

One command runs everything:

```bash
./run_all.sh
```

It runs, in order: the operator-contract study, the two Python oracles, the real-data audit
(with SHA-256 check), figure regeneration (including the StREAM DTM input rebuilt from the
crop), the synthetic timing benchmark, and a root manifest check.

Expected key outputs:

- adversarial source-arc promotion 55.2 / 75.6 / 81.1 / 85.2 / 100% (eps 0.02-0.40); EC-DP 0
  at every tolerance; unsupported-gap 970/1000 ordinary vs 0 EC-DP.
- semantic oracle 14/14 (including the applicability/scope/lineage clauses);
  JS<->Python DP/EC-DP differential 2500/2500 exact, max support difference 0.
- Table 3 real-data counts reproduce exactly; `real-data-audit/SHA256SUMS` all pass.

`run_all.sh` attempts the GDAL third-party audit automatically as stage 10/11 when the GDAL
3.13.1 tools are on `PATH`, and reports it as skipped otherwise; the core checks do not depend
on it. To run it alone: `python gdal-audit/thirdparty_gdal_audit.py`. The ablation and benchmark reported values are in `ablation/` and
`benchmarks/`; timing is machine-dependent.
