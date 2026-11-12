#!/usr/bin/env node
'use strict';
/**
 * Support against independent checkpoints in forest terrain (rules: docs/RULES_ADDITIONAL_TESTS.md, D12).
 * Usage: node external-check/coconino_checkpoints.cjs
 *  - Data: 60 USGS accuracy checkpoints of AZ Coconino B1 2019 (38 NVA, 22 VVA) and the class-2 ground
 *    returns within 3 m of each, in a local Conus Albers frame (NAVD88).
 *  - Per checkpoint: the 5 x 5 block of whole 1 m cells centred on its cell, built with the frozen snapshot.
 *    One target return count for the site: the median count over the measured cells of all blocks.
 *  - Support, channel and error as in D10; unsupported cells are counted, not scored; nothing is excluded.
 *  - Primary: Spearman rank correlation of support and error with a 95% bootstrap interval (2,000
 *    replicates, xorshift32, seed 20261111). Secondary: within measured cells; per band and channel; NVA/VVA.
 */
const fs=require('node:fs');
const path=require('node:path');
const {rasterizeDtm}=require('../real-data-audit/dist/src/terrain/ground/rasterizeDtm.js');
const {buildDtmGrid}=require('../real-data-audit/dist/src/terrain/ground/cellConfidence.js');
const ROOT=path.resolve(__dirname,'..');
const CK=JSON.parse(fs.readFileSync(path.join(__dirname,'coconino__checkpoints.json'),'utf8'));
const buf=fs.readFileSync(path.join(__dirname,'coconino__ground.f32'));
const f=new Float32Array(buf.buffer,buf.byteOffset,buf.byteLength/4);
if(f.length/3!==CK.groundPoints)throw Error(`ground file has ${f.length/3} returns, checkpoint file expects ${CK.groundPoints}`);
const REPS=2000,SEED=20261111,HALF=2,N=2*HALF+1;

// returns of each checkpoint's 5 x 5 block
const blocks=CK.checkpoints.map(c=>{
  const c0=Math.floor(c.e)-HALF,r0=Math.floor(c.n)-HALF,pts=[];
  for(let i=0;i<f.length;i+=3){const x=f[i],y=f[i+1];if(x>=c0&&x<c0+N&&y>=r0&&y<r0+N)pts.push({x,y,z:f[i+2]});}
  const grid={originH1:c0,originH2:r0,cols:N,rows:N,cellSizeM:1};
  return{c,grid,raster:rasterizeDtm(pts,new Uint8Array(pts.length).fill(1),{grid,aggregation:'mean'}),returns:pts.length};
});
// one target count for the site, from counts alone
const measuredCounts=[];for(const b of blocks)for(const n of b.raster.counts)if(n>0)measuredCounts.push(n);
measuredCounts.sort((a,b)=>a-b);
const mid=measuredCounts.length>>1,targetCount=measuredCounts.length%2?measuredCounts[mid]:(measuredCounts[mid-1]+measuredCounts[mid])/2;

const rows=[],notScored={unsupported:0};
for(const b of blocks){
  const dtm=buildDtmGrid(b.raster,{targetCount}),i=HALF*N+HALF,cov=dtm.coverage[i];
  if(cov===0||!Number.isFinite(dtm.z[i])){notScored.unsupported++;rows.push({id:b.c.id,type:b.c.type,scored:false,returnsInCell:b.raster.counts[i]});continue;}
  rows.push({id:b.c.id,type:b.c.type,scored:true,channel:cov===2?'measured':'interpolated',returnsInCell:b.raster.counts[i],
    support:dtm.confidence[i],dtmZ:dtm.z[i],checkpointZ:b.c.z,errorM:Math.abs(dtm.z[i]-b.c.z)});
}
const S=rows.filter(r=>r.scored);

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
const groups=key=>{const g={};for(const r of S){const k=key(r);(g[k]=g[k]||[]).push(r);}
  return Object.fromEntries(Object.entries(g).map(([k,v])=>[k,{n:v.length,medianSupport:r3(quant(v.map(r=>r.support),.5)),medianErrorM:r3(quant(v.map(r=>r.errorM),.5))}]));};
const out={driver:'support against independent checkpoints in forest terrain (Coconino)',rules:'docs/RULES_ADDITIONAL_TESTS.md, D12',
  checkpoints:rows.length,scored:S.length,notScored,targetCount,
  primary:measure(S,rng),
  measuredCellsOnly:measure(S.filter(r=>r.channel==='measured'),rng),
  byBand:groups(r=>band(r.support)),byChannel:groups(r=>r.channel),byType:groups(r=>r.type),
  medianErrorM:r3(quant(S.map(r=>r.errorM),.5)),
  // not in the rules; added after the run and reported as descriptive
  descriptiveNotPrespecified:{withoutLargestError:measure(S.filter(r=>r.errorM<Math.max(...S.map(q=>q.errorM))),rng),
    withinNVA:measure(S.filter(r=>r.type==='NVA'),rng),
    // vegetated checkpoints: all 22 including two interpolated cells (pooled, as first reported) and the 20 in measured cells (reported as the main subgroup value); order kept so earlier values do not change
    withinVVA:measure(S.filter(r=>r.type==='VVA'),rng),withinVVAMeasured:measure(S.filter(r=>r.type==='VVA'&&r.channel==='measured'),rng)},
  checkpointRows:rows.map(r=>r.scored?{...r,support:r3(r.support),dtmZ:r3(r.dtmZ),checkpointZ:r3(r.checkpointZ),errorM:r3(r.errorM)}:r)};
fs.writeFileSync(path.join(ROOT,'results','coconino_checkpoints_r1.json'),JSON.stringify(out,null,1)+'\n');
const{checkpointRows,...summary}=out;console.log(JSON.stringify(summary,null,1));
