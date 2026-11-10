#!/usr/bin/env bash
# One-command reproduction. Requires Node 22 and Python 3.11 (see .nvmrc / .python-version /
# requirements.txt). Any failure aborts with a non-zero exit. The real-contour benchmark and the
# 640k synthetic benchmark take ~30-60 s combined; timing is machine-dependent.
set -euo pipefail
cd "$(dirname "$0")"
fail() { echo "FAILED: $1" >&2; exit 1; }

echo "== 1/22 exact-truth conformance checks (Section 4.1, Table 2 finite-state rows) =="
node js-study/conformance_checks.cjs | tail -1 || fail "conformance checks"

echo "== 2/22 adversarial source-arc study + unsupported-gap (Section 4.2, Table 2) =="
bash js-study/reproduce.sh | tail -8 || fail "js-study"
npx --yes tsx js-study/gap_regression.ts || fail "unsupported-gap regression"

echo "== 3/22 independent oracles: semantic algebra + JS<->Python DP/EC-DP differential (Section 4.1) =="
python3 oracles/semantic_oracle.py | tail -1 || fail "semantic oracle"
bash oracles/differential.sh | tail -6 || fail "js<->py differential"

echo "== 4/22 real-data audit (Table 2) =="
( cd real-data-audit && ./reproduce.sh >/dev/null && shasum -a 256 -c SHA256SUMS >/dev/null ) || fail "real-data audit"
echo "  TABLE 2 + SHA256SUMS: pass"

echo "== 5/22 P0-P3 ablation (reconstructed driver; Table 4 / S2) =="
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

echo "== 6/22 alternative-method comparison (DP, boundary vertices, homogeneous splitting, EC-DP) =="
node ablation/baselines.cjs >/dev/null || fail "baselines"
python3 - <<'PYCHK' || fail "baselines (values)"
import json,sys
d=json.load(open("results/baselines_r2.json"));bad=[]
dp_want={"White Sands":(82,20,0),"Estonia Tava":(172,11,13),"StREAM":(54,12,1),"Marsh Island":(186,8,0)}
split0_extra={"White Sands":163,"Estonia Tava":201,"StREAM":120,"Marsh Island":351}
for s in d["sites"]:
    m={x["method"]:x for x in s["methods"]};n=s["label"]
    dp,ec=m["DP"],m["EC-DP"]
    if (dp["spans"],dp["supportPromotionCount"],dp["provenanceLossCount"])!=dp_want[n]: bad.append((n,"DP differs from Table S2"))
    if ec["linesWithGeometryDifferentFromDP"] or ec["extraVerticesVsDP"] or ec["supportPromotionCount"] or ec["provenanceLossCount"] or ec["overstatedLengthPct"]: bad.append((n,"EC-DP not DP-identical / not zero"))
    if m["SPLIT-0"]["supportPromotionCount"] or m["SPLIT-0"]["overstatedLengthPct"]: bad.append((n,"SPLIT-0 promotes"))
    if m["SPLIT-0"]["extraVerticesVsDP"]!=split0_extra[n]: bad.append((n,"SPLIT-0 vertex cost changed"))
    mean=m["DP-MEAN"]
    if mean["extraVerticesVsDP"] or mean["linesWithGeometryDifferentFromDP"] or mean["supportPromotionCount"]<=dp["supportPromotionCount"]: bad.append((n,"length-weighted mean no longer promotes more than endpoints"))
for b in bad: print("  BASELINE MISMATCH:",b,file=sys.stderr)
sys.exit(1 if bad else 0)
PYCHK
echo "  baselines: DP = Table S2; EC-DP keeps DP geometry with zero promotion/loss; exact splitting costs 120-351 vertices; length-weighted mean promotes more than endpoints"

echo "== 7/22 support-profile sensitivity (reference, exponential, kriging, survey) =="
node ablation/support_profiles.cjs >/dev/null || fail "support profiles"
python3 - <<'PYCHK' || fail "support profiles (values)"
import json,sys
rows=json.load(open("results/support_profiles_r3.json"))["rows"];bad=[]
ref={"White Sands":(24.4,93.9),"Estonia Tava":(6.4,100.0),"StREAM":(22.2,100.0),"Marsh Island":(4.3,98.4)}
for r in rows:
    if r["ecdpSupportPromotionPct"] or r["ecdpProvenanceLossPct"]: bad.append((r["profile"],r["site"],"EC-DP nonzero"))
    if r["endpointSupportPromotionPct"]<=0: bad.append((r["profile"],r["site"],"no endpoint promotion"))
    if r["profile"]=="REFERENCE" and (round(r["endpointSupportPromotionPct"],1),round(r["gradeProvenanceLossPct"],1))!=ref[r["site"]]: bad.append((r["site"],"reference differs from paper"))
