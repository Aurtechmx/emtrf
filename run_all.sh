#!/usr/bin/env bash
# One-command reproduction. Requires Node 22 and Python 3.11 (see .nvmrc / .python-version /
# requirements.txt). Any failure aborts with a non-zero exit. The real-contour benchmark and the
# 640k synthetic benchmark take ~30-60 s combined; timing is machine-dependent.
set -euo pipefail
cd "$(dirname "$0")"
fail() { echo "FAILED: $1" >&2; exit 1; }

echo "== 1/11 exact-truth conformance checks (Section 4.1, Table 2 finite-state rows) =="
node js-study/conformance_checks.cjs | tail -1 || fail "conformance checks"

echo "== 2/11 adversarial source-arc study + unsupported-gap (Section 4.2, Table 2) =="
bash js-study/reproduce.sh | tail -8 || fail "js-study"
npx --yes tsx js-study/gap_regression.ts || fail "unsupported-gap regression"

echo "== 3/11 independent oracles: semantic algebra + JS<->Python DP/EC-DP differential (Section 4.1) =="
python3 oracles/semantic_oracle.py | tail -1 || fail "semantic oracle"
bash oracles/differential.sh | tail -6 || fail "js<->py differential"

echo "== 4/11 real-data audit (Table 3) =="
( cd real-data-audit && ./reproduce.sh >/dev/null && shasum -a 256 -c SHA256SUMS >/dev/null ) || fail "real-data audit"
echo "  TABLE 3 + SHA256SUMS: pass"

echo "== 5/11 P0-P3 ablation (reconstructed driver; Table 4 / S2) =="
# The paper reports STRICT mode: every eligible span retained, no result-defined exclusion.
node ablation/reconstruct_ablation.cjs --strict > /tmp/emtrf_ablation_strict.json || fail "ablation (strict)"
python3 - <<'PYCHK' || fail "ablation (strict values)"
import json,sys
t=open("/tmp/emtrf_ablation_strict.json").read(); d=json.loads(t[t.find("{"):])
def rows(o,a=None):
    a=[] if a is None else a
    if isinstance(o,dict):
        if "frozenTarget" in o: a.append(o)
        for v in o.values(): rows(v,a)
    elif isinstance(o,list):
        for v in o: rows(v,a)
    return a
want={"White Sands":(82,20,77),"Estonia Tava":(172,11,172),"StREAM":(54,12,54),"Marsh Island":(186,8,183)}
bad=[]; seen=set()
for r in rows(d):
    n=r["label"]
    if n not in want: continue
    seen.add(n)
    got=(r["spans"],r["supportPromotionCount"],r["gradeProvenanceLossCount"])
    if got!=want[n]: bad.append((n,got,want[n]))
    if r["p2SupportPromotionCount"] or r["p3SupportPromotionCount"] or r["p3ProvenanceLossCount"]:
        bad.append((n,"P2/P3 nonzero",0))
missing=set(want)-seen
if missing: bad.append(("unmatched sites",sorted(missing),""))
for b in bad: print("  ABLATION MISMATCH:",b,file=sys.stderr)
sys.exit(1 if bad else 0)
PYCHK
echo "  ablation (strict): S2 values reproduced; P2/P3 zero"
# Archive-compatible mode is retained only as a cross-check against the 2026 archived run.
node ablation/reconstruct_ablation.cjs | grep -q '"allFrozenEventCountsMatch": true' || fail "ablation (archive cross-check)"
echo "  ablation (archive cross-check): 2026 frozen counts still reproduce"

echo "== 6/11 polyline-cluster bootstrap (reconstructed driver; Fig 7 intervals) =="
node bootstrap/reconstruct_polyline_bootstrap.cjs | grep -q '"allFrozenRoundedIntervalsMatch": true' || fail "bootstrap"
echo "  bootstrap: frozen intervals reproduced"

echo "== 7/11 figures (regenerate StREAM input from crop, then plots) =="
node data/make_stream_features.cjs >/dev/null || fail "stream features"
for s in make_figures_restyle make_figures_contour_example make_figures_nextlevel; do
  python3 "figures/$s.py" >/dev/null 2>&1 || fail "figure $s"
done
echo "  figures: regenerated"

echo "== 8/11 synthetic EC-DP overhead benchmark (640k vertices, 30 reps) =="
bash benchmarks/reproduce.sh >/dev/null || fail "synthetic benchmark"
echo "  synthetic benchmark: ran (timing machine-dependent)"

echo "== 9/11 real-contour benchmark (289 polylines / 5,305 vertices; reconstructed driver) =="
node benchmarks/reconstruct_real_contour_timing.cjs | grep -q '"polylines": 289' || fail "real-contour benchmark"
echo "  real-contour benchmark: exact corpus identity; timing machine-dependent"

echo "== 10/11 third-party GDAL audit (Section 4.6; needs GDAL 3.13.1) =="
GDAL_STATUS="NOT RUN (GDAL 3.13.1 unavailable)"
if command -v gdal_contour >/dev/null && command -v ogrinfo >/dev/null && command -v ogr2ogr >/dev/null; then
  python3 gdal-audit/thirdparty_gdal_audit.py >/dev/null 2>&1 && GDAL_STATUS="PASS" || fail "GDAL audit"
  echo "  GDAL audit: pass"
else
  echo "  GDAL audit: skipped (GDAL 3.13.1 not in PATH); core checks are independent of it"
fi

echo "== 11/11 source manifest check =="
shasum -a 256 -c SHA256SUMS >/dev/null || fail "root SHA256SUMS"
echo "  root SHA256SUMS: all pass"

cat <<EOF

CONFORMANCE CHECKS: PASS
JS STUDY: PASS
SEMANTIC ORACLE: PASS
DP/EC-DP DIFFERENTIAL: PASS
TABLE 3 (real-data audit): PASS
ABLATION: PASS
BOOTSTRAP: PASS
SYNTHETIC BENCHMARK: PASS
REAL-CONTOUR BENCHMARK: PASS
FIGURES: PASS
SHA256: PASS
GDAL THIRD-PARTY AUDIT: ${GDAL_STATUS}
ALL CORE EMTRF REPRODUCIBILITY CHECKS PASSED
EOF
