#!/usr/bin/env node
'use strict';
/**
 * Support-profile sensitivity.
 *
 * The contour geometry depends only on elevations, so it is identical under every profile. Only
 * the per-cell support field (0-100) is replaced. Each profile is then pushed through the same
 * production pipeline: display-grade run splitting, one-cell DP, and the P0/P1/EC-DP attribution
 * rules of the ablation.
 *
 *   REFERENCE   the production profile used in the paper (relative x absolute density for
 *               measured cells; distance and roughness decay for interpolated cells).
 *   EXPONENTIAL measured 100(1 - exp(-n/2)); interpolated 50 exp(-(d-1)/1.5).
 *   KRIGING     100(1 - s2/s), s2 the simple-kriging (Gaussian-process posterior) variance of the
 *               cell from its k = 8 nearest measured cells within 6 cells, exponential covariance
 *               (sill s = 1, range 3 cells), observation noise tau2/n_j with tau2 = 0.5.
 *   SURVEY      100 exp(-se^2 / (2 * 0.10^2)), se the standard error of the cell elevation in
 *               metres: sqrt((s_z^2 + 0.05^2)/n) for measured cells (s_z the sample standard
 *               deviation of the cell's returns, 0.05 m instrument precision), and
 *               sqrt(se_med^2 + (0.05 d L)^2) for interpolated cells (se_med the median measured
 *               se, d the distance to data in cells, L the cell size in metres).
 *
 * Profile parameters are fixed in advance and are not tuned to any outcome.
 */
const fs=require('node:fs');
const path=require('node:path');
const A=require('./reconstruct_ablation.cjs');
const B=require('./baselines.cjs');
const {gradeForConfidence}=require('../real-data-audit/dist/src/terrain/ground/cellConfidence.js');
const ROOT=path.resolve(__dirname,'..');

function cellReturns(points,grid){
  const{originH1,originH2,cols,rows,cellSizeM}=grid,lists=new Array(cols*rows);
  for(const p of points){
    const fx=(p.x-originH1)/cellSizeM,fy=(p.y-originH2)/cellSizeM;
    if(fx<-1e-6||fx>cols+1e-6||fy<-1e-6||fy>rows+1e-6)continue;
    const c=Math.min(rows-1,Math.max(0,Math.floor(fy)))*cols+Math.min(cols-1,Math.max(0,Math.floor(fx)));
    (lists[c]||(lists[c]=[])).push(p.z);
  }
  return lists;
}

function solve(Mx,v){ // Gaussian elimination with partial pivoting; Mx is SPD here.
  const n=v.length,a=Mx.map((r,i)=>[...r,v[i]]);
  for(let c=0;c<n;c++){let p=c;for(let r=c+1;r<n;r++)if(Math.abs(a[r][c])>Math.abs(a[p][c]))p=r;[a[c],a[p]]=[a[p],a[c]];
    for(let r=c+1;r<n;r++){const f=a[r][c]/a[c][c];for(let k=c;k<=n;k++)a[r][k]-=f*a[c][k];}}
  const x=new Array(n);for(let r=n-1;r>=0;r--){let s=a[r][n];for(let k=r+1;k<n;k++)s-=a[r][k]*x[k];x[r]=s/a[r][r];}
  return x;
}