if len(rows)!=16: bad.append(("row count",len(rows)))
for b in bad: print("  PROFILE MISMATCH:",b,file=sys.stderr)
sys.exit(1 if bad else 0)
PYCHK
echo "  support profiles: reference = paper; endpoint promotion under every profile; EC-DP zero under every profile"

echo "== 8/22 worked example on real data (one traced span; attribute-query task on all sites) =="
node ablation/worked_example.cjs >/dev/null || fail "worked example"
python3 - <<'PYCHK' || fail "worked example (values)"
import json,sys
d=json.load(open("results/worked_example_r2.json"));E=d["example"];bad=[]
if (E["site"],E["levelM"],E["sourceEdges"])!=("White Sands",1238,5): bad.append("selected span changed")
if (E["dpRecord"]["measuredSupport"],E["ecdpRecord"]["measuredSupport"],E["weakestCell"]["returns"])!=(84,7,2): bad.append("span records changed")
if not E["dpRecord"]["passesQuery"] or E["ecdpRecord"]["passesQuery"]: bad.append("query outcome changed")
for s in d["sites"]:
    if s["ecdp"]["falseAcceptM"]: bad.append((s["site"],s["threshold"],"EC-DP false acceptance"))
ws={s["threshold"]:s for s in d["sites"] if s["site"]=="White Sands"}
if ws[66]["dp"]["falseAcceptM"]!=13.77: bad.append("White Sands DP false acceptance changed")
for b in bad: print("  WORKED EXAMPLE MISMATCH:",b,file=sys.stderr)
sys.exit(1 if bad else 0)
PYCHK
echo "  worked example: White Sands 1238 m span reproduced (DP record 84, EC-DP record 7); EC-DP false acceptance zero at every site"

echo "== 9/22 support-profile record (length accounting, composition, scalar bound) =="
node ablation/evidence_profile.cjs >/dev/null || fail "evidence profile"
python3 - <<'PYCHK' || fail "evidence profile (values)"
import json,sys
d=json.load(open("results/evidence_profile_r1.json"));bad=[]
if d["composition"]["mismatches"] or d["composition"]["spanChannelChecks"]<500: bad.append("composition")
if d["scalarBound"]["spansWhereNoUnsafeThresholdExists"] or d["scalarBound"]["spansWithEndpointAboveMinimum"]<=0: bad.append("scalar bound")
for s in d["sites"]:
    for k,v in s["channels"].items():
        if v["profileErrorM"]: bad.append((s["site"],k,"profile error"))
ws=[s for s in d["sites"] if s["site"]=="White Sands"][0]["channels"]["M>=66"]
if (ws["trueLengthM"],ws["minimumUnderstatedM"])!=(52.13,45.97): bad.append("White Sands M>=66 changed")
for b in bad: print("  PROFILE-RECORD MISMATCH:",b,file=sys.stderr)
sys.exit(1 if bad else 0)
PYCHK
echo "  support-profile record: exact length accounting at every site; composition exact; scalar bound holds"

echo "== 10/22 horizontal position uncertainty understated by endpoint records (standard-error profile, slope floor 5 %) =="
node ablation/positional_uncertainty.cjs >/dev/null || fail "positional uncertainty"
python3 - <<'PYCHK' || fail "positional uncertainty (values)"
import json,sys
d=json.load(open("results/positional_uncertainty_r1.json"));bad=[]
want={"White Sands":(56.0,4.16),"Estonia Tava":(32.2,2.65),"StREAM":(40.5,6.37),"Marsh Island":(28.8,2.46)}
for s in d["sites"]:
    if (s["understatedLengthPct"],s["maxFactor"])!=want[s["site"]]: bad.append((s["site"],s["understatedLengthPct"],s["maxFactor"]))
    if s["understatedAboveSlopeFloorPct"] is None or s["understatedAboveSlopeFloorPct"]<=0: bad.append((s["site"],"slope-floor check"))
