#!/usr/bin/env bash
# Reproduce the adversarial source-arc stress + gap results (Section 4.2, Table 4).
# Node >= 22 (uses --experimental-strip-types). Deterministic mulberry32 seeds.
# The fresh run is asserted field-by-field against expected/stress_results.json;
# any deviation in a segment count, promotion count, promotion rate, or gap-bridge
# count exits non-zero.
set -euo pipefail
cd "$(dirname "$0")"
tmp="$(mktemp -d)"
cp reference/typedEvidenceOperators.ts reference/evidenceConstrainedGeneralizeTyped.ts \
   experiments/source-arc-stress/stressBenchmark.ts "$tmp/"
# node type-stripping needs explicit .ts on relative imports
perl -0pi -e "s/(from '\.\/[A-Za-z0-9_]+)'/\$1.ts'/g" "$tmp"/*.ts
mkdir -p results
node --experimental-strip-types "$tmp/stressBenchmark.ts" \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const o=JSON.parse(s);
      for(const r of o.results){delete r.ordinary.runtime_ms;delete r.ecdp.runtime_ms;delete r.fixture_generation_ms;}
      delete o.environment;process.stdout.write(JSON.stringify(o,null,2)+"\n");})' \
  > results/stress_results.json
rm -rf "$tmp"

# ---- assert the deterministic fields against the frozen expected values -------
node -e '
const fs=require("fs");
const got=JSON.parse(fs.readFileSync("results/stress_results.json"));
const exp=JSON.parse(fs.readFileSync("expected/stress_results.json"));
const fail=[];
const rate=x=>Number(x).toFixed(12);   // compare rates at 1e-12, counts exactly
if(got.results.length!==exp.results.length) fail.push(`result count ${got.results.length} != ${exp.results.length}`);
for(const e of exp.results){
  const g=got.results.find(r=>r.tolerance===e.tolerance);
  if(!g){fail.push(`missing tolerance ${e.tolerance}`);continue;}
  for(const side of ["ordinary","ecdp"]){
    for(const k of ["segments","promotion_violations"])
      if(g[side][k]!==e[side][k]) fail.push(`eps=${e.tolerance} ${side}.${k} ${g[side][k]} != ${e[side][k]}`);
    if(rate(g[side].promotion_rate)!==rate(e[side].promotion_rate))
      fail.push(`eps=${e.tolerance} ${side}.promotion_rate ${g[side].promotion_rate} != ${e[side].promotion_rate}`);
  }
  if(g.ecdp.geometry_mismatches!==e.ecdp.geometry_mismatches)
    fail.push(`eps=${e.tolerance} ecdp.geometry_mismatches ${g.ecdp.geometry_mismatches} != ${e.ecdp.geometry_mismatches}`);
  if(g.ecdp.geometry_mismatches!==0)
    fail.push(`eps=${e.tolerance} ecdp.geometry_mismatches must be 0, got ${g.ecdp.geometry_mismatches}`);
}
const gk=["fixtures","ordinary_dp_segments_bridging_unsupported_vertex","ecdp_segments_bridging_unsupported_vertex"];
for(const k of gk) if(got.gap_stress[k]!==exp.gap_stress[k])
  fail.push(`gap_stress.${k} ${got.gap_stress[k]} != ${exp.gap_stress[k]}`);
if(fail.length){console.error("stress reproduction: FAIL");for(const f of fail)console.error("  - "+f);process.exit(1);}
console.log("stress reproduction: PASS (all deterministic fields match expected/stress_results.json)");
'

python3 - <<'PY'
import json
d=json.load(open("results/stress_results.json"))
print("Adversarial source-arc stress (deterministic):")
for r in d["results"]:
    o,e=r["ordinary"],r["ecdp"]
    print(f"  eps={r['tolerance']:<4} endpoint-only {o['promotion_violations']}/{o['segments']} "
          f"({100*o['promotion_rate']:.1f}%)  EC-DP {e['promotion_violations']} ({100*e['promotion_rate']:.1f}%)  "
          f"geom-mismatch {e['geometry_mismatches']}")
g=d["gap_stress"]
print(f"  gap: ordinary {g['ordinary_dp_segments_bridging_unsupported_vertex']}/{g['fixtures']} bridges, "
      f"EC-DP {g['ecdp_segments_bridging_unsupported_vertex']}")
PY
