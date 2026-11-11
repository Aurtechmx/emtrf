#!/usr/bin/env node
'use strict';
/**
 * Support-profile record.
 *
 * A simplified span carries, besides the complete-source minimum, the fraction of the source
 * length it represents whose measured support is at or above each display threshold (66, 33).
 * Three numbers per channel. The record combines exactly under composition (length-weighted
 * average) and makes every threshold query exact, so it removes the understatement that the
 * minimum rule pays for never overstating.
 *
 * Part 1, length accounting. For each site and threshold t, the well-supported length each record
 * STATES for its spans versus the TRUE well-supported source length inside them:
 *   endpoint  (ordinary DP): states the whole span if min(end records) >= t, else nothing;
 *   minimum   (EC-DP):       states the whole span if the arc minimum >= t, else nothing;
 *   profile:                 states fraction * span length.
 * Part 2, composition. Profiles of two-cell-tolerance spans computed from one-cell spans
 * (length-weighted) must equal profiles computed from the source edges.
 * Part 3, scalar bound. For every DP span, every scalar r > arc minimum admits a threshold t in
 * (min, r] whose query accepts the span although part of it fails; counted as a check.
 */
const fs=require('node:fs');
const path=require('node:path');
const A=require('./reconstruct_ablation.cjs');
const W=require('./worked_example.cjs');
const ROOT=path.resolve(__dirname,'..');
const T=[W.SOLID,33];
const CH=['M','I'];
const r2=x=>Math.round(x*100)/100;

function edgeLen(run,k){const p=run.vertices[k],q=run.vertices[k+1];return Math.hypot(q.x-p.x,q.y-p.y);}
/** Profile of edges a..b-1 of a run for one channel: {length, min, atOrAbove:{t:length}} */
function profile(run,a,b,ch){
  let L=0,min=null;const above={};for(const t of T)above[t]=0;
  for(let k=a;k<b;k++){const v=run.edges[k].typed[ch];if(v==null)continue;const l=edgeLen(run,k);L+=l;min=min==null?v:Math.min(min,v);for(const t of T)if(v>=t)above[t]+=l;}
  return{length:L,min,fraction:Object.fromEntries(T.map(t=>[t,L?above[t]/L:null]))};
}
function merge(ps){const L=ps.reduce((s,p)=>s+p.length,0);return{length:L,min:ps.reduce((m,p)=>p.min==null?m:m==null?p.min:Math.min(m,p.min),null),fraction:Object.fromEntries(T.map(t=>[t,L?ps.reduce((s,p)=>s+(p.fraction[t]==null?0:p.fraction[t]*p.length),0)/L:null]))};}