for b in bad: print("  POSITIONAL MISMATCH:",b,file=sys.stderr)
sys.exit(1 if bad else 0)
PYCHK
echo "  positional uncertainty: endpoint records understate on 28.8-56.0 % of length; holds above the slope floor"

echo "== 11/22 EC-wrap on a non-DP simplifier (Visvalingam-Whyatt; needs the toolchain Python environment) =="
ECWRAP_STATUS="NOT RUN (simplification package unavailable)"
PY=${EMTRF_TOOLCHAIN_PY:-python3}
if "$PY" -c "import simplification" 2>/dev/null; then
  node ablation/export_runs.cjs results/feature_runs.json >/dev/null || fail "export runs"
  "$PY" ablation/ecwrap.py results/feature_runs.json results/ecwrap_vw_r1.json >/dev/null || fail "ecwrap"
  python3 - <<'PYCHK' || fail "ecwrap (values)"
import json,sys
d=json.load(open("results/ecwrap_vw_r1.json"));bad=[]
for s in d["sites"]:
    if s["linesNotSubsequence"] or s["ecwrapPromotion"] or s["ecwrapProvenanceLoss"] or s["endpointPromotion"]<=0: bad.append(s["site"])
for b in bad: print("  ECWRAP MISMATCH:",b,file=sys.stderr)
sys.exit(1 if bad else 0)
PYCHK
  ECWRAP_STATUS="PASS"; echo "  ecwrap: every VW line matched; endpoint attribution promotes, wrapped records do not"
else
  echo "  ecwrap: skipped (install toolchain-audit/requirements.txt and set EMTRF_TOOLCHAIN_PY)"
fi

echo "   11b EC-wrap on QGIS and mapshaper simplifiers; contours and points published by other authors =="
ECTOOLS_STATUS="NOT RUN (toolchain Python, QGIS or mapshaper unavailable)"
EXTERNAL_STATUS="NOT RUN (toolchain Python with scipy unavailable)"
if "$PY" -c "import simplification, scipy" 2>/dev/null; then
  if "$PY" -c "import sys; sys.path.insert(0,'ablation'); import ecwrap_tools as t; sys.exit(1 if t.simplifiers()[2] else 0)" 2>/dev/null; then
    "$PY" ablation/ecwrap_tools.py results/feature_runs.json results/ecwrap_tools_r1.json >/dev/null || fail "ecwrap tools"
    python3 - <<'PYCHK' || fail "ecwrap tools (values)"
import json,sys
d=json.load(open("results/ecwrap_tools_r1.json"));R=d["rows"];bad=[]
if len(R)!=16 or d["toolsNotInstalled"]: bad.append("rows")
if sum(r["spans"] for r in R)!=2117: bad.append("spans")
if any(r["ecwrapPromotion"] or r["ecwrapProvenanceLoss"] for r in R): bad.append("ecwrap records")
p=[r["endpointPromotionPct"] for r in R]; l=[r["endpointProvenanceLossPct"] for r in R]
if (min(p),max(p),min(l),max(l))!=(2.8,32.4,0.0,8.0): bad.append("ranges %s"%((min(p),max(p),min(l),max(l)),))
if sum(r["linesNotSubsequence"] for r in R)!=1: bad.append("unmatched")
for b in bad: print("  ECWRAP TOOLS MISMATCH:",b,file=sys.stderr)
sys.exit(1 if bad else 0)
PYCHK
    ECTOOLS_STATUS="PASS"; echo "  ecwrap tools: endpoint promotion 2.8-32.4 % of spans under four further simplifiers; wrapped records 0"
  else
    echo "  ecwrap tools: skipped (QGIS or mapshaper not found; set QGIS_PROCESS / MAPSHAPER)"
  fi
  "$PY" -I external-audit/external_audit.py >/dev/null || fail "external audit"
  python3 - <<'PYCHK' || fail "external audit (values)"
