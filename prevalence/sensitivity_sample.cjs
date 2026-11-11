#!/usr/bin/env node
'use strict';
/**
 * Sensitivity of the sample promotion rate to cell size and tolerance (rules:
 * docs/RULES_ADDITIONAL_TESTS.md, D8).
 * Usage: node prevalence/sensitivity_sample.cjs [cropsDir]
 *  - C0, as D4: 1 m cells, 1 m contour interval, one-cell Douglas-Peucker tolerance.
 *  - C1: cell = smallest whole metre >= nominal point spacing sqrt(10,000 / ground returns), at
 *    least 1 m; floor(100 / cell) cells per side; interval and tolerance one cell.
 *  - C2: 1 m cells and interval, tolerance two cells.
 *  - Per setting: crops with at least one promoted span (DP, endpoint records); per-crop promotion
 *    rate over crops with at least 20 spans (median, quartiles); EC-DP promotions; every crop's rate.
 */
const fs=require('node:fs');
const path=require('node:path');
const A=require('../ablation/reconstruct_ablation.cjs');
const B=require('../ablation/baselines.cjs');
const ROOT=path.resolve(__dirname,'..');
const dir=path.resolve(process.argv[2]||path.join(__dirname,'crops'));
if(!fs.existsSync(path.join(dir,'index.json'))){console.log('sensitivity: crops not present, skipped');process.exit(0);}
const state=JSON.parse(fs.readFileSync(path.join(dir,'index.json'),'utf8'));
const rel=path.relative(path.join(ROOT,'real-data-audit','crops'),dir);
const MIN_SPANS=20,SIDE=100;

function score(a,cell,tolCells){
  const n=Math.floor(SIDE/cell);
  const spec={id:a.id,label:a.id,file:path.join(rel,a.file),kind:'f32',offsetX:a.originX,offsetY:a.originY,
    grid:{originH1:a.originX,originH2:a.originY,cols:n,rows:n,cellSizeM:cell}};
  let runs,tol;
  try{({runs,tol}=B.featureRuns(spec));}catch(e){if(/no contour|Cannot read/.test(String(e)))return{spans:0,promoted:0,ecPromoted:0};throw e;}
  tol*=tolCells;
  const dp={spans:0,promoted:0,provLoss:0,maxPromotion:0,length:0,overLength:0,underLength:0,overPts:0,underPts:0};
  const ec={spans:0,promoted:0,provLoss:0,maxPromotion:0,length:0,overLength:0,underLength:0,overPts:0,underPts:0};
  for(const r of runs){const keep=A.dpIndices(r.vertices,tol);B.scoreSpans(r,keep,'endpoint',dp);B.scoreSpans(r,keep,'complete',ec);}
  return{spans:dp.spans,promoted:dp.promoted,ecPromoted:ec.promoted};
}
const quant=(v,q)=>{if(!v.length)return null;const s=[...v].sort((a,b)=>a-b),h=(s.length-1)*q,lo=Math.floor(h);return s[lo]+(h-lo)*(s[Math.min(lo+1,s.length-1)]-s[lo]);};
const r1=x=>x==null?null:Math.round(x*10)/10;

const SETTINGS={C0:a=>({cell:1,tol:1}),C1:a=>({cell:Math.max(1,Math.ceil(Math.sqrt(SIDE*SIDE/a.groundReturns)-1e-9)),tol:1}),C2:a=>({cell:1,tol:2})};
const rows=[],summary={};
for(const u of state.units){
  if(u.status!=='valid')continue;const a=u.attempts[u.attempts.length-1];
  const row={id:a.id,unit:u.unit,groundReturns:a.groundReturns};
  for(const [k,f] of Object.entries(SETTINGS)){const {cell,tol}=f(a);const s=score(a,cell,tol);row[k]={cell,tolCells:tol,...s,ratePct:s.spans?r1(100*s.promoted/s.spans):null};}
  rows.push(row);process.stderr.write(`${a.id} C0 ${row.C0.ratePct} C1(${row.C1.cell} m) ${row.C1.ratePct} C2 ${row.C2.ratePct}\n`);
}
for(const k of Object.keys(SETTINGS)){
  const rated=rows.filter(r=>r[k].spans>=MIN_SPANS).map(r=>100*r[k].promoted/r[k].spans);
  summary[k]={cropsWithPromotion:rows.filter(r=>r[k].promoted>0).length,crops:rows.length,cropsWithAtLeast20Spans:rated.length,
    medianPct:r1(quant(rated,.5)),q1Pct:r1(quant(rated,.25)),q3Pct:r1(quant(rated,.75)),
    spans:rows.reduce((s,r)=>s+r[k].spans,0),ecdpPromotions:rows.reduce((s,r)=>s+r[k].ecPromoted,0)};
}
summary.C1.cropsWithCellChanged=rows.filter(r=>r.C1.cell!==1).length;
summary.C1.cellSizesM=[...new Set(rows.map(r=>r.C1.cell))].sort((a,b)=>a-b);
const out={driver:'sensitivity of the sample promotion rate to cell size and tolerance',rules:'docs/RULES_ADDITIONAL_TESTS.md, D8',summary,crops:rows};
fs.writeFileSync(path.join(ROOT,'results','sensitivity_sample_r1.json'),JSON.stringify(out,null,1)+'\n');
console.log(JSON.stringify(summary,null,1));
