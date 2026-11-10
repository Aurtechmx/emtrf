#!/usr/bin/env node
'use strict';
/**
 * Worked example on real data.
 *
 * Downstream task. A contour layer is exported with per-line attributes and an analyst keeps the
 * lines that are "backed by dense measurement" with one attribute query:
 *     measured support >= 66 (the solid threshold) AND provenance = {M}.
 * The same test applied to each unsimplified source edge is the reference answer.
 *
 * Part 1 (all four sites). For ordinary DP with endpoint attribution and for EC-DP, the contour
 * length the query accepts although one of its source edges fails the test (false acceptance), and
 * the length the query rejects although its source edge passes (over-rejection).
 *
 * Part 2 (one span). The span is chosen by a fixed rule, not by inspection: among all DP spans at
 * the four sites whose endpoint-attributed record passes the query, the one with the largest
 * support promotion (ties: longer span, then site order). Its full trace is written out: the
 * returns in every source cell, the cell supports, each source edge, and the two exported records.
 *
 * Geometry, rasterisation, support and DP are the production modules used by the ablation.
 */
const fs=require('node:fs');
const path=require('node:path');
const A=require('./reconstruct_ablation.cjs');
const {rasterizeDtm}=require('../real-data-audit/dist/src/terrain/ground/rasterizeDtm.js');
const {buildDtmGrid,EVIDENCE_THRESHOLDS}=require('../real-data-audit/dist/src/terrain/ground/cellConfidence.js');
const {contoursAt}=require('../real-data-audit/dist/src/terrain/contour/contoursAt.js');
const {stitchContourSet}=require('../real-data-audit/dist/src/terrain/contour/stitchContours.js');
const ROOT=path.resolve(__dirname,'..');
const SOLID=EVIDENCE_THRESHOLDS.solid;

function qkey(x,y,q){return`${Math.round(x/q)}:${Math.round(y/q)}`;}
function ekey(a,b,q){const x=qkey(a[0],a[1],q),y=qkey(b[0],b[1],q);return x<y?`${x}|${y}`:`${y}|${x}`;}
const passesAt=t=>(m,prov)=>m!=null&&m>=t&&prov.size===1&&prov.has('M');
const passes=passesAt(SOLID);
const THRESHOLDS=[SOLID,EVIDENCE_THRESHOLDS.dashed]; // the two cut-offs the production grade defines
const r2=x=>Math.round(x*100)/100;

function siteRuns(spec){
  const{points,grid}=A.loadDataset(spec);
  const raster=rasterizeDtm(points,new Uint8Array(points.length).fill(1),{grid,aggregation:'mean'});
  const dtm=buildDtmGrid(raster);
  const cs=contoursAt(dtm,{intervalM:grid.cellSizeM});
  const metas=A.sourceBlocksForSegments(dtm,cs);
  const stitched=stitchContourSet(cs,grid.cellSizeM);
  const q=grid.cellSizeM*1e-3,runs=[];
  for(let li=0;li<stitched.length;li++){
    const queues=A.buildEdgeQueues(cs.levels[li],metas[li],q,dtm);
    const cellQ=new Map(); // same key order as buildEdgeQueues, so shift() pairs identically
    cs.levels[li].segments.forEach((s,i)=>{const k=ekey([s.x1,s.y1],[s.x2,s.y2],q);if(!cellQ.has(k))cellQ.set(k,[]);cellQ.get(k).push(metas[li][i].ids);});
    for(const poly of stitched[li].polylines){
      const att=A.attachEdges(poly,queues,q);
      att.edges.forEach((e,i)=>{const v=att.vertices;e.ids=cellQ.get(ekey([v[i].x,v[i].y],[v[i+1].x,v[i+1].y],q)).shift();});
      for(const run of A.splitFeatureRuns(att))if(run.vertices.length>=2)runs.push({...run,level:stitched[li].value});
    }
  }
  return{points,grid,dtm,runs};
}

function record(edges){ // exported attributes of a span from the given edges
  const m=edges.map(e=>e.typed.M).filter(x=>x!=null),i=edges.map(e=>e.typed.I).filter(x=>x!=null);
  return{measuredSupport:m.length?Math.min(...m):null,interpolatedSupport:i.length?Math.min(...i):null,provenance:[...A.unionProv(edges)].sort()};
}

