#!/usr/bin/env node
'use strict';
/**
 * Threshold-aligned splitting on the probability sample (rules: docs/RULES_ADDITIONAL_TESTS.md, D6).
 * Usage: node prevalence/query_split.cjs [cropsDir]
 *  - Methods on the 60 valid crops of D4, with the settings of D5 (strict feature runs, one-cell
 *    Douglas-Peucker): DP with endpoint records; SPLIT-T (a vertex forced wherever the provenance or
 *    the band of a channel's support, <33, 33-66, >=66 or none, changes; DP per piece; endpoint
 *    records); EC-DP (DP geometry, records over every replaced edge).
 *  - The query of D5 at t = 66, 33 and 50: correctly/falsely accepted and wrongly/correctly
 *    rejected source-edge length; false acceptance and wrong rejection per km; retention.
 *  - Retained vertices of each method and the share of spans with support promotion.
 *  - The run fails unless every source edge lies in exactly one span for each method, the four
 *    lengths sum to the scored length, and SPLIT-T has no false acceptance and no wrong rejection
 *    at t = 66 and 33 (D6, item 1).
 *  - Pooled values carry 2,000 bootstrap replicates resampling whole crops (xorshift32, seed 20261109).
 */
const fs=require('node:fs');
const path=require('node:path');
const A=require('../ablation/reconstruct_ablation.cjs');
const W=require('../ablation/worked_example.cjs');
const {dpWithForced}=require('../ablation/baselines.cjs');
const ROOT=path.resolve(__dirname,'..');
const dir=path.resolve(process.argv[2]||path.join(__dirname,'crops'));
if(!fs.existsSync(path.join(dir,'index.json'))){console.log('threshold-aligned split: crops not present, skipped');process.exit(0);}
const state=JSON.parse(fs.readFileSync(path.join(dir,'index.json'),'utf8'));
const rel=path.relative(path.join(ROOT,'real-data-audit','crops'),dir);
const THR=[66,33,50],METHODS=['endpoint','splitT','ecdp'],EPS=1e-6,REPS=2000,MIN_SPANS=20;

const band=v=>v==null?'-':v>=66?'2':v>=33?'1':'0';
const classKey=e=>`${e.provenance}|${band(e.typed.M)}|${band(e.typed.I)}`;
const bandBoundaries=edges=>{const f=new Set();for(let i=1;i<edges.length;i++)if(classKey(edges[i])!==classKey(edges[i-1]))f.add(i);return f;};
const promoted=(rec,span)=>{const t=W.record(span);
  return(rec.measuredSupport!=null&&t.measuredSupport!=null&&rec.measuredSupport>t.measuredSupport+1e-12)||
        (rec.interpolatedSupport!=null&&t.interpolatedSupport!=null&&rec.interpolatedSupport>t.interpolatedSupport+1e-12);};

function scoreCrop(spec){
  const S=W.siteRuns(spec),tol=S.grid.cellSizeM;
  const out={};for(const t of THR){out[t]={scored:0,qualifying:0};for(const m of METHODS)out[t][m]={ca:0,fa:0,wr:0,cr:0};}
  const verts={endpoint:0,splitT:0,ecdp:0},spans={endpoint:0,splitT:0,ecdp:0},prom={endpoint:0,splitT:0,ecdp:0};
  for(const run of S.runs){
    const n=run.edges.length,keepDP=A.dpIndices(run.vertices,tol),keepT=dpWithForced(run.vertices,bandBoundaries(run.edges),tol);
    const keeps={endpoint:keepDP,splitT:keepT,ecdp:keepDP};
    const recOf={};   // per method: record of the span holding each edge
    for(const m of METHODS){
      const keep=keeps[m],seen=new Uint8Array(n),rec=new Array(n);
      if(keep[0]!==0||keep[keep.length-1]!==run.vertices.length-1)throw Error(`${spec.id}: ${m} spans do not run end to end`);
      verts[m]+=keep.length;
      for(let j=0;j<keep.length-1;j++){
        const a=keep[j],b=keep[j+1];if(!(b>a))throw Error(`${spec.id}: ${m} spans out of order`);
        const span=run.edges.slice(a,b),r=m==='ecdp'?W.record(span):W.record([run.edges[a],run.edges[b-1]]);
        spans[m]++;if(promoted(r,span))prom[m]++;
        for(let k=a;k<b;k++){if(seen[k]++)throw Error(`${spec.id}: ${m} edge ${k} in more than one span`);rec[k]=r;}
      }
      for(let k=0;k<n;k++)if(seen[k]!==1)throw Error(`${spec.id}: ${m} edge ${k} in no span`);
      recOf[m]=rec;
    }
    for(let k=0;k<n;k++){
      const p=run.vertices[k],q=run.vertices[k+1],len=Math.hypot(q.x-p.x,q.y-p.y),e=run.edges[k];
      for(const t of THR){
        const f=W.passesAt(t),ok=f(e.typed.M,A.unionProv([e])),o=out[t];
        o.scored+=len;if(ok)o.qualifying+=len;
        for(const m of METHODS){const r=recOf[m][k],acc=f(r.measuredSupport,new Set(r.provenance));o[m][acc?(ok?'ca':'fa'):(ok?'wr':'cr')]+=len;}
      }
    }
  }
  for(const t of THR){const o=out[t];
    for(const m of METHODS){const s=o[m].ca+o[m].fa+o[m].wr+o[m].cr;
      if(Math.abs(s-o.scored)>EPS)throw Error(`${spec.id}: lengths do not sum (${m}, t=${t})`);
      if(Math.abs(o[m].ca+o[m].wr-o.qualifying)>EPS)throw Error(`${spec.id}: qualifying length differs (${m}, t=${t})`);}
    if(t!==50&&(o.splitT.fa>EPS||o.splitT.wr>EPS))throw Error(`${spec.id}: SPLIT-T misanswers the query at t=${t} (D6, item 1)`);}
  return{verts,spans,prom,out};
}