import json,sys
d=json.load(open("results/external_audit_r1.json"));R={(r["cellSizeM"],r["simplifier"]):r for r in d["rows"]};bad=[]
if d["publishedLines"]!=1015 or d["points"]!=96502: bad.append("inputs")
if any(r["ecwrapPromotion"] or r["ecwrapProvenanceLoss"] or r["linesNotSubsequence"] for r in R.values()): bad.append("ecwrap records")
for k,v in {(5,"Rust DP"):(4474,38.7,34.3),(5,"Rust VW"):(8041,28.1,24.6),(2.5,"Rust DP"):(7984,39.7,32.6),(10,"Rust DP"):(2672,43.8,22.2)}.items():
    r=R.get(k) or R.get((float(k[0]),k[1]))
    if not r or (r["spans"],r["endpointPromotionPct"],r["endpointProvenanceLossPct"])!=v: bad.append(str(k))
if not d["toolsNotInstalled"]:
    P=[r for (c,_),r in R.items() if c==5]
    if len(P)!=6 or sum(r["spans"] for r in P)!=35332 or (min(r["endpointPromotionPct"] for r in P),max(r["endpointPromotionPct"] for r in P))!=(28.0,40.7): bad.append("six simplifiers")
for b in bad: print("  EXTERNAL AUDIT MISMATCH:",b,file=sys.stderr)
sys.exit(1 if bad else 0)
PYCHK
  EXTERNAL_STATUS="PASS$("$PY" -c "import json;m=json.load(open('results/external_audit_r1.json'))['toolsNotInstalled'];print(' (Rust simplifiers only)' if m else '')")"
  echo "  external audit: endpoint attribution promotes on third-party contours; wrapped records do not"
else
  echo "  ecwrap tools / external audit: skipped (install toolchain-audit/requirements.txt and set EMTRF_TOOLCHAIN_PY)"
fi

echo "   11c segment dissolve in GIS tools; raster resampling with GDAL; chords and no-data cells; command-line tool =="
DISSOLVE_STATUS="NOT RUN (toolchain Python with GeoPandas, QGIS or mapshaper unavailable)"
RESAMPLE_STATUS="NOT RUN (GDAL command-line tools or toolchain Python unavailable)"
if "$PY" -c "import geopandas, sys; sys.path.insert(0,'ablation'); import dissolve_tools as d; sys.exit(1 if d.tools()[2] else 0)" 2>/dev/null; then
  "$PY" ablation/dissolve_tools.py results/feature_runs.json results/dissolve_tools_r1.json >/dev/null || fail "dissolve tools"
  python3 - <<'PYCHK' || fail "dissolve tools (values)"
import json,sys
d=json.load(open("results/dissolve_tools_r1.json"));R=d["rows"];bad=[]
if len(R)!=48 or d["toolsNotInstalled"]: bad.append("rows")
D=[r for r in R if r["aggregation"]=="first-value" and r["featureOrder"]=="source"]
M=[r for r in R if r["aggregation"]=="mean" and r["featureOrder"]=="source"]
if sum(r["linesScored"] for r in D)!=4*214 or any(r["linesMissingOrRecordDropped"] for r in R): bad.append("lines")
p=[r["supportPromotionPct"] for r in D]; l=[r["provenanceLossPct"] for r in D]; m=[r["supportPromotionPct"] for r in M]
if (min(p),max(p),min(l),max(l),min(m),max(m))!=(26.2,75.0,5.6,25.0,56.2,92.9): bad.append("ranges %s"%((min(p),max(p),min(l),max(l),min(m),max(m)),))
for b in bad: print("  DISSOLVE MISMATCH:",b,file=sys.stderr)
sys.exit(1 if bad else 0)
PYCHK
  DISSOLVE_STATUS="PASS"; echo "  dissolve: four GIS tools promote support on 26.2-75.0 % of lines"
else
  echo "  dissolve: skipped (needs GeoPandas in EMTRF_TOOLCHAIN_PY, QGIS and mapshaper)"
fi
if command -v gdalwarp >/dev/null 2>&1 && "$PY" -c "import numpy" 2>/dev/null; then
  "$PY" ablation/resample_gdal.py >/dev/null || fail "raster resampling"
  python3 - <<'PYCHK' || fail "raster resampling (values)"
