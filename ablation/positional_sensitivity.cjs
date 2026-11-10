#!/usr/bin/env node
'use strict';
/**
 * Sensitivity of the positional-uncertainty result to its two fixed constants.
 * Rules written before the first run (9 November 2026): the computation of positional_uncertainty.cjs
 * is repeated unchanged for instrument precision in {0.02, 0.05, 0.10} m and slope floor in
 * {0.02, 0.05, 0.10} m/m (nine combinations; 0.05/0.05 is the paper's). Reported per site and
 * combination: share of contour length whose endpoint record understates u, and the median factor.
 */
const fs=require('node:fs');
const path=require('node:path');
const A=require('./reconstruct_ablation.cjs');
const W=require('./worked_example.cjs');
const ROOT=path.resolve(__dirname,'..');
const IDW_SLOPE=0.05,INSTS=[0.02,0.05,0.10],FLOORS=[0.02,0.05,0.10];
function cellSE(dtm,points,grid,INST){
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
const med=x=>{const s=[...x].sort((a,b)=>a-b);return s.length?s[Math.floor(s.length/2)]:0;};
const rows=[];
for(const spec of A.DATASETS){
  const S=W.siteRuns(spec),{dtm,grid,points,runs}=S,tol=grid.cellSizeM;
  const keeps=runs.map(r=>A.dpIndices(r.vertices,tol));
  for(const INST of INSTS){const se=cellSE(dtm,points,grid,INST);
    for(const FLOOR of FLOORS){let total=0,under=0;const ratios=[];
      const u=ids=>{const z=ids.map(i=>dtm.z[i]);const gx=((z[1]+z[2])-(z[0]+z[3]))/(2*tol),gy=((z[2]+z[3])-(z[0]+z[1]))/(2*tol);return Math.max(...ids.map(i=>se[i]))/Math.max(FLOOR,Math.hypot(gx,gy));};
      runs.forEach((run,ri)=>{const keep=keeps[ri];for(let j=0;j<keep.length-1;j++){const a=keep[j],b=keep[j+1];let L=0;const us=[];
        for(let k=a;k<b;k++){const p=run.vertices[k],q=run.vertices[k+1];L+=Math.hypot(q.x-p.x,q.y-p.y);us.push(u(run.edges[k].ids));}
        const truth=Math.max(...us),ep=Math.max(us[0],us[us.length-1]);total+=L;if(ep<truth-1e-9){under+=L;ratios.push(truth/ep);}}});
      rows.push({site:spec.label,instrumentM:INST,slopeFloor:FLOOR,understatedLengthPct:+(100*under/total).toFixed(1),medianFactor:+med(ratios).toFixed(2)});}}
}
fs.writeFileSync(path.join(ROOT,'results','positional_sensitivity_r1.json'),JSON.stringify({driver:'sensitivity of positional-uncertainty understatement to instrument precision and slope floor',rows},null,1)+'\n');
console.table(rows);
