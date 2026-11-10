#!/usr/bin/env node
'use strict';
/**
 * Held-out ground check. Rules written before the first run (9 November 2026):
 *  - Split. Each crop's ground returns are split in file order by a seeded generator (mulberry32):
 *    a return goes to the BUILD half if the draw is < 0.5, else to the HELD-OUT half. Seeds 1..20.
 *    The grid is the paper's grid for the crop (for Marsh Island, the grid aligned on all returns).
 *  - Build. Terrain, support, contours, feature runs and one-cell DP are produced from the BUILD half
 *    only, with the production modules. This is a half-density terrain, not the paper's terrain; its
 *    counts are reported and never mixed with the main tables.
 *  - Cell error. For a cell holding at least one held-out return, e = |mean held-out z - terrain z|.
 *  - Edge error. RMS of e over the cells of the edge's 2x2 block that hold held-out returns; an edge
 *    with no such cell is skipped.
 *  - Q1 (does support order error?). RMSE of e by cell class: measured solid (>=66), measured dashed
 *    (>=33), measured gap, interpolated; and Spearman rho between support and e over all such cells.
 *  - Q2 (is the hidden part worse?). For each DP span whose endpoint record is promoted, hidden edges
 *    are the replaced edges whose typed support is below the endpoint record in a promoted channel;
 *    end edges are the two the record reads. Per span: mean hidden edge error vs mean end edge error.
 *    Reported: spans with data, share with hidden > end, median of (hidden - end), median ratio.
 *  - Q3 (which record ranks spans better?). Span error = largest edge error over the replaced edges.
 *    Spans the endpoint record grades solid are split into those EC-DP also grades solid and those
 *    it downgrades; median span error of each group and their ratio.
 *  - Each statistic is computed per seed; the median and the range over the 20 seeds are reported.
 *    Every outcome is reported, whichever way it falls.
 */