import json,sys
d=json.load(open("results/resample_gdal_r1.json"));R=d["rows"];bad=[]
if not d["blockAlignmentCheck"] or not d["minShowsNoSupportPromotion"]: bad.append("checks")
g=lambda res,k:[r[k] for r in R if r["resampling"]==res and r.get(k) is not None]
got=(min(g("near","supportPromotionPct")),max(g("near","supportPromotionPct")),min(g("average","supportPromotionPct")),max(g("average","supportPromotionPct")),max(g("min","supportPromotion")))
if tuple(round(x,1) for x in got)!=(25.9,71.8,50.9,100.0,0): bad.append("ranges %s"%(got,))
for b in bad: print("  RESAMPLE MISMATCH:",b,file=sys.stderr)
sys.exit(1 if bad else 0)
PYCHK
  RESAMPLE_STATUS="PASS ($(gdalinfo --version | cut -d, -f1))"; echo "  resampling: nearest and average promote support; the minimum does not"
else
  echo "  resampling: skipped (needs gdalwarp and numpy)"
fi
node ablation/chord_mask.cjs >/dev/null 2>&1 || fail "chords over unsupported cells"
python3 - <<'PYCHK' || fail "chords over unsupported cells (values)"
import json,sys
S=json.load(open("results/chord_mask_r1.json"))["sites"]
got=(sum(s["spans"] for s in S if s["unsupportedCellsPct"]>0),sum(s["chordsOverUnsupportedCell"] for s in S),sum(s["spansWithSourceSegmentOverUnsupportedCell"] for s in S))
if got!=(268,0,0): print("  CHORD MASK MISMATCH:",got,file=sys.stderr)
sys.exit(0 if got==(268,0,0) else 1)
PYCHK
echo "  chords: none of 268 one-cell chords passes through an unsupported cell on the two crops that have them"
T=$(mktemp -d)
python3 - "$T" <<'PYCHK' || fail "ecwrap_cli (fixture)"
import json,sys
V=[[0,0],[1,0.1],[2,0],[3,0.1],[4,0]]
E=[("M",90,None),("M",20,None),("X",80,60),("I",None,70)]
f=[{"type":"Feature","properties":{"line_id":7,"seq":k,"prov":p,"m_sup":m,"i_sup":i},"geometry":{"type":"LineString","coordinates":[V[k],V[k+1]]}} for k,(p,m,i) in enumerate(E)]
json.dump({"type":"FeatureCollection","features":f},open(sys.argv[1]+"/edges.geojson","w"))
json.dump({"type":"FeatureCollection","features":[{"type":"Feature","properties":{"line_id":7},"geometry":{"type":"LineString","coordinates":[V[0],V[2],V[4]]}}]},open(sys.argv[1]+"/simp.geojson","w"))
PYCHK
python3 tools/ecwrap_cli.py wrap "$T/edges.geojson" "$T/simp.geojson" "$T/out.geojson" >/dev/null || fail "ecwrap_cli"
python3 - "$T" <<'PYCHK' || fail "ecwrap_cli (values)"
import json,sys
p=[f["properties"] for f in json.load(open(sys.argv[1]+"/out.geojson"))["features"]]
want=[(0,2,"M",20,None),(2,4,"X",80,60)]
got=[(x["src_from"],x["src_to"],x["prov"],x["m_min"],x["i_min"]) for x in p]
if got!=want: print("  ECWRAP_CLI MISMATCH:",got,file=sys.stderr)
sys.exit(0 if got==want else 1)
PYCHK
rm -rf "$T"; echo "  ecwrap_cli: fixture records match"

echo "== 12/22 held-out ground check (half the ground returns build the terrain, half test it; 20 seeds, ~4 min) =="
node ablation/heldout_check.cjs >/dev/null || fail "held-out check"
python3 - <<'PYCHK' || fail "held-out check (values)"
import json,sys
d=json.load(open("results/heldout_check_r1.json"));bad=[]
if d["seeds"]!=20 or len(d["sites"])!=4: bad.append(("shape",d["seeds"],len(d["sites"])))
want={"White Sands":(0.0208,0.0219,0.0261),"Estonia Tava":(0.0472,0.0507),"StREAM":(0.0264,0.0605,0.0871),"Marsh Island":(0.0047,0.009,0.013)}
for s in d["sites"]:
    v=[s[k]["median"] for k in ("rmseMeasuredSolid","rmseMeasuredDashed","rmseMeasuredGap") if s[k]]
    if len(v)<2 or v!=sorted(v) or len(set(v))!=len(v): bad.append((s["site"],"RMSE not ordered by support class",v))
    if want[s["site"]] and tuple(v)!=want[s["site"]]: bad.append((s["site"],"RMSE changed",v))