module.exports={siteRuns,record,passesAt,SOLID};
if(require.main===module){
const sites=[],candidates=[],ctxs=[];
A.DATASETS.forEach((spec,si)=>{
  const S=siteRuns(spec),tol=S.grid.cellSizeM;
  const accs=THRESHOLDS.map(t=>({t,f:passesAt(t),total:0,reference:0,dp:{accepted:0,falseAccept:0,overReject:0},ecdp:{accepted:0,falseAccept:0,overReject:0}}));
  S.runs.forEach((run,ri)=>{
    const keep=A.dpIndices(run.vertices,tol);
    for(let j=0;j<keep.length-1;j++){
      const a=keep[j],b=keep[j+1],arc=run.edges.slice(a,b),ends=[run.edges[a],run.edges[b-1]];
      const dpRec=record(ends),ecRec=record(arc);
      let spanLen=0;
      for(let k=a;k<b;k++){const p=run.vertices[k],r=run.vertices[k+1];spanLen+=Math.hypot(r.x-p.x,r.y-p.y);}
      for(const acc of accs){
        const dpPass=acc.f(dpRec.measuredSupport,new Set(dpRec.provenance)),ecPass=acc.f(ecRec.measuredSupport,new Set(ecRec.provenance));
        for(let k=a;k<b;k++){
          const p=run.vertices[k],r=run.vertices[k+1],len=Math.hypot(r.x-p.x,r.y-p.y),e=run.edges[k];
          const ok=acc.f(e.typed.M,A.unionProv([e]));
          acc.total+=len;if(ok)acc.reference+=len;
          for(const[m,pass]of[['dp',dpPass],['ecdp',ecPass]]){if(pass){acc[m].accepted+=len;if(!ok)acc[m].falseAccept+=len;}else if(ok)acc[m].overReject+=len;}
        }
        if(acc.t===SOLID&&dpPass&&dpRec.measuredSupport>ecRec.measuredSupport)
          candidates.push({si,ri,a,b,site:spec.label,promotion:dpRec.measuredSupport-ecRec.measuredSupport,length:spanLen});
      }
    }
  });
  for(const acc of accs){
    const pc=x=>r2(100*x/acc.total);
    sites.push({site:spec.label,threshold:acc.t,contourLengthM:r2(acc.total),referenceAcceptedM:r2(acc.reference),
      dp:{acceptedM:r2(acc.dp.accepted),falseAcceptM:r2(acc.dp.falseAccept),falseAcceptPct:pc(acc.dp.falseAccept),overRejectM:r2(acc.dp.overReject),overRejectPct:pc(acc.dp.overReject)},
      ecdp:{acceptedM:r2(acc.ecdp.accepted),falseAcceptM:r2(acc.ecdp.falseAccept),falseAcceptPct:pc(acc.ecdp.falseAccept),overRejectM:r2(acc.ecdp.overReject),overRejectPct:pc(acc.ecdp.overReject)}});
  }
  ctxs[si]=S;
});

candidates.sort((x,y)=>y.promotion-x.promotion||y.length-x.length||x.si-y.si);
const pick=candidates[0],S=ctxs[pick.si],spec=A.DATASETS[pick.si];
const run=S.runs[pick.ri],{dtm,grid,points}=S,{a,b}=pick,keep=A.dpIndices(run.vertices,grid.cellSizeM);
const cellOf=i=>({col:i%grid.cols,row:Math.floor(i/grid.cols)});
const cellBox=c=>{const{col,row}=cellOf(c);return[grid.originH1+col*grid.cellSizeM,grid.originH2+row*grid.cellSizeM];};
const edges=[];
for(let k=a;k<b;k++){
  const e=run.edges[k],p=run.vertices[k],r=run.vertices[k+1];
  edges.push({index:k-a,from:[p.x,p.y],to:[r.x,r.y],lengthM:Math.hypot(r.x-p.x,r.y-p.y),provenance:e.provenance,
    measuredSupport:e.typed.M,interpolatedSupport:e.typed.I,passesQuery:passes(e.typed.M,A.unionProv([e])),
    cells:e.ids.map(c=>({...cellOf(c),returns:dtm.counts[c],support:dtm.confidence[c],coverage:['none','interpolated','measured'][dtm.coverage[c]],elevationM:dtm.z[c]}))});
}
// Local window for the figure: cells and returns within 3 cells of the span's source cells.
const ids=new Set(edges.flatMap(e=>run.edges[a+e.index].ids));
const cols=[...ids].map(c=>cellOf(c).col),rows=[...ids].map(c=>cellOf(c).row);
const win={col0:Math.max(0,Math.min(...cols)-3),col1:Math.min(grid.cols-1,Math.max(...cols)+3),row0:Math.max(0,Math.min(...rows)-3),row1:Math.min(grid.rows-1,Math.max(...rows)+3)};
const winCells=[];for(let r=win.row0;r<=win.row1;r++)for(let c=win.col0;c<=win.col1;c++){const i=r*grid.cols+c;winCells.push({col:c,row:r,returns:dtm.counts[i],support:dtm.confidence[i],coverage:['none','interpolated','measured'][dtm.coverage[i]],elevationM:dtm.z[i]});}
const [wx0,wy0]=cellBox(win.row0*grid.cols+win.col0),wx1=grid.originH1+(win.col1+1)*grid.cellSizeM,wy1=grid.originH2+(win.row1+1)*grid.cellSizeM;
const winReturns=points.filter(p=>p.x>=wx0&&p.x<wx1&&p.y>=wy0&&p.y<wy1).map(p=>[p.x,p.y,p.z]);
const dpRec=record([run.edges[a],run.edges[b-1]]),ecRec=record(run.edges.slice(a,b));
const weakest=edges.reduce((w,e)=>e.measuredSupport<w.measuredSupport?e:w);
const weakCell=weakest.cells.filter(c=>c.coverage==='measured').reduce((w,c)=>c.support<w.support?c:w);
const out={
  driver:'worked example on real data',
  query:`measured support >= t AND provenance = {M}, t in {${THRESHOLDS}}; the example uses t = ${SOLID}`,
  selectionRule:'largest support promotion among DP spans whose endpoint-attributed record passes the query; ties by longer span, then site order',
  candidates:candidates.length,
  sites,
  example:{site:spec.label,levelM:run.level,cellSizeM:grid.cellSizeM,origin:[grid.originH1,grid.originH2],
    displayGrade:run.grade,sourceEdges:b-a,spanLengthM:r2(pick.length),chordLengthM:r2(Math.hypot(run.vertices[b].x-run.vertices[a].x,run.vertices[b].y-run.vertices[a].y)),
    dpRecord:{...dpRec,passesQuery:passes(dpRec.measuredSupport,new Set(dpRec.provenance))},
    ecdpRecord:{...ecRec,passesQuery:passes(ecRec.measuredSupport,new Set(ecRec.provenance))},
    weakestCell:weakCell,medianReturnsPerMeasuredCell:(()=>{const v=[...dtm.counts].filter(c=>c>0).sort((x,y)=>x-y),m=v.length>>1;return v.length%2?v[m]:(v[m-1]+v[m])/2;})(),
    edges,runVertices:run.vertices.map(v=>[v.x,v.y]),spanVertexRange:[a,b],dpRetained:keep,
    window:{...win,cells:winCells,returns:winReturns}},
};
fs.writeFileSync(path.join(ROOT,'results','worked_example_r2.json'),JSON.stringify(out,null,1)+'\n');
const csv=['site,threshold,contour_length_m,reference_accepted_m,dp_accepted_m,dp_false_accept_m,dp_false_accept_pct,dp_over_reject_m,ecdp_accepted_m,ecdp_false_accept_m,ecdp_over_reject_m,ecdp_over_reject_pct'];
for(const s of sites)csv.push([s.site,s.threshold,s.contourLengthM,s.referenceAcceptedM,s.dp.acceptedM,s.dp.falseAcceptM,s.dp.falseAcceptPct,s.dp.overRejectM,s.ecdp.acceptedM,s.ecdp.falseAcceptM,s.ecdp.overRejectM,s.ecdp.overRejectPct].join(','));
fs.writeFileSync(path.join(__dirname,'worked_example_site_results.csv'),csv.join('\n')+'\n');
console.log(csv.join('\n'));
const E=out.example;
console.log(`\nexample: ${E.site} ${E.levelM} m contour, ${E.sourceEdges} source edges, ${E.spanLengthM} m; DP record ${JSON.stringify(E.dpRecord)}; EC-DP record ${JSON.stringify(E.ecdpRecord)}; weakest cell ${JSON.stringify(E.weakestCell)}; median returns/cell ${E.medianReturnsPerMeasuredCell}; candidates ${out.candidates}`);
}
