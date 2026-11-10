#!/usr/bin/env node
'use strict';
/**
 * Scores the probability sample of USGS 3DEP work units (rules: docs/RULES_ADDITIONAL_TESTS.md, D4).
 * Usage: node prevalence/score_sample.cjs [cropsDir]
 *  - Each valid crop is scored as the scale test: 1 m cells, contours at 1 m, strict feature runs,
 *    one-cell Douglas-Peucker, support promotion of endpoint records and of EC-DP records.
 *  - P1: share of valid crops with at least one promoted span, Wilson 95 % interval. A crop with
 *    no contour span counts as having none.
 *  - P2: among valid crops with at least 20 spans, the per-crop promotion rate: median, quartiles,
 *    mean with a 95 % interval from 2,000 bootstrap replicates over crops (xorshift32, seed
 *    20261109); the pooled rate as a description.
 *  - Also: EC-DP promotions, units tried, and every unit not used with its reason.
 */
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const B=require('../ablation/baselines.cjs');
const ROOT=path.resolve(__dirname,'..');
const dir=path.resolve(process.argv[2]||path.join(__dirname,'crops'));
if(!fs.existsSync(path.join(dir,'index.json'))){console.log('prevalence sample: crops not present, skipped');process.exit(0);}
const state=JSON.parse(fs.readFileSync(path.join(dir,'index.json'),'utf8'));
const SIZE=100,MIN_SPANS=20,REPS=2000,BOOT_SEED=20261109;
const rel=path.relative(path.join(ROOT,'real-data-audit','crops'),dir);
const crops=[],notUsed=[];
for(const u of state.units){
  if(u.status!=='valid'){notUsed.push({rank:u.rank,unit:u.unit,reasons:u.attempts.map(a=>a.reason)});continue;}
  const a=u.attempts[u.attempts.length-1];
  if(crypto.createHash('sha256').update(fs.readFileSync(path.join(dir,a.file))).digest('hex')!==a.sha256)throw Error(`digest mismatch ${a.id}`);
  const row={id:a.id,unit:u.unit,lon:a.lon,lat:a.lat,epsg:a.epsg,originX:a.originX,originY:a.originY,groundReturns:a.groundReturns,verticalUnit:a.verticalUnit,sha256:a.sha256};
  const spec={id:a.id,label:a.id,file:path.join(rel,a.file),kind:'f32',offsetX:a.originX,offsetY:a.originY,grid:{originH1:a.originX,originH2:a.originY,cols:SIZE,rows:SIZE,cellSizeM:1}};
  let m=null;
  try{m=Object.fromEntries(B.evaluateSite(spec).methods.map(x=>[x.method,x]));}catch(e){row.note='no contour line';}
  Object.assign(row,m?{lines:m.DP.lines,spans:m.DP.spans,promoted:m.DP.supportPromotionCount,provLoss:m.DP.provenanceLossCount,ecPromoted:m['EC-DP'].supportPromotionCount,ecProvLoss:m['EC-DP'].provenanceLossCount}
                     :{lines:0,spans:0,promoted:0,provLoss:0,ecPromoted:0,ecProvLoss:0});
  crops.push(row);process.stderr.write(`${a.id} ${u.unit} spans ${row.spans} promoted ${row.promoted}\n`);
}
const r1=x=>Math.round(x*10)/10;
function quant(v,q){if(!v.length)return null;const s=[...v].sort((a,b)=>a-b),h=(s.length-1)*q,lo=Math.floor(h);return s[lo]+(h-lo)*(s[Math.min(lo+1,s.length-1)]-s[lo]);}
function wilson(k,n){if(!n)return[null,null];const z=1.959963984540054,p=k/n,d=1+z*z/n,c=(p+z*z/(2*n))/d,h=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/d;return[r1(100*(c-h)),r1(100*(c+h))];}
function xorshift32(seed){let s=seed>>>0;return()=>{s^=s<<13;s>>>=0;s^=s>>>17;s^=s<<5;s>>>=0;return s/4294967296;};}
const n=crops.length,withProm=crops.filter(c=>c.promoted>0).length;
const rated=crops.filter(c=>c.spans>=MIN_SPANS),rates=rated.map(c=>100*c.promoted/c.spans);
const rng=xorshift32(BOOT_SEED),means=[];
for(let b=0;b<REPS&&rates.length;b++){let s=0;for(let i=0;i<rates.length;i++)s+=rates[Math.floor(rng()*rates.length)];means.push(s/rates.length);}
const sum=k=>crops.reduce((s,c)=>s+c[k],0);
const out={driver:'probability sample of USGS 3DEP work units',rules:'docs/RULES_ADDITIONAL_TESTS.md, D4',
  frame:{units:state.frameUnits,sha256:state.frameSha256,seed:state.seed},
  unitsTried:state.units.length,validCrops:n,unitsNotUsed:notUsed.length,
  verticalUnits:{metre:crops.filter(c=>c.verticalUnit==='metre').length,foot:crops.filter(c=>c.verticalUnit==='foot').length},
  P1:{cropsWithPromotion:withProm,validCrops:n,sharePct:n?r1(100*withProm/n):null,wilson95Pct:wilson(withProm,n)},
  P2:{cropsWithAtLeast20Spans:rated.length,medianPct:rates.length?r1(quant(rates,.5)):null,q1Pct:rates.length?r1(quant(rates,.25)):null,q3Pct:rates.length?r1(quant(rates,.75)):null,
      minPct:rates.length?r1(Math.min(...rates)):null,maxPct:rates.length?r1(Math.max(...rates)):null,
      meanPct:rates.length?r1(rates.reduce((a,b)=>a+b,0)/rates.length):null,meanBootstrap95Pct:means.length?[r1(quant(means,.025)),r1(quant(means,.975))]:null,
      pooled:{spans:rated.reduce((s,c)=>s+c.spans,0),promoted:rated.reduce((s,c)=>s+c.promoted,0)}},
  allValidCrops:{spans:sum('spans'),promoted:sum('promoted'),ecPromoted:sum('ecPromoted'),ecProvLoss:sum('ecProvLoss'),cropsWithNoSpan:crops.filter(c=>c.spans===0).length},
  crops,notUsed};
out.P2.pooled.ratePct=out.P2.pooled.spans?r1(100*out.P2.pooled.promoted/out.P2.pooled.spans):null;
fs.writeFileSync(path.join(ROOT,'results','prevalence_3dep_r1.json'),JSON.stringify(out,null,1)+'\n');
console.log(`valid crops ${n} of ${state.units.length} units tried; P1 ${withProm}/${n} = ${out.P1.sharePct} % [${out.P1.wilson95Pct}]`);
console.log(`P2 (${rated.length} crops with >= 20 spans): median ${out.P2.medianPct} % [${out.P2.q1Pct}, ${out.P2.q3Pct}], mean ${out.P2.meanPct} % [${out.P2.meanBootstrap95Pct}], pooled ${out.P2.pooled.ratePct} %; EC-DP promotions ${out.allValidCrops.ecPromoted}`);