for b in bad: print("  HELD-OUT MISMATCH:",b,file=sys.stderr)
sys.exit(1 if bad else 0)
PYCHK
echo "  held-out check: terrain error rises as support class falls at all four sites"

echo "== 13/22 fewest vertices for a geometry-only fix (exact search) =="
node ablation/optimal_bound.cjs >/dev/null || fail "optimal bound"
python3 - <<'PYCHK' || fail "optimal bound (values)"
import json,sys
d=json.load(open("results/optimal_bound_r1.json"));bad=[]
gap={"White Sands":0,"Estonia Tava":0,"StREAM":0,"Marsh Island":4}
for s in d["sites"]:
    r=s["retained"];m=s["multipleOfDP"];n=s["site"]
    if not r["OPT"]<=r["DP"]: bad.append((n,"DP below the exact minimum"))
    if not r["OPT"]<=r["OPT-SAFE"]<=r["OPT-EXACT"]<=r["SPLIT-0"]: bad.append((n,"bounds not nested"))
    if r["SPLIT-0"]-r["OPT-EXACT"]!=gap[n]: bad.append((n,"splitting vs exact optimum",r["SPLIT-0"]-r["OPT-EXACT"]))
    if not 0.96<=m["OPT-SAFE"]<=1.09 or not 1.77<=m["OPT-EXACT"]<=2.38: bad.append((n,"multiples out of reported range",m))
for b in bad: print("  OPTIMAL-BOUND MISMATCH:",b,file=sys.stderr)
sys.exit(1 if bad else 0)
PYCHK
echo "  optimal bound: exact records need 1.77-2.38x DP's vertices (splitting is optimal at three sites, four above at one)"

echo "== 14/22 sensitivity of the position-uncertainty result (instrument precision x slope floor) =="
node ablation/positional_sensitivity.cjs >/dev/null || fail "positional sensitivity"
python3 - <<'PYCHK' || fail "positional sensitivity (values)"
import json,sys
d=json.load(open("results/positional_sensitivity_r1.json"));v=[r["understatedLengthPct"] for r in d["rows"]]
ok=len(v)==36 and (min(v),max(v))==(12.2,60.0)
if not ok: print("  SENSITIVITY MISMATCH:",len(v),min(v),max(v),file=sys.stderr)
sys.exit(0 if ok else 1)
PYCHK
echo "  positional sensitivity: understated share stays within 12.2-60.0 % over 36 settings"

echo "== 15/22 scale test on public-agency tiles (needs scale/crops; see scale/README.md) =="
SCALE_STATUS="NOT RUN (scale/crops absent)"
if [ -f scale/crops/index.json ]; then
  node scale/scale_test.cjs >/dev/null || fail "scale test"
  python3 - <<'PYCHK' || fail "scale test (values)"
import json,sys
a=json.load(open("results/scale_test_r1.json"))["all"];p=a["pooled"]
got=(a["tiles"],a["crops"],a["overlap"],a["tooFewReturns"],a["scored"],a["cropsWithPromotion"],p["spans"],p["promoted"],p["ecPromoted"],p["ecProvLoss"],p["split0Promoted"])
want=(18,162,13,20,129,125,32242,9867,0,0,0)
if got!=want: print("  SCALE MISMATCH:",got,want,file=sys.stderr)
sys.exit(0 if got==want else 1)
PYCHK
  SCALE_STATUS="PASS"
  node scale/heldout_scale.cjs >/dev/null 2>&1 || fail "held-out check on scale crops"
  python3 - <<'PYCHK' || fail "held-out check on scale crops (values)"
import json,sys
q=json.load(open("results/heldout_scale_r1.json"))["all"]["medianOverSeeds"]["q2"]
got=(q["spans"],round(q["sharePct"],1),round(q["ciLowPct"],1),round(q["ciHighPct"],1))
if got!=(7048,58.3,56.9,59.6): print("  HELD-OUT SCALE MISMATCH:",got,file=sys.stderr)
sys.exit(0 if got==(7048,58.3,56.9,59.6) else 1)
PYCHK
  echo "  held-out on scale crops: hidden segments have larger error in 58.3 % of 7,048 promoted spans"
  echo "  scale test: promotion in 125 of 129 crops, 9,867 of 32,242 spans; EC-DP none"