const sites=[];let scalarChecks=0,scalarViolations=0,edgesChecked=0,applicableMissing=0;let compChecks=0,compMismatch=0;
for(const spec of A.DATASETS){
  const S=W.siteRuns(spec),tol=S.grid.cellSizeM;
  // completeness: a channel that applies to an edge (its provenance includes it) must carry a value
  for(const r of S.runs)for(const e of r.edges){edgesChecked++;const pv=A.unionProv([e]);for(const ch of CH)if(pv.has(ch)&&e.typed[ch]==null)applicableMissing++;}
  const acc={};for(const ch of CH)for(const t of T)acc[`${ch}${t}`]={trueLen:0,endpoint:0,minimum:0,profile:0,endpointOver:0,endpointUnder:0,minimumUnder:0};
  let total=0;
  for(const run of S.runs){
    const keep=A.dpIndices(run.vertices,tol);
    for(let j=0;j<keep.length-1;j++){
      const a=keep[j],b=keep[j+1];const spanLen=Array.from({length:b-a},(_,i)=>edgeLen(run,a+i)).reduce((x,y)=>x+y,0);total+=spanLen;
      for(const ch of CH){
        const pr=profile(run,a,b,ch);if(pr.min==null)continue;
        const ends=[run.edges[a].typed[ch],run.edges[b-1].typed[ch]].filter(x=>x!=null);const ep=Math.min(...ends);
        for(const t of T){
          const o=acc[`${ch}${t}`];const truth=pr.fraction[t]*pr.length;o.trueLen+=truth;
          const e=ep>=t?pr.length:0,m=pr.min>=t?pr.length:0,p=pr.fraction[t]*pr.length;
          o.endpoint+=e;o.minimum+=m;o.profile+=p;
          o.endpointOver+=Math.max(0,e-truth);o.endpointUnder+=Math.max(0,truth-e);o.minimumUnder+=Math.max(0,truth-m);
        }
        // Part 3: any scalar above the arc minimum is unsafe for some threshold.
        if(ep>pr.min){scalarChecks++;const t=(pr.min+ep)/2; // t in (min, ep]: the record accepts, the minimum edge fails
          const anyFail=(()=>{for(let k=a;k<b;k++){const v=run.edges[k].typed[ch];if(v!=null&&v<t)return true;}return false;})();
          if(!(ep>=t&&anyFail))scalarViolations++;}
      }
    }
    // Part 2: composition. Two-cell spans vs merged one-cell spans.
    const keep2=A.dpIndices(run.vertices,2*tol);
    for(let j=0;j<keep2.length-1;j++){
      const a=keep2[j],b=keep2[j+1];const inner=keep.filter(i=>i>=a&&i<=b);
      if(inner[0]!==a||inner.at(-1)!==b)continue; // two-cell retained set is not a subset of the one-cell set here; skip
      for(const ch of CH){
        const direct=profile(run,a,b,ch);const parts=[];for(let q=0;q<inner.length-1;q++)parts.push(profile(run,inner[q],inner[q+1],ch));
        const m=merge(parts);compChecks++;
        for(const t of T){const d=direct.fraction[t],e=m.fraction[t];if(!((d==null&&e==null)||Math.abs(d-e)<1e-9))compMismatch++;}
        if(!((direct.min==null&&m.min==null)||direct.min===m.min))compMismatch++;
      }
    }
  }
  const row={site:spec.label,contourLengthM:r2(total),channels:{}};
  for(const ch of CH)for(const t of T){const o=acc[`${ch}${t}`];row.channels[`${ch}>=${t}`]={trueLengthM:r2(o.trueLen),statedEndpointM:r2(o.endpoint),statedMinimumM:r2(o.minimum),statedProfileM:r2(o.profile),endpointOverstatedM:r2(o.endpointOver),endpointUnderstatedM:r2(o.endpointUnder),minimumUnderstatedM:r2(o.minimumUnder),profileErrorM:r2(Math.abs(o.profile-o.trueLen))};}
  sites.push(row);
}
const out={driver:'support-profile record (length accounting, composition, scalar bound)',thresholds:T,sites,
  scalarBound:{spansWithEndpointAboveMinimum:scalarChecks,spansWhereNoUnsafeThresholdExists:scalarViolations},
  composition:{spanChannelChecks:compChecks,mismatches:compMismatch},
  completeness:{edges:edgesChecked,applicableChannelValuesMissing:applicableMissing}};
fs.writeFileSync(path.join(ROOT,'results','evidence_profile_r1.json'),JSON.stringify(out,null,1)+'\n');
const csv=['site,channel_threshold,true_length_m,stated_endpoint_m,stated_minimum_m,stated_profile_m,endpoint_overstated_m,endpoint_understated_m,minimum_understated_m,profile_error_m'];
for(const s of sites)for(const[k,v]of Object.entries(s.channels))csv.push([s.site,k,v.trueLengthM,v.statedEndpointM,v.statedMinimumM,v.statedProfileM,v.endpointOverstatedM,v.endpointUnderstatedM,v.minimumUnderstatedM,v.profileErrorM].join(','));
fs.writeFileSync(path.join(__dirname,'evidence_profile_site_results.csv'),csv.join('\n')+'\n');
console.log(csv.join('\n'));console.log(JSON.stringify(out.scalarBound),JSON.stringify(out.composition));
