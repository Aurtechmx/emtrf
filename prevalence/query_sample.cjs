#!/usr/bin/env node
'use strict';
/**
 * Attribute query on the probability sample (rules: docs/RULES_ADDITIONAL_TESTS.md, D5).
 * Usage: node prevalence/query_sample.cjs [cropsDir]
 *  - The query of Supplementary Methods S10 (measured support >= t and provenance measured only;
 *    t = 66 primary, t = 33 check) is applied to each simplified span's exported record and to each
 *    source edge's own record, on the 60 valid crops of the 3DEP sample.
 *  - Per crop, method and threshold: correctly accepted, falsely accepted, wrongly rejected and
 *    correctly rejected source-edge length; false acceptance and wrong rejection per km; retention
 *    (correctly accepted / qualifying), undefined when nothing qualifies.
 *  - The run fails unless every source edge lies in exactly one span, the four lengths sum to the
 *    scored length for each method, and scored and qualifying lengths match between methods.
 *  - Medians over crops where defined, pooled values from summed lengths, and bootstrap intervals
 *    resampling whole crops (2,000 replicates, xorshift32 seed 20261109).
 */
const fs=require('node:fs');
const path=require('node:path');
const A=require('../ablation/reconstruct_ablation.cjs');
const W=require('../ablation/worked_example.cjs');
const ROOT=path.resolve(__dirname,'..');
const dir=path.resolve(process.argv[2]||path.join(__dirname,'crops'));
if(!fs.existsSync(path.join(dir,'index.json'))){console.log('query on sample: crops not present, skipped');process.exit(0);}
const state=JSON.parse(fs.readFileSync(path.join(dir,'index.json'),'utf8'));
const rel=path.relative(path.join(ROOT,'real-data-audit','crops'),dir);
const THR=[66,33],METHODS=['endpoint','ecdp'],EPS=1e-6,REPS=2000;

function scoreCrop(spec){
  const S=W.siteRuns(spec),tol=S.grid.cellSizeM;
  const out={};for(const t of THR){out[t]={scored:0,qualifying:0};for(const m of METHODS)out[t][m]={ca:0,fa:0,wr:0,cr:0};}
  let edges=0,spans=0;
  for(const run of S.runs){
    const keep=A.dpIndices(run.vertices,tol),n=run.edges.length,seen=new Uint8Array(n);
    if(keep[0]!==0||keep[keep.length-1]!==run.vertices.length-1)throw Error(`${spec.id}: spans do not run from the first to the last vertex`);
    for(let j=0;j<keep.length-1;j++){
      const a=keep[j],b=keep[j+1];if(!(b>a))throw Error(`${spec.id}: spans out of order`);
      const rec={endpoint:W.record([run.edges[a],run.edges[b-1]]),ecdp:W.record(run.edges.slice(a,b))};spans++;
      for(let k=a;k<b;k++){
        if(seen[k]++)throw Error(`${spec.id}: edge ${k} in more than one span`);
        const p=run.vertices[k],r=run.vertices[k+1],len=Math.hypot(r.x-p.x,r.y-p.y),e=run.edges[k];
        for(const t of THR){
          const f=W.passesAt(t),ok=f(e.typed.M,A.unionProv([e])),o=out[t];
          o.scored+=len;if(ok)o.qualifying+=len;
          for(const m of METHODS){const acc=f(rec[m].measuredSupport,new Set(rec[m].provenance));
            o[m][acc?(ok?'ca':'fa'):(ok?'wr':'cr')]+=len;}
        }
      }
    }
    for(let k=0;k<n;k++)if(seen[k]!==1)throw Error(`${spec.id}: edge ${k} in no span`);
    edges+=n;
  }
  for(const t of THR){const o=out[t];
    for(const m of METHODS){const s=o[m].ca+o[m].fa+o[m].wr+o[m].cr;
      if(Math.abs(s-o.scored)>EPS)throw Error(`${spec.id}: lengths do not sum (${m}, t=${t})`);
      if(Math.abs(o[m].ca+o[m].wr-o.qualifying)>EPS)throw Error(`${spec.id}: qualifying length differs (${m}, t=${t})`);}}
  return{edges,spans,out};
}

function xorshift32(seed){let s=seed>>>0;return()=>{s^=s<<13;s>>>=0;s^=s>>>17;s^=s<<5;s>>>=0;return s/4294967296;};}
function quant(v,q){if(!v.length)return null;const s=[...v].sort((a,b)=>a-b),h=(s.length-1)*q,lo=Math.floor(h);return s[lo]+(h-lo)*(s[Math.min(lo+1,s.length-1)]-s[lo]);}
const r2=x=>x==null?null:Math.round(x*100)/100;