else
  echo "  scale test: crops not present, skipped"
fi
PREVALENCE_STATUS="NOT RUN (prevalence/crops absent)"
if [ -f prevalence/crops/index.json ]; then
  node prevalence/score_sample.cjs >/dev/null 2>&1 || fail "3DEP probability sample"
  python3 - <<'PYCHK' || fail "3DEP probability sample (values)"
import json,sys
d=json.load(open("results/prevalence_3dep_r1.json"));P1,P2,A=d["P1"],d["P2"],d["allValidCrops"]
got=(d["unitsTried"],d["validCrops"],P1["cropsWithPromotion"],tuple(P1["wilson95Pct"]),P2["cropsWithAtLeast20Spans"],P2["medianPct"],P2["q1Pct"],P2["q3Pct"],A["spans"],A["ecPromoted"],A["ecProvLoss"])
want=(62,60,59,(91.1,99.7),56,20.6,13.5,33.1,14058,0,0)
if got!=want: print("  PREVALENCE MISMATCH:",got,want,file=sys.stderr)
sys.exit(0 if got==want else 1)
PYCHK
  PREVALENCE_STATUS="PASS"; echo "  3DEP sample: promotion in 59 of 60 randomly drawn work units; EC-DP none"
  node prevalence/query_sample.cjs >/dev/null 2>&1 || fail "query on the 3DEP sample (coverage or accounting)"
  python3 - <<'PYCHK' || fail "query on the 3DEP sample (values)"
import json,sys
d=json.load(open("results/query_sample_r1.json"));c=d["coverage"];s=d["summary"]["66"];P=s["pooled"]
ok=(c["crops"],c["sourceEdges"],c["spans"],c["everyEdgeInExactlyOneSpan"],c["lengthsSum"],c["qualifyingLengthsMatch"])==(60,89071,14058,True,True,True)
got=(s["cropsWithQualifyingLength"],P["endpoint"]["falseAcceptPerKm"],P["ecdp"]["falseAcceptPerKm"],P["endpoint"]["retentionPct"],P["ecdp"]["retentionPct"])
if not ok or got!=(21,20.94,0,65.12,44.61): print("  QUERY SAMPLE MISMATCH:",c,got,file=sys.stderr); sys.exit(1)
PYCHK
  echo "  3DEP query: edges covered once; at 66 endpoint records accept 20.9 m/km failing line, EC-DP none"
else
  echo "  3DEP sample: crops not present, skipped"
fi

echo "== 16/22 polyline-cluster bootstrap (reconstructed driver; Fig 7 intervals) =="
node bootstrap/reconstruct_polyline_bootstrap.cjs | grep -q '"allFrozenRoundedIntervalsMatch": true' || fail "bootstrap"
echo "  bootstrap: frozen intervals reproduced"

echo "== 17/22 figures (regenerate StREAM input from crop, then plots) =="
node data/make_stream_features.cjs >/dev/null || fail "stream features"
for s in make_figures_restyle make_figures_contour_example make_figures_nextlevel make_figure_worked_example; do
  python3 "figures/$s.py" >/dev/null 2>&1 || fail "figure $s"
done
echo "  figures: regenerated"

echo "== 18/22 synthetic EC-DP overhead benchmark (640k vertices, 30 reps) =="
bash benchmarks/reproduce.sh >/dev/null || fail "synthetic benchmark"
echo "  synthetic benchmark: ran (timing machine-dependent)"

echo "== 19/22 real-contour benchmark (289 polylines / 5,305 vertices; reconstructed driver) =="
node benchmarks/reconstruct_real_contour_timing.cjs | grep -q '"polylines": 289' || fail "real-contour benchmark"
echo "  real-contour benchmark: exact corpus identity; timing machine-dependent"

echo "== 20/22 third-party GDAL audit (Section 4.6; needs GDAL 3.13.1) =="
GDAL_STATUS="NOT RUN (GDAL 3.13.1 unavailable)"
if command -v gdal_contour >/dev/null && command -v ogrinfo >/dev/null && command -v ogr2ogr >/dev/null; then
  python3 gdal-audit/thirdparty_gdal_audit.py >/dev/null 2>&1 && GDAL_STATUS="PASS" || fail "GDAL audit"
  echo "  GDAL audit: pass"
