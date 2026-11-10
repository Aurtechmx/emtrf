#!/usr/bin/env node
'use strict';
/**
 * Consequence in metres. Pre-registered rules, written before the run:
 *  - vertical standard error per cell as in the standard-error profile of support_profiles.cjs
 *    (measured: sqrt((s_z^2 + 0.05^2)/n); interpolated: sqrt(se_med^2 + (0.05 d L)^2));
 *  - horizontal position uncertainty of a contour through a 2x2 block: u = se / slope, with slope the
 *    magnitude of the block's bilinear gradient, floored at 0.05 m/m (5 %) so flat ground does not
 *    produce unbounded values; se is the largest se among the block's four cells;
 *  - an edge's u is the u of its block; a DP span's TRUE u is the largest u over the edges it replaces;
 *    the ENDPOINT record's u is the larger of its two end edges; EC-DP's is the true value.
 * Reports, per site: share of span length whose endpoint record understates u, and the median and
 * maximum understatement in metres and as a factor, over spans where it occurs.
 */
const fs=require('node:fs');
const path=require('node:path');
const A=require('./reconstruct_ablation.cjs');
const W=require('./worked_example.cjs');
const {rasterizeDtm}=require('../real-data-audit/dist/src/terrain/ground/rasterizeDtm.js');
const {buildDtmGrid}=require('../real-data-audit/dist/src/terrain/ground/cellConfidence.js');
const ROOT=path.resolve(__dirname,'..');
const INST=0.05,SLOPE_FLOOR=0.05,IDW_SLOPE=0.05;

function cellSE(dtm,points,grid){
  const{cols,rows,cellSizeM,originH1,originH2}=grid,lists=new Array(cols*rows);
  for(const p of points){const fx=(p.x-originH1)/cellSizeM,fy=(p.y-originH2)/cellSizeM;if(fx<-1e-6||fx>cols+1e-6||fy<-1e-6||fy>rows+1e-6)continue;
    const c=Math.min(rows-1,Math.max(0,Math.floor(fy)))*cols+Math.min(cols-1,Math.max(0,Math.floor(fx)));(lists[c]||(lists[c]=[])).push(p.z);}
  const se=new Float64Array(dtm.coverage.length),meas=[];
  for(let i=0;i<se.length;i++){const n=dtm.counts[i];if(!n)continue;const L=lists[i];if(!L||L.length!==n)throw Error(`binning mismatch ${i}`);
    let sd=0;if(n>1){const m=L.reduce((a,b)=>a+b,0)/n;sd=Math.sqrt(L.reduce((a,b)=>a+(b-m)**2,0)/(n-1));}se[i]=Math.sqrt((sd*sd+INST*INST)/n);meas.push(se[i]);}
  meas.sort((a,b)=>a-b);const seMed=meas[Math.floor(meas.length/2)];
  for(let i=0;i<se.length;i++)if(dtm.coverage[i]===1)se[i]=Math.sqrt(seMed**2+(IDW_SLOPE*dtm.interpDistanceCells[i]*cellSizeM)**2);
  return se;
}
function blockU(dtm,se,ids,L){ // ids: [ll, lr, ur, ul]
  const z=ids.map(i=>dtm.z[i]);const gx=((z[1]+z[2])-(z[0]+z[3]))/(2*L),gy=((z[2]+z[3])-(z[0]+z[1]))/(2*L);
  const slope=Math.max(SLOPE_FLOOR,Math.hypot(gx,gy));return Math.max(...ids.map(i=>se[i]))/slope;
}
const sites=[];
for(const spec of A.DATASETS){
  const S=W.siteRuns(spec),{dtm,grid,points,runs}=S,tol=grid.cellSizeM;
  const se=cellSE(dtm,points,grid);
  let total=0,under=0;const ratios=[],diffs=[];let steep=0,steepUnder=0;
  for(const run of runs){
    const keep=A.dpIndices(run.vertices,tol);
    for(let j=0;j<keep.length-1;j++){
      const a=keep[j],b=keep[j+1];let L=0;for(let k=a;k<b;k++){const p=run.vertices[k],q=run.vertices[k+1];L+=Math.hypot(q.x-p.x,q.y-p.y);}
      const us=[];for(let k=a;k<b;k++)us.push(blockU(dtm,se,run.edges[k].ids,tol));
      const truth=Math.max(...us),ep=Math.max(us[0],us[us.length-1]);total+=L;
      if(ep<truth-1e-9){under+=L;ratios.push(truth/ep);diffs.push(truth-ep);}
      // spans whose every block is above the slope floor (uncapped), as a check that the floor is not driving the result
      const allSteep=run.edges.slice(a,b).every(e=>{const z=e.ids.map(i=>dtm.z[i]);const gx=((z[1]+z[2])-(z[0]+z[3]))/(2*tol),gy=((z[2]+z[3])-(z[0]+z[1]))/(2*tol);return Math.hypot(gx,gy)>SLOPE_FLOOR;});
      if(allSteep){steep+=L;if(ep<truth-1e-9)steepUnder+=L;}
    }
  }
  const med=x=>{const s=[...x].sort((a,b)=>a-b);return s.length?s[Math.floor(s.length/2)]:0;};
  sites.push({site:spec.label,contourLengthM:+total.toFixed(2),understatedLengthM:+under.toFixed(2),understatedLengthPct:+(100*under/total).toFixed(1),
    spansUnderstated:ratios.length,medianFactor:+med(ratios).toFixed(2),maxFactor:+Math.max(0,...ratios).toFixed(2),
    medianUnderstatementM:+med(diffs).toFixed(3),maxUnderstatementM:+Math.max(0,...diffs).toFixed(3),
    lengthAboveSlopeFloorM:+steep.toFixed(2),understatedAboveSlopeFloorPct:steep?+(100*steepUnder/steep).toFixed(1):null});
}
const out={driver:'horizontal position uncertainty understated by endpoint records',rules:{verticalSE:'standard-error profile',slopeFloor:SLOPE_FLOOR,u:'max cell se in block / max(slope, floor)'},sites};
fs.writeFileSync(path.join(ROOT,'results','positional_uncertainty_r1.json'),JSON.stringify(out,null,1)+'\n');
console.table(sites);
