#!/usr/bin/env node
'use strict';
/**
 * Held-out ground check on the scale-test crops. Rules fixed before the first run
 * (docs/RULES_ADDITIONAL_TESTS.md, section D2):
 *  - Crops. Every crop with status "scored" in results/scale_test_r1.json. Grid: the crop's
 *    100 x 100 cells of 1 m. Seeds 1 to 5.
 *  - Split, build, cell error, edge error, hidden edges, end edges and questions 1 to 3 are those of
 *    ablation/heldout_check.cjs, unchanged: ground returns are split in file order by mulberry32(seed)
 *    (build if the draw is < 0.5, else held out); terrain, support, contours, feature runs and
 *    one-cell DP come from the build half only; cell error e = |mean held-out z - terrain z| for a
 *    cell holding at least one held-out return; edge error = RMS of e over the cells of the edge's
 *    2x2 block that hold held-out returns (an edge with none is skipped); for a DP span whose
 *    endpoint record is promoted, hidden edges are the replaced edges whose typed support is below
 *    the endpoint record in a promoted channel and end edges are the two the record reads.
 *  - Primary statistic (question 2). For each promoted span with held-out data on at least one hidden
 *    edge and at least one end edge, d = mean hidden-edge error - mean end-edge error. Spans are
 *    pooled over crops within a seed. S = share of spans with d > 0. Uncertainty: 2,000 bootstrap
 *    replicates resampling whole crops (xorshift32, seed 20261109), 2.5 and 97.5 percentiles.
 *    Reported: the median over seeds of S and of each interval bound, the number of spans, the median
 *    of d and the median ratio hidden/end.
 *  - Reading. Interval wholly above 50 %: hidden segments have larger held-out error than the end
 *    segments the record reads. Interval contains 50 %: the data do not show a difference. Interval
 *    wholly below 50 %: hidden segments have smaller error.
 *  - Question 1, per crop: number of crops in which RMSE rises from measured cells at or above 66 to
 *    33-66 to below 33, among crops with at least 30 cells in each class; median and interquartile
 *    range of Spearman's rho between support and e.
 *  - Question 3, pooled as question 2: share of endpoint-solid spans that EC-DP downgrades whose
 *    largest edge error exceeds the pooled median of those it keeps, with the same bootstrap.
 *  - Sensitivity: the same without the two parent tiles of the paper's crops.
 *
 * Choices made where the rules are silent (all fixed before the first run):
 *  - The bootstrap resamples all crops used (not only those contributing spans); the generator is
 *    restarted from seed 20261109 for each split seed and each crop set; a crop index is
 *    floor(u * nCrops) with u = state / 2^32; the same crop draws serve questions 2 and 3.
 *  - Percentiles and quartiles use linear interpolation between order statistics, as scale_test.cjs.
 *  - In a question-3 replicate the median of the kept spans is recomputed from the resampled crops.
 *  - "Rises" means strictly: RMSE(>=66) < RMSE(33-66) < RMSE(<33).
 *  - The ratio hidden/end is taken over spans whose mean end-edge error is > 0, as heldout_check.cjs.
 *  - Question 1 is computed per seed and the median over seeds is reported.
 *
 * Usage: node scale/heldout_scale.cjs
 */
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const A=require('../ablation/reconstruct_ablation.cjs');
const {rasterizeDtm}=require('../real-data-audit/dist/src/terrain/ground/rasterizeDtm.js');
const {buildDtmGrid,EVIDENCE_THRESHOLDS}=require('../real-data-audit/dist/src/terrain/ground/cellConfidence.js');
const {contoursAt}=require('../real-data-audit/dist/src/terrain/contour/contoursAt.js');
const {stitchContourSet}=require('../real-data-audit/dist/src/terrain/contour/stitchContours.js');
const ROOT=path.resolve(__dirname,'..');
const DIR=path.join(__dirname,'crops');
const SOLID=EVIDENCE_THRESHOLDS.solid,DASHED=EVIDENCE_THRESHOLDS.dashed,CH=['M','I'];
const SEEDS=[1,2,3,4,5],SIZE=100,BOOT=2000,BOOT_SEED=20261109,MIN_CLASS_CELLS=30;
const PARENTS=new Set(['white-sands-parent','estonia-parent']);