const crops=[];
for(const u of state.units){
  if(u.status!=='valid')continue;const a=u.attempts[u.attempts.length-1];
  const spec={id:a.id,label:a.id,file:path.join(rel,a.file),kind:'f32',offsetX:a.originX,offsetY:a.originY,grid:{originH1:a.originX,originH2:a.originY,cols:100,rows:100,cellSizeM:1}};
  let r;try{r=scoreCrop(spec);}catch(e){if(/no contour|Cannot read/.test(String(e)))r=null;else throw e;}
  crops.push({id:a.id,unit:u.unit,...(r||{edges:0,spans:0,out:null})});
}
// measures from summed lengths of a set of crops
function measures(set,t){
  const sum=k=>set.reduce((s,c)=>s+(c.out?k(c.out[t]):0),0),scored=sum(o=>o.scored),q=sum(o=>o.qualifying),res={scoredM:scored,qualifyingM:q};
  for(const m of METHODS){res[m]={falseAcceptPerKm:scored?1000*sum(o=>o[m].fa)/scored:null,wrongRejectPerKm:scored?1000*sum(o=>o[m].wr)/scored:null,retentionPct:q?100*sum(o=>o[m].ca)/q:null};}
  return res;
}
const rng=xorshift32(20261109),scoredCrops=crops.filter(c=>c.out),summary={};
for(const t of THR){
  const pooled=measures(scoredCrops,t),per=scoredCrops.map(c=>measures([c],t));
  const boot={endpoint:{fa:[],wr:[],ret:[]},ecdp:{fa:[],wr:[],ret:[]},diff:{fa:[],wr:[],ret:[]}};
  for(let b=0;b<REPS;b++){
    const smp=scoredCrops.map(()=>scoredCrops[Math.floor(rng()*scoredCrops.length)]),M=measures(smp,t);
    for(const m of METHODS){boot[m].fa.push(M[m].falseAcceptPerKm);boot[m].wr.push(M[m].wrongRejectPerKm);if(M[m].retentionPct!=null)boot[m].ret.push(M[m].retentionPct);}
    boot.diff.fa.push(M.ecdp.falseAcceptPerKm-M.endpoint.falseAcceptPerKm);boot.diff.wr.push(M.ecdp.wrongRejectPerKm-M.endpoint.wrongRejectPerKm);
    if(M.ecdp.retentionPct!=null)boot.diff.ret.push(M.ecdp.retentionPct-M.endpoint.retentionPct);
  }
  const ci=v=>[r2(quant(v,.025)),r2(quant(v,.975))];
  const typical=(m,k)=>{const v=per.map(x=>x[m][k]).filter(x=>x!=null);return{median:r2(quant(v,.5)),q1:r2(quant(v,.25)),q3:r2(quant(v,.75)),crops:v.length};};
  summary[t]={crops:scoredCrops.length,cropsWithQualifyingLength:per.filter(x=>x.qualifyingM>0).length,cropsRetentionUndefined:per.filter(x=>x.qualifyingM===0).length,
    scoredKm:r2(pooled.scoredM/1000),qualifyingKm:r2(pooled.qualifyingM/1000),
    pooled:Object.fromEntries(METHODS.map(m=>[m,{falseAcceptPerKm:r2(pooled[m].falseAcceptPerKm),falseAccept95:ci(boot[m].fa),wrongRejectPerKm:r2(pooled[m].wrongRejectPerKm),wrongReject95:ci(boot[m].wr),retentionPct:r2(pooled[m].retentionPct),retention95:ci(boot[m].ret)}])),
    pooledDifferenceEcdpMinusEndpoint:{falseAcceptPerKm:r2(pooled.ecdp.falseAcceptPerKm-pooled.endpoint.falseAcceptPerKm),falseAccept95:ci(boot.diff.fa),
      wrongRejectPerKm:r2(pooled.ecdp.wrongRejectPerKm-pooled.endpoint.wrongRejectPerKm),wrongReject95:ci(boot.diff.wr),
      retentionPctPoints:r2(pooled.ecdp.retentionPct-pooled.endpoint.retentionPct),retention95:ci(boot.diff.ret)},
    typicalCrop:Object.fromEntries(METHODS.map(m=>[m,{falseAcceptPerKm:typical(m,'falseAcceptPerKm'),wrongRejectPerKm:typical(m,'wrongRejectPerKm'),retentionPct:typical(m,'retentionPct')}])),
    cropsWithFalseAcceptance:Object.fromEntries(METHODS.map(m=>[m,per.filter(x=>x[m].falseAcceptPerKm>0).length]))};
}
const outFile={driver:'attribute query on the probability sample',rules:'docs/RULES_ADDITIONAL_TESTS.md, D5',
  coverage:{crops:crops.length,cropsScored:scoredCrops.length,sourceEdges:crops.reduce((s,c)=>s+c.edges,0),spans:crops.reduce((s,c)=>s+c.spans,0),
    everyEdgeInExactlyOneSpan:true,lengthsSum:true,qualifyingLengthsMatch:true},
  summary,crops:crops.map(c=>({id:c.id,unit:c.unit,edges:c.edges,spans:c.spans,
    t66:c.out?{scoredM:r2(c.out[66].scored),qualifyingM:r2(c.out[66].qualifying),endpoint:Object.fromEntries(Object.entries(c.out[66].endpoint).map(([k,v])=>[k,r2(v)])),ecdp:Object.fromEntries(Object.entries(c.out[66].ecdp).map(([k,v])=>[k,r2(v)]))}:null,
    t33:c.out?{scoredM:r2(c.out[33].scored),qualifyingM:r2(c.out[33].qualifying),endpoint:Object.fromEntries(Object.entries(c.out[33].endpoint).map(([k,v])=>[k,r2(v)])),ecdp:Object.fromEntries(Object.entries(c.out[33].ecdp).map(([k,v])=>[k,r2(v)]))}:null}))};
fs.writeFileSync(path.join(ROOT,'results','query_sample_r1.json'),JSON.stringify(outFile,null,1)+'\n');
console.log(JSON.stringify({coverage:outFile.coverage,summary},null,1));