else
  echo "  GDAL audit: skipped (GDAL 3.13.1 not in PATH); core checks are independent of it"
fi

echo "== 21/22 third-party toolchains (GDAL, GRASS, SAGA, WhiteboxTools, lidR, SciPy/scikit-image) =="
TOOLCHAIN_STATUS="NOT RUN (GDAL >= 3.11 unavailable)"
if command -v gdal >/dev/null; then
  bash toolchain-audit/reproduce.sh >/dev/null || fail "toolchain audit"
  python3 - <<'PYCHK' || fail "toolchain audit (values)"
import json,sys
d=json.load(open("results/toolchain_audit_r3.json"));bad=[]
chains=[c for c in ("gdal","grass","saga","whitebox","lidr","scipy") if c in d["sites"][0]]
for s in d["sites"]:
    for ch in chains:
        r=s[ch]
        if r["unmatchedSimplifiedLines"] or r["sourceLinesWithoutMatch"]: bad.append((s["site"],ch,"line matching incomplete"))
        if r["edgesWhoseBlockDoesNotBracketLevel"]: bad.append((s["site"],ch,"edge mapped to a block that does not bracket its level"))
        if r["cellsDifferentFromStatedBinningRule"]: bad.append((s["site"],ch,"cell counts not explained by the stated binning rule"))
        if r["endpointPromotion"]<=0: bad.append((s["site"],ch,"no endpoint promotion"))
for b in bad: print("  TOOLCHAIN MISMATCH:",b,file=sys.stderr)
print("  chains run:"," ".join(chains))
sys.exit(1 if bad else 0)
PYCHK
  TOOLCHAIN_STATUS="PASS ($(head -1 results/toolchain_audit_versions.txt | sed 's/chains run: //'))"
  echo "  toolchain audit: endpoint promotion on third-party geometry at every site in every chain run"
else
  echo "  toolchain audit: skipped (needs the gdal CLI >= 3.11; other chains optional); core checks are independent of it"
fi

echo "== 22/22 source manifest check =="
shasum -a 256 -c SHA256SUMS >/dev/null || fail "root SHA256SUMS"
echo "  root SHA256SUMS: all pass"

cat <<EOF

CONFORMANCE CHECKS: PASS
JS STUDY: PASS
SEMANTIC ORACLE: PASS
DP/EC-DP DIFFERENTIAL: PASS
TABLE 2 (real-data audit): PASS
ABLATION: PASS
ALTERNATIVE METHODS: PASS
SUPPORT PROFILES: PASS
WORKED EXAMPLE: PASS
SUPPORT-PROFILE RECORD: PASS
POSITIONAL UNCERTAINTY: PASS
EC-WRAP (VISVALINGAM-WHYATT): ${ECWRAP_STATUS}
EC-WRAP (QGIS, MAPSHAPER): ${ECTOOLS_STATUS}
EXTERNAL AUDIT (THIRD-PARTY CONTOURS): ${EXTERNAL_STATUS}
DISSOLVE (FOUR GIS TOOLS): ${DISSOLVE_STATUS}
RASTER RESAMPLING (GDAL): ${RESAMPLE_STATUS}
EC-WRAP COMMAND-LINE TOOL: PASS
HELD-OUT GROUND CHECK: PASS
FEWEST-VERTEX BOUNDS: PASS
POSITIONAL SENSITIVITY: PASS
SCALE TEST (PUBLIC-AGENCY TILES): ${SCALE_STATUS}
3DEP PROBABILITY SAMPLE: ${PREVALENCE_STATUS}
BOOTSTRAP: PASS
SYNTHETIC BENCHMARK: PASS
REAL-CONTOUR BENCHMARK: PASS
FIGURES: PASS
SHA256: PASS
GDAL THIRD-PARTY AUDIT: ${GDAL_STATUS}
THIRD-PARTY TOOLCHAIN AUDIT: ${TOOLCHAIN_STATUS}
ALL CORE EMTRF REPRODUCIBILITY CHECKS PASSED
EOF