const PROFILES={
  REFERENCE:null,
  EXPONENTIAL:(dtm)=>{
    const out=new Float32Array(dtm.confidence.length);
    for(let i=0;i<out.length;i++){
      if(dtm.coverage[i]===2)out[i]=Math.round(100*(1-Math.exp(-dtm.counts[i]/2)));
      else if(dtm.coverage[i]===1)out[i]=Math.round(50*Math.exp(-(dtm.interpDistanceCells[i]-1)/1.5));
    }
    return out;
  },
  KRIGING:(dtm)=>{
    const{cols,rows,coverage,counts}=dtm,S=1,RANGE=3,TAU2=0.5,K=8,R=6,out=new Float32Array(coverage.length);
    const cov=h=>S*Math.exp(-h/RANGE);
    for(let i=0;i<out.length;i++){
      if(coverage[i]===0)continue;
      const ci=i%cols,ri=(i-ci)/cols,nb=[];
      for(let r=Math.max(0,ri-R);r<=Math.min(rows-1,ri+R);r++)for(let c=Math.max(0,ci-R);c<=Math.min(cols-1,ci+R);c++){
        const j=r*cols+c;if(counts[j]>0)nb.push({j,c,r,h:Math.hypot(c-ci,r-ri)});
      }
      if(!nb.length)continue;
      nb.sort((a,b)=>a.h-b.h||a.j-b.j);const use=nb.slice(0,K);
      const Cm=use.map((p,x)=>use.map((q,y)=>cov(Math.hypot(p.c-q.c,p.r-q.r))+(x===y?TAU2/counts[p.j]:0)));
      const cv=use.map(p=>cov(p.h)),w=solve(Cm,cv);
      let s2=S;for(let k=0;k<use.length;k++)s2-=w[k]*cv[k];
      out[i]=Math.round(100*Math.min(1,Math.max(0,1-s2/S)));
    }
    return out;
  },
  SURVEY:(dtm,points,grid)=>{
    const lists=cellReturns(points,grid),INST=0.05,TOL=0.10,SLOPE=0.05,se=new Float64Array(dtm.coverage.length),meas=[];
    for(let i=0;i<se.length;i++){
      const n=dtm.counts[i];if(!n)continue;
      const L=lists[i];if(!L||L.length!==n)throw Error(`binning mismatch at cell ${i}`);
      let sd=0;if(n>1){const m=L.reduce((a,b)=>a+b,0)/n;sd=Math.sqrt(L.reduce((a,b)=>a+(b-m)**2,0)/(n-1));}
      se[i]=Math.sqrt((sd*sd+INST*INST)/n);meas.push(se[i]);
    }
    meas.sort((a,b)=>a-b);const seMed=meas[Math.floor(meas.length/2)];
    const out=new Float32Array(se.length);
    for(let i=0;i<se.length;i++){
      let e;if(dtm.coverage[i]===2)e=se[i];else if(dtm.coverage[i]===1)e=Math.sqrt(seMed**2+(SLOPE*dtm.interpDistanceCells[i]*grid.cellSizeM)**2);else continue;
      out[i]=Math.round(100*Math.exp(-(e*e)/(2*TOL*TOL)));
    }
    return out;
  },
};

function evaluate(spec,name){
  const{runs,tol,dtm}=B.featureRuns(spec,PROFILES[name]);
  const p0={spans:0,promoted:0,provLoss:0,maxPromotion:0,length:0,overLength:0,underLength:0,overPts:0,underPts:0};
  const ec={...p0};
  let gradeLoss=0,mCells=0,mBelowSolid=0,iCells=0,iSolid=0;
  for(const r of runs){
    const keep=A.dpIndices(r.vertices,tol);
    B.scoreSpans(r,keep,'endpoint',p0);B.scoreSpans(r,keep,'complete',ec);
    for(let j=0;j<keep.length-1;j++)if(A.misses(A.gradeProv(r.grade),A.unionProv(r.edges.slice(keep[j],keep[j+1]))))gradeLoss++;
  }
  for(let i=0;i<dtm.coverage.length;i++){
    const g=gradeForConfidence(dtm.confidence[i]);
    if(dtm.coverage[i]===2){mCells++;if(g!=='solid')mBelowSolid++;}
    else if(dtm.coverage[i]===1){iCells++;if(g==='solid')iSolid++;}
  }
  return{profile:name,site:spec.label,lines:runs.length,spans:p0.spans,
    endpointSupportPromotionPct:A.pct(p0.promoted,p0.spans),
    gradeProvenanceLossPct:A.pct(gradeLoss,p0.spans),
    typedEndpointProvenanceLossPct:A.pct(p0.provLoss,p0.spans),
    ecdpSupportPromotionPct:A.pct(ec.promoted,ec.spans),ecdpProvenanceLossPct:A.pct(ec.provLoss,ec.spans),
    measuredCellsBelowSolidPct:A.pct(mBelowSolid,mCells),interpolatedCellsSolidPct:A.pct(iSolid,iCells)};
}

module.exports={PROFILES,evaluate,cellReturns};
if(require.main===module){
  const rows=[];
  for(const name of Object.keys(PROFILES))for(const d of A.DATASETS)rows.push(evaluate(d,name));
  fs.writeFileSync(path.join(ROOT,'results','support_profiles_r3.json'),JSON.stringify({driver:'support-profile sensitivity',rows},null,2)+'\n');
  const cols=['profile','site','lines','spans','endpointSupportPromotionPct','gradeProvenanceLossPct','typedEndpointProvenanceLossPct','ecdpSupportPromotionPct','ecdpProvenanceLossPct','measuredCellsBelowSolidPct','interpolatedCellsSolidPct'];
  const csv=[cols.join(',')].concat(rows.map(r=>cols.map(c=>typeof r[c]==='number'&&!Number.isInteger(r[c])?r[c].toFixed(1):r[c]).join(',')));
  fs.writeFileSync(path.join(__dirname,'support_profiles_site_results.csv'),csv.join('\n')+'\n');
  console.log(csv.join('\n'));
}
