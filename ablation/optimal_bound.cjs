#!/usr/bin/env node
'use strict';
/**
 * Exact vertex bounds for geometry-only fixes. Rules written before the first run
 * (9 November 2026):
 *  - Input: the strict production feature runs of the four crops, the same as every baseline.
 *  - A span (i, j) is ADMISSIBLE if every source vertex between i and j lies within one source cell
 *    of the line through vertices i and j (the distance rule of the production Douglas-Peucker).
 *  - The fewest retained vertices under a condition on spans is the shortest path from the first to
 *    the last vertex over admissible spans that meet the condition (the min-# formulation).
 *  - Conditions, all with ENDPOINT attribution, i.e. no change to the record:
 *      OPT        none (the fewest vertices any tolerance-respecting subsequence can have);
 *      OPT-SAFE   the endpoint record is not promoted in any channel and loses no provenance class;
 *      OPT-EXACT  every replaced edge has the same provenance and typed support as the span's record
 *                 (the condition SPLIT-0 enforces by cutting).
 *  - Reported per site: retained vertices of DP, OPT, OPT-SAFE, OPT-EXACT and SPLIT-0, and each as a
 *    multiple of DP. EC-DP keeps the DP vertices by construction (1.00).
 */
const fs=require('node:fs');
const path=require('node:path');
const A=require('./reconstruct_ablation.cjs');
const B=require('./baselines.cjs');
const ROOT=path.resolve(__dirname,'..');
const CH=['M','I'];
const key=e=>`${e.provenance}|${e.typed.M}|${e.typed.I}`;
function minVertices(run,tol,cond){
  const V=run.vertices,E=run.edges,n=V.length,best=new Int32Array(n).fill(1e9);best[0]=1;
  for(let i=0;i<n-1;i++){if(best[i]>=1e9)continue;
    // incremental state for spans starting at i
    const mins={M:null,I:null};const prov=new Set();let homog=true;const k0=key(E[i]);
    for(let j=i+1;j<n;j++){
      const e=E[j-1];for(const ch of CH){const v=e.typed[ch];if(v!=null)mins[ch]=mins[ch]==null?v:Math.min(mins[ch],v);}
      for(const p of(e.provenance==='X'?['M','I']:[e.provenance]))prov.add(p);if(key(e)!==k0)homog=false;
      if(cond==='exact'&&!homog)break; // cannot become homogeneous again
      let ok=true;for(let k=i+1;k<j;k++)if(A.lineDistance(V[k],V[i],V[j])>tol){ok=false;break;}
      if(!ok)continue;
      if(cond==='safe'){
        const ends=[E[i],E[j-1]];let safe=true;
        for(const ch of CH){const ev=ends.map(x=>x.typed[ch]).filter(x=>x!=null);if(mins[ch]==null)continue;if(!ev.length||Math.min(...ev)>mins[ch]+1e-12){if(ev.length)safe=false;}}
        if(A.misses(A.unionProv(ends),prov))safe=false;
        if(!safe)continue;
      }
      if(best[i]+1<best[j])best[j]=best[i]+1;
    }}
  if(best[n-1]>=1e9)throw Error('no path');return best[n-1];
}
const sites=[];
for(const spec of A.DATASETS){
  const{runs,tol}=B.featureRuns(spec);const t={source:0,DP:0,OPT:0,'OPT-SAFE':0,'OPT-EXACT':0,'SPLIT-0':0};
  for(const run of runs){t.source+=run.vertices.length;t.DP+=A.dpIndices(run.vertices,tol).length;
    const f=new Set();for(let i=1;i<run.edges.length;i++)if(key(run.edges[i])!==key(run.edges[i-1]))f.add(i);
    t['SPLIT-0']+=B.dpWithForced(run.vertices,f,tol).length;
    t.OPT+=minVertices(run,tol,'none');t['OPT-SAFE']+=minVertices(run,tol,'safe');t['OPT-EXACT']+=minVertices(run,tol,'exact');}
  const r=x=>+(x/t.DP).toFixed(2);
  sites.push({site:spec.label,runs:runs.length,sourceVertices:t.source,retained:{DP:t.DP,OPT:t.OPT,'OPT-SAFE':t['OPT-SAFE'],'OPT-EXACT':t['OPT-EXACT'],'SPLIT-0':t['SPLIT-0']},
    multipleOfDP:{OPT:r(t.OPT),'OPT-SAFE':r(t['OPT-SAFE']),'OPT-EXACT':r(t['OPT-EXACT']),'SPLIT-0':r(t['SPLIT-0']),'EC-DP':1}});
}
fs.writeFileSync(path.join(ROOT,'results','optimal_bound_r1.json'),JSON.stringify({driver:'exact vertex bounds for geometry-only fixes (min-# shortest path)',tolerance:'one source cell',sites},null,1)+'\n');
console.table(sites.map(s=>({site:s.site,src:s.sourceVertices,...s.retained,...Object.fromEntries(Object.entries(s.multipleOfDP).map(([k,v])=>['x'+k,v]))})));