function xorshift32(seed){let s=seed>>>0;return()=>{s^=s<<13;s>>>=0;s^=s>>>17;s^=s<<5;s>>>=0;return s/4294967296;};}
function quant(v,q){if(!v.length)return null;const s=[...v].sort((a,b)=>a-b),h=(s.length-1)*q,lo=Math.floor(h);return s[lo]+(h-lo)*(s[Math.min(lo+1,s.length-1)]-s[lo]);}
const r2=x=>x==null?null:Math.round(x*100)/100;

const crops=[];
for(const u of state.units){
  if(u.status!=='valid')continue;const a=u.attempts[u.attempts.length-1];
  const spec={id:a.id,label:a.id,file:path.join(rel,a.file),kind:'f32',offsetX:a.originX,offsetY:a.originY,grid:{originH1:a.originX,originH2:a.originY,cols:100,rows:100,cellSizeM:1}};
  let r;try{r=scoreCrop(spec);}catch(e){if(/no contour|Cannot read/.test(String(e)))r=null;else throw e;}
  if(r)crops.push({id:a.id,unit:u.unit,...r});
}
function measures(set,t){
  const sum=k=>set.reduce((s,c)=>s+k(c.out[t]),0),scored=sum(o=>o.scored),q=sum(o=>o.qualifying),res={};
  for(const m of METHODS)res[m]={falseAcceptPerKm:scored?1000*sum(o=>o[m].fa)/scored:null,wrongRejectPerKm:scored?1000*sum(o=>o[m].wr)/scored:null,retentionPct:q?100*sum(o=>o[m].ca)/q:null};
  return res;
}
const rng=xorshift32(20261109),summary={};
for(const t of THR){
  const pooled=measures(crops,t),boot={};for(const m of METHODS)boot[m]={fa:[],ret:[]};
  for(let b=0;b<REPS;b++){const smp=crops.map(()=>crops[Math.floor(rng()*crops.length)]),M=measures(smp,t);
    for(const m of METHODS){boot[m].fa.push(M[m].falseAcceptPerKm);if(M[m].retentionPct!=null)boot[m].ret.push(M[m].retentionPct);}}
  const ci=v=>[r2(quant(v,.025)),r2(quant(v,.975))];
  summary[t]=Object.fromEntries(METHODS.map(m=>[m,{falseAcceptPerKm:r2(pooled[m].falseAcceptPerKm),falseAccept95:ci(boot[m].fa),
    wrongRejectPerKm:r2(pooled[m].wrongRejectPerKm),retentionPct:r2(pooled[m].retentionPct),retention95:ci(boot[m].ret)}]));
}
const rated=crops.filter(c=>c.spans.endpoint>=MIN_SPANS),mult=rated.map(c=>c.verts.splitT/c.verts.endpoint);
const sumv=m=>crops.reduce((s,c)=>s+c.verts[m],0),sums=m=>crops.reduce((s,c)=>s+c.spans[m],0),sump=m=>crops.reduce((s,c)=>s+c.prom[m],0);
const out={driver:'threshold-aligned splitting on the probability sample',rules:'docs/RULES_ADDITIONAL_TESTS.md, D6',
  cropsScored:crops.length,
  vertices:{pooled:{endpoint:sumv('endpoint'),splitT:sumv('splitT'),multiple:r2(sumv('splitT')/sumv('endpoint'))},
    perCropMultiple:{crops:rated.length,median:r2(quant(mult,.5)),q1:r2(quant(mult,.25)),q3:r2(quant(mult,.75)),max:r2(Math.max(...mult))}},
  supportPromotion:Object.fromEntries(METHODS.map(m=>[m,{spans:sums(m),promoted:sump(m),pct:r2(100*sump(m)/sums(m))}])),
  query:summary,
  checks:{splitTExactAt66and33:true,everyEdgeInExactlyOneSpan:true,lengthsSum:true}};
fs.writeFileSync(path.join(ROOT,'results','query_split_r1.json'),JSON.stringify(out,null,1)+'\n');
console.log(JSON.stringify(out,null,1));
