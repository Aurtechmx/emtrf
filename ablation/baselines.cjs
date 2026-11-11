#!/usr/bin/env node
'use strict';
/**
 * Alternative-method comparison.
 *
 * Every method receives the same input lines: the strict production feature runs on the four
 * committed crops, with the same per-edge typed evidence used by the P0-P3 ablation. Every method
 * uses the same production Douglas-Peucker distance rule at one source-cell tolerance.
 *
 *   DP          ordinary DP; each retained span carries its endpoint edges' evidence.
 *   BOUNDARY    DP after forcing a vertex wherever the provenance class (M/I/X) changes;
 *               endpoint attribution inside each piece.
 *   SPLIT-b     split the line into runs that are homogeneous in provenance and in typed support
 *               quantised to bins of width b confidence points, DP each run; endpoint attribution.
 *               b = 0 is exact homogeneity.
 *   SPLIT-T     split where the provenance or the band of a channel's support (<33, 33-66, >=66,
 *               none) changes, DP each run; endpoint attribution (rules: D6).
 *   DP-MEAN     DP geometry; each span carries the length-weighted mean typed support and the
 *               provenance union of the source edges it replaces.
 *   EC-DP       DP geometry; each retained span carries the minimum typed support and the
 *               provenance union of every source edge it replaces.
 *
 * Support promotion and provenance loss are measured identically for every method: a span is
 * promoted when the support it carries exceeds the minimum over the source edges it replaces, in
 * either typed channel; provenance is lost when the carried provenance set misses a class present
 * in the replaced edges.
 */
const fs=require('node:fs');
const path=require('node:path');
const A=require('./reconstruct_ablation.cjs');
const {rasterizeDtm}=require('../real-data-audit/dist/src/terrain/ground/rasterizeDtm.js');
const {buildDtmGrid}=require('../real-data-audit/dist/src/terrain/ground/cellConfidence.js');
const {contoursAt}=require('../real-data-audit/dist/src/terrain/contour/contoursAt.js');
const {stitchContourSet}=require('../real-data-audit/dist/src/terrain/contour/stitchContours.js');

const ROOT=path.resolve(__dirname,'..');
const CH=['M','I'];
const SPLIT_BINS=[0,10,25];

/** Build the shared input: strict feature runs with per-edge typed evidence. Optional
 *  `confidenceOverride(dtm)` replaces the cell support field; geometry is unaffected. */
function featureRuns(spec,confidenceOverride){
  const{points,grid}=A.loadDataset(spec);
  const raster=rasterizeDtm(points,new Uint8Array(points.length).fill(1),{grid,aggregation:'mean'});
  const dtm=buildDtmGrid(raster);
  if(confidenceOverride)dtm.confidence=confidenceOverride(dtm,points,grid);
  const cs=contoursAt(dtm,{intervalM:grid.cellSizeM});
  const metas=A.sourceBlocksForSegments(dtm,cs);
  const stitched=stitchContourSet(cs,grid.cellSizeM);
  const q=grid.cellSizeM*1e-3,runs=[];
  for(let li=0;li<stitched.length;li++){
    const queues=A.buildEdgeQueues(cs.levels[li],metas[li],q,dtm);
    for(const poly of stitched[li].polylines){
      for(const run of A.splitFeatureRuns(A.attachEdges(poly,queues,q)))if(run.vertices.length>=2)runs.push(run);
    }
    for(const a of queues.values())if(a.length)throw Error(`${spec.id}: unused segment attribution`);
  }
  return{runs,tol:grid.cellSizeM,dtm};
}

/** DP over pieces delimited by forced vertex indices; returns retained indices. */
function dpWithForced(vertices,forced,tol){
  const cuts=[0,...[...forced].filter(i=>i>0&&i<vertices.length-1).sort((a,b)=>a-b),vertices.length-1];
  const keep=[];
  for(let k=0;k<cuts.length-1;k++){
    const a=cuts[k],b=cuts[k+1];
    const idx=A.dpIndices(vertices.slice(a,b+1),tol,a);
    keep.push(...(k===0?idx:idx.slice(1)));
  }
  return keep;
}
const provBoundaries=edges=>{const f=new Set();for(let i=1;i<edges.length;i++)if(edges[i].provenance!==edges[i-1].provenance)f.add(i);return f;};
const binKey=(e,b)=>{const q=v=>v==null?'-':b===0?String(v):String(Math.floor(v/b));return`${e.provenance}|${q(e.typed.M)}|${q(e.typed.I)}`;};
const band=v=>v==null?'-':v>=66?'2':v>=33?'1':'0';
const bandBoundaries=edges=>{const f=new Set();const k=e=>`${e.provenance}|${band(e.typed.M)}|${band(e.typed.I)}`;for(let i=1;i<edges.length;i++)if(k(edges[i])!==k(edges[i-1]))f.add(i);return f;};
const splitBoundaries=(edges,b)=>{const f=new Set();for(let i=1;i<edges.length;i++)if(binKey(edges[i],b)!==binKey(edges[i-1],b))f.add(i);return f;};