// ---- copied unchanged from ablation/heldout_check.cjs ----
function mulberry32(a){return()=>{a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
function qkey(x,y,q){return`${Math.round(x/q)}:${Math.round(y/q)}`;}
function ekey(a,b,q){const x=qkey(a[0],a[1],q),y=qkey(b[0],b[1],q);return x<y?`${x}|${y}`:`${y}|${x}`;}
function runsFrom(points,grid){
  const raster=rasterizeDtm(points,new Uint8Array(points.length).fill(1),{grid,aggregation:'mean'});
  const dtm=buildDtmGrid(raster),cs=contoursAt(dtm,{intervalM:grid.cellSizeM}),metas=A.sourceBlocksForSegments(dtm,cs),stitched=stitchContourSet(cs,grid.cellSizeM);
  const q=grid.cellSizeM*1e-3,runs=[];
  for(let li=0;li<stitched.length;li++){
    const queues=A.buildEdgeQueues(cs.levels[li],metas[li],q,dtm),cellQ=new Map();
    cs.levels[li].segments.forEach((s,i)=>{const k=ekey([s.x1,s.y1],[s.x2,s.y2],q);if(!cellQ.has(k))cellQ.set(k,[]);cellQ.get(k).push(metas[li][i].ids);});
    for(const poly of stitched[li].polylines){
      const att=A.attachEdges(poly,queues,q);
      att.edges.forEach((e,i)=>{const v=att.vertices;e.ids=cellQ.get(ekey([v[i].x,v[i].y],[v[i+1].x,v[i+1].y],q)).shift();});
      for(const run of A.splitFeatureRuns(att))if(run.vertices.length>=2)runs.push(run);
    }
  }
  return{dtm,runs};
}
function heldoutError(dtm,grid,held){
  const{cols,rows,cellSizeM,originH1,originH2}=grid,sum=new Float64Array(cols*rows),n=new Uint32Array(cols*rows);
  for(const p of held){const fx=(p.x-originH1)/cellSizeM,fy=(p.y-originH2)/cellSizeM;if(fx<0||fx>=cols||fy<0||fy>=rows)continue;const c=Math.floor(fy)*cols+Math.floor(fx);sum[c]+=p.z;n[c]++;}
  const e=new Float64Array(cols*rows).fill(NaN);
  for(let i=0;i<e.length;i++)if(n[i]&&dtm.coverage[i]>0&&Number.isFinite(dtm.z[i]))e[i]=Math.abs(sum[i]/n[i]-dtm.z[i]);
  return e;
}
const med=x=>{const s=x.filter(Number.isFinite).sort((a,b)=>a-b);return s.length?(s.length%2?s[(s.length-1)/2]:(s[s.length/2-1]+s[s.length/2])/2):null;};
const rmse=x=>x.length?Math.sqrt(x.reduce((s,v)=>s+v*v,0)/x.length):null;
function ranks(x){const o=x.map((v,i)=>[v,i]).sort((a,b)=>a[0]-b[0]),r=new Array(x.length);for(let i=0;i<o.length;){let j=i;while(j+1<o.length&&o[j+1][0]===o[i][0])j++;const m=(i+j)/2+1;for(let k=i;k<=j;k++)r[o[k][1]]=m;i=j+1;}return r;}
function spearman(a,b){if(a.length<3)return null;const ra=ranks(a),rb=ranks(b),n=a.length,ma=(n+1)/2;let sab=0,saa=0,sbb=0;for(let i=0;i<n;i++){sab+=(ra[i]-ma)*(rb[i]-ma);saa+=(ra[i]-ma)**2;sbb+=(rb[i]-ma)**2;}return saa&&sbb?sab/Math.sqrt(saa*sbb):null;}
const cls=v=>v>=SOLID?'solid':v>=DASHED?'dashed':'gap';

// One crop, one seed. The span loop is that of heldout_check.cjs oneSeed; it returns the per-span
// values instead of the per-site summaries so that spans can be pooled over crops.
function oneSeed(spec,seed){
  const{points,grid}=A.loadDataset(spec),rnd=mulberry32(seed),build=[],held=[];
  for(const p of points)(rnd()<0.5?build:held).push(p);
  const{dtm,runs}=runsFrom(build,grid),e=heldoutError(dtm,grid,held),tol=grid.cellSizeM;
  const g={measuredSolid:[],measuredDashed:[],measuredGap:[],interpolated:[]},sup=[],err=[];
  for(let i=0;i<e.length;i++){if(!Number.isFinite(e[i]))continue;const c=dtm.confidence[i];sup.push(c);err.push(e[i]);
    if(dtm.coverage[i]===2)g[{solid:'measuredSolid',dashed:'measuredDashed',gap:'measuredGap'}[cls(c)]].push(e[i]);else g.interpolated.push(e[i]);}
  const edgeErr=ed=>{const v=ed.ids.map(i=>e[i]).filter(Number.isFinite);return v.length?rmse(v):NaN;};
  let spans=0,promoted=0;const q2diff=[],q2ratio=[],kept=[],down=[];
  for(const run of runs){const keep=A.dpIndices(run.vertices,tol),ee=run.edges.map(edgeErr);
    for(let j=0;j<keep.length-1;j++){const a=keep[j],b=keep[j+1];spans++;
      const hidden=new Set();let epAll=Infinity,ecAll=Infinity;
      for(const ch of CH){const ends=[run.edges[a].typed[ch],run.edges[b-1].typed[ch]].filter(x=>x!=null);const arc=[];for(let k=a;k<b;k++){const v=run.edges[k].typed[ch];if(v!=null)arc.push(v);}
        if(arc.length)ecAll=Math.min(ecAll,...arc);if(!ends.length)continue;const ep=Math.min(...ends);epAll=Math.min(epAll,ep);
        if(ep>Math.min(...arc)+1e-12)for(let k=a+1;k<b-1;k++){const v=run.edges[k].typed[ch];if(v!=null&&v<ep-1e-12)hidden.add(k);}}
      if(hidden.size){promoted++;const h=[...hidden].map(k=>ee[k]).filter(Number.isFinite),en=[ee[a],ee[b-1]].filter(Number.isFinite);
        if(h.length&&en.length){const mh=h.reduce((s,v)=>s+v,0)/h.length,me=en.reduce((s,v)=>s+v,0)/en.length;q2diff.push(mh-me);if(me>0)q2ratio.push(mh/me);}}
      if(epAll>=SOLID&&epAll<Infinity){const all=ee.slice(a,b).filter(Number.isFinite);if(all.length)(ecAll>=SOLID?kept:down).push(Math.max(...all));}
    }}
  return{buildReturns:build.length,heldReturns:held.length,cellsScored:err.length,spans,promoted,
    n:{solid:g.measuredSolid.length,dashed:g.measuredDashed.length,gap:g.measuredGap.length,interpolated:g.interpolated.length},
    rmse:{solid:rmse(g.measuredSolid),dashed:rmse(g.measuredDashed),gap:rmse(g.measuredGap),interpolated:rmse(g.interpolated)},
    rho:spearman(sup,err),q2diff,q2ratio,kept,down};
}

// ---- pooling and bootstrap ----
function xorshift32(seed){let s=seed>>>0;return()=>{s^=s<<13;s>>>=0;s^=s>>>17;s^=s<<5;s>>>=0;return s/4294967296;};}
function quant(v,q){if(!v.length)return null;const s=[...v].sort((a,b)=>a-b),h=(s.length-1)*q,lo=Math.floor(h);return s[lo]+(h-lo)*(s[Math.min(lo+1,s.length-1)]-s[lo]);}
const r4=x=>x==null||!Number.isFinite(x)?null:+x.toFixed(4);
const r6=x=>x==null||!Number.isFinite(x)?null:+x.toFixed(6);
// value at 0-based rank k of the multiset in which item i (sorted by value) is repeated w[crop[i]] times
function weightedMedian(vals,crop,w,total){
  if(!total)return null;const k2=Math.floor(total/2),k1=total%2?k2:k2-1;let cum=0,v1=null;
  for(let i=0;i<vals.length;i++){const c=w[crop[i]];if(!c)continue;cum+=c;if(v1===null&&cum>k1)v1=vals[i];if(cum>k2)return(v1+vals[i])/2;}
  return null;
}
function sortedWithCrop(rows,key){const a=[];rows.forEach((r,ci)=>{for(const v of r[key])a.push([v,ci]);});a.sort((x,y)=>x[0]-y[0]||x[1]-y[1]);return{vals:Float64Array.from(a,x=>x[0]),crop:Int32Array.from(a,x=>x[1])};}
function reading(lo,hi){if(lo==null||hi==null)return'no interval';if(lo>50)return'hidden segments have larger held-out error than the end segments the record reads';if(hi<50)return'hidden segments have smaller error';return'the data do not show a difference';}

// rows: per-crop results of oneSeed for one split seed
function pooledSeed(rows){
  const nC=rows.length,q2n=rows.map(r=>r.q2diff.length),q2w=rows.map(r=>r.q2diff.filter(d=>d>0).length);
  const N=q2n.reduce((s,v)=>s+v,0),Wn=q2w.reduce((s,v)=>s+v,0);
  const K=sortedWithCrop(rows,'kept'),D=sortedWithCrop(rows,'down');
  const ones=new Int32Array(nC).fill(1),mk=weightedMedian(K.vals,K.crop,ones,K.vals.length);
  let above=0;if(mk!=null)for(let i=0;i<D.vals.length;i++)if(D.vals[i]>mk)above++;
  const rnd=xorshift32(BOOT_SEED),bS=[],bQ3=[],w=new Int32Array(nC);
  for(let b=0;b<BOOT;b++){
    w.fill(0);for(let i=0;i<nC;i++)w[Math.floor(rnd()*nC)]++;
    let n=0,ww=0;for(let i=0;i<nC;i++){n+=w[i]*q2n[i];ww+=w[i]*q2w[i];}
    if(n)bS.push(100*ww/n);
    let kt=0;for(let i=0;i<nC;i++)kt+=w[i]*rows[i].kept.length;
    const m=weightedMedian(K.vals,K.crop,w,kt);
    if(m!=null){let dn=0,da=0;for(let i=0;i<D.vals.length;i++){const c=w[D.crop[i]];if(!c)continue;dn+=c;if(D.vals[i]>m)da+=c;}if(dn)bQ3.push(100*da/dn);}
  }
  const mdown=med([...D.vals]);
  return{
    q2:{spans:N,cropsWithSpans:q2n.filter(v=>v>0).length,spansHiddenWorse:Wn,sharePct:N?r4(100*Wn/N):null,
      ciLowPct:r4(quant(bS,.025)),ciHighPct:r4(quant(bS,.975)),bootstrapReplicatesUsed:bS.length,
      medianDiffM:r6(med(rows.flatMap(r=>r.q2diff))),medianRatio:r4(med(rows.flatMap(r=>r.q2ratio))),
      promotedSpansWithInteriorHidden:rows.reduce((s,r)=>s+r.promoted,0),dpSpans:rows.reduce((s,r)=>s+r.spans,0)},
    q3:{solidKept:K.vals.length,solidDowngraded:D.vals.length,medianErrKeptM:r6(mk),medianErrDowngradedM:r6(mdown),
      ratioOfMedians:mk>0&&mdown!=null?r4(mdown/mk):null,downgradedAboveKeptMedian:above,
      sharePct:D.vals.length&&mk!=null?r4(100*above/D.vals.length):null,
      ciLowPct:r4(quant(bQ3,.025)),ciHighPct:r4(quant(bQ3,.975)),bootstrapReplicatesUsed:bQ3.length},
    q1:(()=>{const elig=rows.filter(r=>r.n.solid>=MIN_CLASS_CELLS&&r.n.dashed>=MIN_CLASS_CELLS&&r.n.gap>=MIN_CLASS_CELLS);
      const rho=rows.map(r=>r.rho).filter(v=>v!=null&&Number.isFinite(v));
      return{cropsEligible:elig.length,cropsRmseRises:elig.filter(r=>r.rmse.solid<r.rmse.dashed&&r.rmse.dashed<r.rmse.gap).length,
        cropsWithRho:rho.length,rhoMedian:r4(quant(rho,.5)),rhoQ1:r4(quant(rho,.25)),rhoQ3:r4(quant(rho,.75)),cropsRhoNegative:rho.filter(v=>v<0).length};})(),
  };
}
function overSeeds(perSeed){
  const m=(sec,k)=>{const v=perSeed.map(p=>p[sec][k]).filter(x=>x!=null);return v.length?r6(med(v)):null;};
  const sec=(name,keys)=>Object.fromEntries(keys.map(k=>[k,m(name,k)]));
  const q2=sec('q2',['sharePct','ciLowPct','ciHighPct','spans','cropsWithSpans','medianDiffM','medianRatio']);
  const q3=sec('q3',['sharePct','ciLowPct','ciHighPct','solidKept','solidDowngraded','medianErrKeptM','medianErrDowngradedM','ratioOfMedians']);
  const q1=sec('q1',['cropsEligible','cropsRmseRises','cropsWithRho','rhoMedian','rhoQ1','rhoQ3','cropsRhoNegative']);
  return{q2:{...q2,reading:reading(q2.ciLowPct,q2.ciHighPct)},q1,q3};
}
function block(cropRows,data){ // data[seedIndex][cropIndex]
  const perSeed=SEEDS.map((s,si)=>({seed:s,...pooledSeed(data[si])}));
  for(const p of perSeed)p.q2.reading=reading(p.q2.ciLowPct,p.q2.ciHighPct);
  return{crops:cropRows.length,medianOverSeeds:overSeeds(perSeed),perSeed};
}

// ---- run ----
const t0=Date.now();
const scored=JSON.parse(fs.readFileSync(path.join(ROOT,'results','scale_test_r1.json'),'utf8')).crops.filter(c=>c.status==='scored');
const index=new Map(JSON.parse(fs.readFileSync(path.join(DIR,'index.json'),'utf8')).map(c=>[c.id,c]));
const rel=path.relative(path.join(ROOT,'real-data-audit','crops'),DIR);
const data=SEEDS.map(()=>[]),perCrop=[];
for(const row of scored){
  const c=index.get(row.id);if(!c)throw Error(`crop ${row.id} not in index`);
  if(crypto.createHash('sha256').update(fs.readFileSync(path.join(DIR,c.file))).digest('hex')!==row.sha256)throw Error(`digest mismatch ${row.id}`);
  const spec={id:c.id,label:c.id,file:path.join(rel,c.file),kind:'f32',offsetX:c.originX,offsetY:c.originY,grid:{originH1:c.originX,originH2:c.originY,cols:SIZE,rows:SIZE,cellSizeM:1}};
  const out={id:row.id,survey:row.survey,q2Spans:[],q2HiddenWorse:[],q3Kept:[],q3Downgraded:[],rho:[],nSolid:[],nDashed:[],nGap:[],rmseSolid:[],rmseDashed:[],rmseGap:[]};
  SEEDS.forEach((s,si)=>{const r=oneSeed(spec,s);data[si].push(r);
    out.q2Spans.push(r.q2diff.length);out.q2HiddenWorse.push(r.q2diff.filter(d=>d>0).length);out.q3Kept.push(r.kept.length);out.q3Downgraded.push(r.down.length);
    out.rho.push(r4(r.rho));out.nSolid.push(r.n.solid);out.nDashed.push(r.n.dashed);out.nGap.push(r.n.gap);
    out.rmseSolid.push(r4(r.rmse.solid));out.rmseDashed.push(r4(r.rmse.dashed));out.rmseGap.push(r4(r.rmse.gap));});
  perCrop.push(out);process.stderr.write(`${row.id} q2 spans ${out.q2Spans.join(' ')}\n`);
}
const keepIdx=scored.map((r,i)=>PARENTS.has(r.survey)?-1:i).filter(i=>i>=0);
const all=block(scored,data),noParents=block(keepIdx.map(i=>scored[i]),data.map(d=>keepIdx.map(i=>d[i])));
const out={driver:'held-out ground check on the scale-test crops',rules:'docs/RULES_ADDITIONAL_TESTS.md, section D2',
  rulesSummary:{crops:'status "scored" in results/scale_test_r1.json; grid 100 x 100 cells of 1 m',
    definitions:'split, build, cell error, edge error, hidden edges, end edges and questions 1-3 as in ablation/heldout_check.cjs',
    split:'mulberry32(seed), build if draw < 0.5',
    primary:'question 2: d = mean hidden-edge error - mean end-edge error per promoted span with held-out data on both; spans pooled over crops within a seed; S = share with d > 0',
    bootstrap:`${BOOT} replicates resampling whole crops, xorshift32 seed ${BOOT_SEED} (restarted per split seed and crop set), 2.5 and 97.5 percentiles by linear interpolation`,
    reading:'interval wholly above 50 %: hidden larger; contains 50 %: no difference shown; wholly below 50 %: hidden smaller',
    question1:`crops with at least ${MIN_CLASS_CELLS} measured cells in each class; rise is strict; Spearman rho between support and cell error per crop`,
    question3:'share of endpoint-solid spans EC-DP downgrades whose largest edge error exceeds the pooled median of those it keeps (median recomputed in each replicate)',
    reported:'median over seeds of each per-seed value',sensitivity:'the same without surveys white-sands-parent and estonia-parent'},
  seeds:SEEDS,thresholds:{solid:SOLID,dashed:DASHED},cropsUsed:scored.map(r=>r.id),
  all,withoutParentTiles:noParents,perCrop};
fs.writeFileSync(path.join(ROOT,'results','heldout_scale_r1.json'),JSON.stringify(out,null,1)+'\n');

const f=(v,n=1)=>v==null?'-':Number(v).toFixed(n);
function show(name,b){
  console.log(`\n${name} (${b.crops} crops)`);
  console.log('seed    spans   S %   [2.5, 97.5]      med d (m)  med ratio | Q1 rises/elig  rho med [q1, q3] | Q3 down  kept  share % [2.5, 97.5]');
  const line=(lab,q2,q1,q3)=>console.log(`${String(lab).padEnd(6)} ${String(q2.spans).padStart(6)}  ${f(q2.sharePct)}  [${f(q2.ciLowPct)}, ${f(q2.ciHighPct)}]  ${f(q2.medianDiffM,4).padStart(9)}  ${f(q2.medianRatio,3).padStart(8)} | ${String(q1.cropsRmseRises).padStart(5)}/${String(q1.cropsEligible).padEnd(5)}   ${f(q1.rhoMedian,3)} [${f(q1.rhoQ1,3)}, ${f(q1.rhoQ3,3)}] | ${String(q3.solidDowngraded).padStart(6)} ${String(q3.solidKept).padStart(6)}  ${f(q3.sharePct)} [${f(q3.ciLowPct)}, ${f(q3.ciHighPct)}]`);
  for(const p of b.perSeed)line(p.seed,p.q2,p.q1,p.q3);
  const m=b.medianOverSeeds;line('median',m.q2,m.q1,m.q3);
  console.log(`reading: ${m.q2.reading}`);
}
show('all scored crops',all);show('without parent tiles',noParents);
process.stderr.write(`runtime ${((Date.now()-t0)/1000).toFixed(1)} s\n`);
