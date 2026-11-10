#!/usr/bin/env node
'use strict';
/** Writes the strict production feature runs of the four crops (vertices and per-edge typed evidence)
 *  as JSON, so simplifiers in other languages can be wrapped with complete-source evidence (ecwrap). */
const fs=require('node:fs');
const path=require('node:path');
const A=require('./reconstruct_ablation.cjs');
const B=require('./baselines.cjs');
const out=process.argv[2]||path.join(__dirname,'..','results','feature_runs.json');
const sites=A.DATASETS.map(spec=>{
  const{runs,tol}=B.featureRuns(spec);
  return{id:spec.id,label:spec.label,cellSizeM:tol,runs:runs.map(r=>({vertices:r.vertices.map(v=>[v.x,v.y]),
    edges:r.edges.map(e=>({M:e.typed.M,I:e.typed.I,provenance:e.provenance}))}))};
});
fs.writeFileSync(out,JSON.stringify(sites));
console.log(sites.map(s=>`${s.label}: ${s.runs.length} runs`).join('\n'));