/** Support a span carries in channel ch: endpoint = min of its first and last edge; complete =
 *  min over every replaced edge (EC-DP); lengthMean = length-weighted mean over every replaced edge
 *  that has the channel (a common attribute-aggregation rule; provenance is the full union). */
function carriedSupport(run,a,b,ch,attribution){
  const pick=attribution==='endpoint'?[a,b-1]:Array.from({length:b-a},(_,i)=>a+i);
  if(attribution==='lengthMean'){
    let w=0,v=0;
    for(const k of pick){const x=run.edges[k].typed[ch];if(x==null)continue;const p=run.vertices[k],q=run.vertices[k+1],l=Math.hypot(q.x-p.x,q.y-p.y);w+=l;v+=l*x;}
    return w>0?v/w:null;
  }
  const vals=pick.map(k=>run.edges[k].typed[ch]).filter(x=>x!=null);
  return vals.length?Math.min(...vals):null;
}

/** Score one method's retained indices under endpoint or complete-source attribution. */
function scoreSpans(run,keep,attribution,acc){
  for(let j=0;j<keep.length-1;j++){
    const a=keep[j],b=keep[j+1],arc=run.edges.slice(a,b),ends=[run.edges[a],run.edges[b-1]];
    acc.spans++;
    let promoted=false;
    for(const ch of CH){
      const arcV=arc.map(e=>e.typed[ch]).filter(x=>x!=null);
      if(!arcV.length)continue;
      const truth=Math.min(...arcV);
      const carried=carriedSupport(run,a,b,ch,attribution);
      if(carried==null)continue;
      if(carried>truth+1e-12){promoted=true;acc.maxPromotion=Math.max(acc.maxPromotion,carried-truth);}
    }
    if(promoted)acc.promoted++;
    // Edge-level attribution error, length-weighted: overstated = the span carries more support
    // than this source edge has in some channel; understated = less in some channel and more in none.
    const carriedBy={};
    for(const ch of CH)carriedBy[ch]=carriedSupport(run,a,b,ch,attribution);
    for(let k=a;k<b;k++){
      const e=run.edges[k],p=run.vertices[k],q=run.vertices[k+1],len=Math.hypot(q.x-p.x,q.y-p.y);
      let over=false,under=false,overPts=0,underPts=0;
      for(const ch of CH){const own=e.typed[ch],c=carriedBy[ch];if(own==null||c==null)continue;if(c>own+1e-12){over=true;overPts=Math.max(overPts,c-own);}else if(c<own-1e-12){under=true;underPts=Math.max(underPts,own-c);}}
      acc.length+=len;acc.overPts+=len*overPts;if(over)acc.overLength+=len;else if(under){acc.underLength+=len;acc.underPts+=len*underPts;}
    }
    const truthP=A.unionProv(arc),carriedP=A.unionProv(attribution==='endpoint'?ends:arc);
    if(A.misses(carriedP,truthP))acc.provLoss++;
  }
}

