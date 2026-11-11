#!/usr/bin/env node
'use strict';
/**
 * Support against independent RTK checkpoints at Marsh Island (rules: docs/RULES_ADDITIONAL_TESTS.md, D10).
 * Usage: node external-check/marsh_checkpoints.cjs
 *  - DTM: the one every Marsh Island result uses (frozen snapshot, 0.5 m cells, point-in-cell mean).
 *  - Each of the 104 check shots takes the cell that contains it; support is that cell's support (0-100)
 *    in its channel; error = |DTM height - checkpoint height|. Unsupported or off-grid shots are counted,
 *    not scored. Nothing is excluded.
 *  - Primary: Spearman rank correlation of support and error, 95% interval from 2,000 bootstrap
 *    replicates over checkpoints (xorshift32, seed 20261111). Secondary: per band and channel; the
 *    primary measure without errors above 1 m, reported alongside.
 */
const fs=require('node:fs');
const path=require('node:path');
const A=require('../ablation/reconstruct_ablation.cjs');
const {rasterizeDtm}=require('../real-data-audit/dist/src/terrain/ground/rasterizeDtm.js');
const {buildDtmGrid}=require('../real-data-audit/dist/src/terrain/ground/cellConfidence.js');
const ROOT=path.resolve(__dirname,'..');
const CK=JSON.parse(fs.readFileSync(path.join(__dirname,'marsh-island__checkpoints.json'),'utf8'));
const REPS=2000,SEED=20261111;

const spec=A.DATASETS.find(d=>d.id==='marsh');
const{points,grid}=A.loadDataset(spec);
if(points.length!==CK.groundPoints)throw Error(`crop has ${points.length} ground returns, checkpoint file expects ${CK.groundPoints}`);
const dtm=buildDtmGrid(rasterizeDtm(points,new Uint8Array(points.length).fill(1),{grid,aggregation:'mean'}));
const{cols,rows,cellSizeM,originH1,originH2}=dtm;

const rows_=[],notScored={offGrid:0,unsupported:0};
for(const c of CK.checkpoints){
  const col=Math.floor((c.e-originH1)/cellSizeM),row=Math.floor((c.n-originH2)/cellSizeM);
  if(col<0||row<0||col>=cols||row>=rows){notScored.offGrid++;continue;}
  const i=row*cols+col,cov=dtm.coverage[i];
  if(cov===0||!Number.isFinite(dtm.z[i])){notScored.unsupported++;continue;}
  rows_.push({id:c.id,channel:cov===2?'measured':'interpolated',support:dtm.confidence[i],dtmZ:dtm.z[i],checkpointZ:c.z,errorM:Math.abs(dtm.z[i]-c.z)});
}

function ranks(v){const o=v.map((x,i)=>[x,i]).sort((a,b)=>a[0]-b[0]),r=new Array(v.length);
  for(let i=0;i<o.length;){let j=i;while(j+1<o.length&&o[j+1][0]===o[i][0])j++;const m=(i+j)/2+1;for(let k=i;k<=j;k++)r[o[k][1]]=m;i=j+1;}return r;}
function spearman(x,y){if(x.length<3)return null;const a=ranks(x),b=ranks(y),n=a.length,ma=a.reduce((s,v)=>s+v,0)/n,mb=b.reduce((s,v)=>s+v,0)/n;
  let sab=0,saa=0,sbb=0;for(let i=0;i<n;i++){sab+=(a[i]-ma)*(b[i]-mb);saa+=(a[i]-ma)**2;sbb+=(b[i]-mb)**2;}return saa&&sbb?sab/Math.sqrt(saa*sbb):null;}
function xorshift32(seed){let s=seed>>>0;return()=>{s^=s<<13;s>>>=0;s^=s>>>17;s^=s<<5;s>>>=0;return s/4294967296;};}
const quant=(v,q)=>{if(!v.length)return null;const s=[...v].sort((a,b)=>a-b),h=(s.length-1)*q,lo=Math.floor(h);return s[lo]+(h-lo)*(s[Math.min(lo+1,s.length-1)]-s[lo]);};
const r3=x=>x==null?null:Math.round(x*1000)/1000;
function measure(set,rng){
  const rho=spearman(set.map(r=>r.support),set.map(r=>r.errorM)),boot=[];
  for(let b=0;b<REPS;b++){const s=set.map(()=>set[Math.floor(rng()*set.length)]),v=spearman(s.map(r=>r.support),s.map(r=>r.errorM));if(v!=null)boot.push(v);}
  return{n:set.length,spearman:r3(rho),spearman95:[r3(quant(boot,.025)),r3(quant(boot,.975))]};
}
const rng=xorshift32(SEED);
const band=s=>s>=66?'66 or above':s>=33?'33 to below 66':'below 33';
const groups=(key)=>{const g={};for(const r of rows_){const k=key(r);(g[k]=g[k]||[]).push(r.errorM);}
  return Object.fromEntries(Object.entries(g).map(([k,v])=>[k,{n:v.length,medianErrorM:r3(quant(v,.5))}]));};
const out={driver:'support against independent RTK checkpoints at Marsh Island',rules:'docs/RULES_ADDITIONAL_TESTS.md, D10',
  checkpoints:CK.checkpoints.length,scored:rows_.length,notScored,
  primary:measure(rows_,rng),
  withoutErrorsAbove1m:measure(rows_.filter(r=>r.errorM<=1),rng),
  byBand:groups(r=>band(r.support)),byChannel:groups(r=>r.channel),
  medianErrorM:r3(quant(rows_.map(r=>r.errorM),.5)),
  checkpointsScored:rows_.map(r=>({...r,support:r3(r.support),dtmZ:r3(r.dtmZ),errorM:r3(r.errorM)}))};
fs.writeFileSync(path.join(ROOT,'results','marsh_checkpoints_r1.json'),JSON.stringify(out,null,1)+'\n');
const{checkpointsScored,...summary}=out;console.log(JSON.stringify(summary,null,1));