const fs=require('node:fs');
const path=require('node:path');
const A=require('./reconstruct_ablation.cjs');
const {rasterizeDtm}=require('../real-data-audit/dist/src/terrain/ground/rasterizeDtm.js');
const {buildDtmGrid,EVIDENCE_THRESHOLDS}=require('../real-data-audit/dist/src/terrain/ground/cellConfidence.js');
const {contoursAt}=require('../real-data-audit/dist/src/terrain/contour/contoursAt.js');
const {stitchContourSet}=require('../real-data-audit/dist/src/terrain/contour/stitchContours.js');
const ROOT=path.resolve(__dirname,'..');
const SOLID=EVIDENCE_THRESHOLDS.solid,DASHED=EVIDENCE_THRESHOLDS.dashed,SEEDS=20,CH=['M','I'];
function mulberry32(a){return()=>{a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
function qkey(x,y,q){return`${Math.round(x/q)}:${Math.round(y/q)}`;}
function ekey(a,b,q){const x=qkey(a[0],a[1],q),y=qkey(b[0],b[1],q);return x<y?`${x}|${y}`:`${y}|${x}`;}
function runsFrom(points,grid){ // as worked_example.siteRuns, on a given set of returns
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

function oneSeed(spec,seed){
  const{points,grid}=A.loadDataset(spec),rnd=mulberry32(seed),build=[],held=[];
  for(const p of points)(rnd()<0.5?build:held).push(p);
  const{dtm,runs}=runsFrom(build,grid),e=heldoutError(dtm,grid,held),tol=grid.cellSizeM;
  // Q1
  const g={measuredSolid:[],measuredDashed:[],measuredGap:[],interpolated:[]},sup=[],err=[];
  for(let i=0;i<e.length;i++){if(!Number.isFinite(e[i]))continue;const c=dtm.confidence[i];sup.push(c);err.push(e[i]);
    if(dtm.coverage[i]===2)g[{solid:'measuredSolid',dashed:'measuredDashed',gap:'measuredGap'}[cls(c)]].push(e[i]);else g.interpolated.push(e[i]);}
  const edgeErr=ed=>{const v=ed.ids.map(i=>e[i]).filter(Number.isFinite);return v.length?rmse(v):NaN;};
  // Q2, Q3
  let spans=0,promoted=0,q2n=0,q2worse=0;const q2diff=[],q2ratio=[],kept=[],down=[];
  for(const run of runs){const keep=A.dpIndices(run.vertices,tol),ee=run.edges.map(edgeErr);
    for(let j=0;j<keep.length-1;j++){const a=keep[j],b=keep[j+1];spans++;
      const hidden=new Set();let epAll=Infinity,ecAll=Infinity;
      for(const ch of CH){const ends=[run.edges[a].typed[ch],run.edges[b-1].typed[ch]].filter(x=>x!=null);const arc=[];for(let k=a;k<b;k++){const v=run.edges[k].typed[ch];if(v!=null)arc.push(v);}
        if(arc.length)ecAll=Math.min(ecAll,...arc);if(!ends.length)continue;const ep=Math.min(...ends);epAll=Math.min(epAll,ep);
        if(ep>Math.min(...arc)+1e-12)for(let k=a+1;k<b-1;k++){const v=run.edges[k].typed[ch];if(v!=null&&v<ep-1e-12)hidden.add(k);}}
      if(hidden.size){promoted++;const h=[...hidden].map(k=>ee[k]).filter(Number.isFinite),en=[ee[a],ee[b-1]].filter(Number.isFinite);
        if(h.length&&en.length){const mh=h.reduce((s,v)=>s+v,0)/h.length,me=en.reduce((s,v)=>s+v,0)/en.length;q2n++;if(mh>me)q2worse++;q2diff.push(mh-me);if(me>0)q2ratio.push(mh/me);}}
      if(epAll>=SOLID&&epAll<Infinity){const all=ee.slice(a,b).filter(Number.isFinite);if(all.length)(ecAll>=SOLID?kept:down).push(Math.max(...all));}
    }}
  return{buildReturns:build.length,heldReturns:held.length,cellsScored:err.length,
    rmseMeasuredSolid:rmse(g.measuredSolid),rmseMeasuredDashed:rmse(g.measuredDashed),rmseMeasuredGap:rmse(g.measuredGap),rmseInterpolated:rmse(g.interpolated),
    nMeasuredSolid:g.measuredSolid.length,nMeasuredDashed:g.measuredDashed.length,nMeasuredGap:g.measuredGap.length,nInterpolated:g.interpolated.length,
    spearmanSupportError:spearman(sup,err),
    spans,promotedSpansWithInteriorHidden:promoted,q2Spans:q2n,q2ShareHiddenWorsePct:q2n?100*q2worse/q2n:null,q2MedianDiffM:med(q2diff),q2MedianRatio:med(q2ratio),
    q3SolidKept:kept.length,q3SolidDowngraded:down.length,q3MedianErrKeptM:med(kept),q3MedianErrDowngradedM:med(down),q3Ratio:kept.length&&down.length&&med(kept)>0?med(down)/med(kept):null};
}
const sites=[];
for(const spec of A.DATASETS){
  const per=[];for(let s=1;s<=SEEDS;s++)per.push(oneSeed(spec,s));
  const row={site:spec.label};
  for(const k of Object.keys(per[0])){const v=per.map(p=>p[k]).filter(x=>x!=null&&Number.isFinite(x));if(!v.length){row[k]=null;continue;}
    const r=x=>+x.toFixed(4);row[k]={median:r(med(v)),min:r(Math.min(...v)),max:r(Math.max(...v)),seeds:v.length};}
  sites.push(row);
}
const out={driver:'held-out ground check on half-density terrain',seeds:SEEDS,split:'mulberry32(seed), build if draw < 0.5',thresholds:{solid:SOLID,dashed:DASHED},sites};
fs.writeFileSync(path.join(ROOT,'results','heldout_check_r1.json'),JSON.stringify(out,null,1)+'\n');
for(const s of sites){console.log('\n'+s.site);for(const[k,v]of Object.entries(s))if(k!=='site')console.log(' ',k.padEnd(34),v?`${v.median}  [${v.min}, ${v.max}]  n=${v.seeds}`:'-');}