function evaluateSite(spec,confidenceOverride){
  const{runs,tol}=featureRuns(spec,confidenceOverride);
  const methods=[
    {id:'DP',keep:r=>A.dpIndices(r.vertices,tol),attribution:'endpoint'},
    {id:'BOUNDARY',keep:r=>dpWithForced(r.vertices,provBoundaries(r.edges),tol),attribution:'endpoint'},
    ...SPLIT_BINS.map(b=>({id:`SPLIT-${b}`,keep:r=>dpWithForced(r.vertices,splitBoundaries(r.edges,b),tol),attribution:'endpoint'})),
    {id:'SPLIT-T',keep:r=>dpWithForced(r.vertices,bandBoundaries(r.edges),tol),attribution:'endpoint'},
    {id:'DP-MEAN',keep:r=>A.dpIndices(r.vertices,tol),attribution:'lengthMean'},
    {id:'EC-DP',keep:r=>A.dpIndices(r.vertices,tol),attribution:'complete'},
  ];
  let sourceVertices=0;for(const r of runs)sourceVertices+=r.vertices.length;
  const dpKeep=runs.map(r=>A.dpIndices(r.vertices,tol).join(','));
  const out=[];
  for(const m of methods){
    const acc={spans:0,promoted:0,provLoss:0,maxPromotion:0,retained:0,linesChanged:0,length:0,overLength:0,underLength:0,overPts:0,underPts:0};
    runs.forEach((r,i)=>{const keep=m.keep(r);acc.retained+=keep.length;if(keep.join(',')!==dpKeep[i])acc.linesChanged++;scoreSpans(r,keep,m.attribution,acc);});
    out.push({method:m.id,attribution:m.attribution,lines:runs.length,sourceVertices,retainedVertices:acc.retained,
      vertexReductionPct:A.pct(sourceVertices-acc.retained,sourceVertices),extraVerticesVsDP:null,
      linesWithGeometryDifferentFromDP:acc.linesChanged,spans:acc.spans,
      supportPromotionCount:acc.promoted,supportPromotionPct:A.pct(acc.promoted,acc.spans),
      maxPromotionConfidencePoints:acc.maxPromotion,
      provenanceLossCount:acc.provLoss,provenanceLossPct:A.pct(acc.provLoss,acc.spans),
      overstatedLengthPct:A.pct(acc.overLength,acc.length),understatedLengthPct:A.pct(acc.underLength,acc.length),
      meanOverstatementPoints:acc.length?acc.overPts/acc.length:0,meanUnderstatementPoints:acc.length?acc.underPts/acc.length:0});
  }
  const dpRet=out.find(o=>o.method==='DP').retainedVertices;
  for(const o of out)o.extraVerticesVsDP=o.retainedVertices-dpRet;
  return{id:spec.id,label:spec.label,methods:out};
}

module.exports={featureRuns,evaluateSite,dpWithForced,scoreSpans};

if(require.main===module){
  const sites=A.DATASETS.map(d=>evaluateSite(d));
  const result={driver:'alternative-method comparison',tolerance:'one source cell',
    input:'strict production feature runs, identical for every method',methods:{
      DP:'ordinary Douglas-Peucker, endpoint attribution',
      BOUNDARY:'vertex forced at every provenance-class change, then DP; endpoint attribution',
      'SPLIT-b':'runs homogeneous in provenance and typed support binned at b confidence points, DP per run; endpoint attribution (b=0 exact)',
      'SPLIT-T':'runs split where provenance or the band of a channel (<33, 33-66, >=66) changes, DP per run; endpoint attribution (D6)',
      'DP-MEAN':'DP geometry; length-weighted mean support and provenance union over the replaced edges',
      'EC-DP':'DP geometry; complete-source minimum support and provenance union'},
    sites};
  const outPath=path.join(ROOT,'results','baselines_r2.json');
  fs.writeFileSync(outPath,JSON.stringify(result,null,2)+'\n');
  const csv=['site,method,attribution,lines,source_vertices,retained_vertices,vertex_reduction_pct,extra_vertices_vs_dp,lines_geometry_changed,spans,support_promotion,support_promotion_pct,max_promotion_points,provenance_loss,provenance_loss_pct,overstated_length_pct,understated_length_pct,mean_overstatement_points,mean_understatement_points'];
  for(const s of sites)for(const m of s.methods)csv.push([s.label,m.method,m.attribution,m.lines,m.sourceVertices,m.retainedVertices,m.vertexReductionPct.toFixed(1),m.extraVerticesVsDP,m.linesWithGeometryDifferentFromDP,m.spans,m.supportPromotionCount,m.supportPromotionPct.toFixed(1),Number(m.maxPromotionConfidencePoints.toFixed(2)),m.provenanceLossCount,m.provenanceLossPct.toFixed(1),m.overstatedLengthPct.toFixed(1),m.understatedLengthPct.toFixed(1),m.meanOverstatementPoints.toFixed(2),m.meanUnderstatementPoints.toFixed(2)].join(','));
  fs.writeFileSync(path.join(__dirname,'baselines_site_results.csv'),csv.join('\n')+'\n');
  console.log(csv.join('\n'));
}
