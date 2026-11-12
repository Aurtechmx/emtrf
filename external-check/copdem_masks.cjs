#!/usr/bin/env node
'use strict';
/**
 * Evidence layers published by a DEM producer: Copernicus DEM GLO-90 (rules: docs/RULES_ADDITIONAL_TESTS.md, D14).
 * Usage: node external-check/copdem_masks.cjs
 *  - Data: 300 x 300 pixel windows of the GLO-90 tiles containing the paper's five field sites
 *    (external-check/copdem, cut by extract_copdem.py): DEM, height error mask (HEM), editing mask (EDM).
 *  - Evidence from the producer's masks only: measured when EDM = 1 and HEM is valid; void when EDM = 0;
 *    otherwise edited, with no height error estimate. Measured support is compared by order (smaller HEM stronger).
 *  - Contours at 10 m with the frozen snapshot extractor on the pixel grid; whole stitched lines;
 *    Douglas-Peucker at one pixel; each segment takes the evidence of its 2 x 2 pixel block.
 *  - Per site and pooled: spans; support promotion and provenance loss under endpoint records and under
 *    complete-source records. The run fails unless the complete-source counts are zero.
 *
 * Produced using Copernicus WorldDEM-90 (c) DLR e.V. 2010-2014 and (c) Airbus Defence and Space GmbH 2014-2018
 * provided under COPERNICUS by the European Union and ESA; all rights reserved.
 */
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const A=require('../ablation/reconstruct_ablation.cjs');
const B=require('../ablation/baselines.cjs');
const {contoursAt}=require('../real-data-audit/dist/src/terrain/contour/contoursAt.js');
const {stitchContourSet}=require('../real-data-audit/dist/src/terrain/contour/stitchContours.js');
const ROOT=path.resolve(__dirname,'..'),DIR=path.join(__dirname,'copdem');
const INDEX=JSON.parse(fs.readFileSync(path.join(DIR,'index.json'),'utf8'));
const INTERVAL_M=10,TOL_PIXELS=1,MIN_SPANS=20,HEM_EDITED=-32767;
const r1=x=>Math.round(x*10)/10,r3=x=>Math.round(x*1000)/1000;
const quant=(v,q)=>{if(!v.length)return null;const s=[...v].sort((a,b)=>a-b),h=(s.length-1)*q,lo=Math.floor(h);return s[lo]+(h-lo)*(s[Math.min(lo+1,s.length-1)]-s[lo]);};
const newAcc=()=>({spans:0,promoted:0,provLoss:0,maxPromotion:0,length:0,overLength:0,underLength:0,overPts:0,underPts:0});

function loadSite(s){
  const buf=fs.readFileSync(path.join(DIR,s.file));
  if(crypto.createHash('sha256').update(buf).digest('hex')!==s.sha256)throw Error(`digest mismatch ${s.id}`);
  const n=s.window.cols*s.window.rows,ab=buf.buffer.slice(buf.byteOffset,buf.byteOffset+buf.byteLength);
  const z=new Float32Array(ab,0,n),hem=new Float32Array(ab,4*n,n),edm=new Uint8Array(ab,8*n,n);
  const coverage=new Uint8Array(n),confidence=new Float32Array(n),zz=new Float32Array(n);
  let measured=0,edited=0,voids=0;const hems=[];
  for(let i=0;i<n;i++){
    const hemOk=Number.isFinite(hem[i])&&hem[i]>=0&&hem[i]!==HEM_EDITED;
    if(edm[i]===0||!Number.isFinite(z[i])){coverage[i]=0;zz[i]=NaN;voids++;}
    else if(edm[i]===1&&hemOk){coverage[i]=2;confidence[i]=-hem[i];zz[i]=z[i];measured++;hems.push(hem[i]);}   // smaller error = stronger
    else{coverage[i]=1;confidence[i]=0;zz[i]=z[i];edited++;}                                                    // no error estimate: one constant
  }
  hems.sort((a,b)=>a-b);
  return{dtm:{cols:s.window.cols,rows:s.window.rows,cellSizeM:1,originH1:0,originH2:0,z:zz,coverage,confidence},
    pixels:{measuredPct:r1(100*measured/n),editedPct:r1(100*edited/n),voidPct:r1(100*voids/n),medianHemM:hems.length?r3(hems[hems.length>>1]):null}};
}
function scoreSite(s){
  const{dtm,pixels}=loadSite(s),dp=newAcc(),ec=newAcc(),sizes=[];let lines=0,sourceVertices=0,retained=0;
  let cs;try{cs=contoursAt(dtm,{intervalM:INTERVAL_M});}catch(e){if(/no contour/i.test(String(e)))return{id:s.id,tile:s.tile,pixels,lines:0,spans:0,rated:false};throw e;}
  const metas=A.sourceBlocksForSegments(dtm,cs),stitched=stitchContourSet(cs,1),q=1e-3;
  for(let li=0;li<stitched.length;li++){
    const queues=A.buildEdgeQueues(cs.levels[li],metas[li],q,dtm);
    for(const poly of stitched[li].polylines){
      const run=A.attachEdges(poly,queues,q);if(run.vertices.length<2)continue;
      const keep=A.dpIndices(run.vertices,TOL_PIXELS);lines++;sourceVertices+=run.vertices.length;retained+=keep.length;
      B.scoreSpans(run,keep,'endpoint',dp);B.scoreSpans(run,keep,'complete',ec);
      // size of each understatement in metres of height error (not in the rules; descriptive)
      for(let j=0;j<keep.length-1;j++){const a=keep[j],b=keep[j+1],arc=run.edges.slice(a,b).map(e=>e.typed.M).filter(x=>x!=null),ends=[run.edges[a].typed.M,run.edges[b-1].typed.M].filter(x=>x!=null);
        if(arc.length&&ends.length){const d=Math.min(...ends)-Math.min(...arc);if(d>1e-12)sizes.push(d);}}
    }
    for(const a of queues.values())if(a.length)throw Error(`${s.id}: unused segment attribution`);
  }
  if(ec.promoted||ec.provLoss)throw Error(`${s.id}: complete-source records promote or lose provenance (D14)`);
  if(sizes.length!==dp.promoted)throw Error(`${s.id}: understatement sizes (${sizes.length}) differ from promoted spans (${dp.promoted})`);
  return{id:s.id,tile:s.tile,pixels,lines,sourceVertices,retainedVertices:retained,spans:dp.spans,rated:dp.spans>=MIN_SPANS,
    endpoint:{promoted:dp.promoted,promotedPct:r1(A.pct(dp.promoted,dp.spans)),provenanceLoss:dp.provLoss,provenanceLossPct:r1(A.pct(dp.provLoss,dp.spans)),
      largestUnderstatedErrorM:r3(dp.maxPromotion)},
    understatementM:{median:r3(quant(sizes,.5)),q1:r3(quant(sizes,.25)),q3:r3(quant(sizes,.75))},sizes,
    completeSource:{promoted:ec.promoted,provenanceLoss:ec.provLoss}};
}
const scored=INDEX.sites.map(scoreSite),all=scored.flatMap(s=>s.sizes||[]),sites=scored.map(({sizes,...s})=>s),rated=sites.filter(s=>s.rated);
const sum=k=>rated.reduce((t,s)=>t+k(s),0),spans=sum(s=>s.spans);
const out={driver:'evidence layers published by a DEM producer (Copernicus DEM GLO-90)',rules:'docs/RULES_ADDITIONAL_TESTS.md, D14',
  intervalM:INTERVAL_M,tolerancePixels:TOL_PIXELS,sites,
  pooledOverRatedSites:{sites:rated.length,spans,endpointPromoted:sum(s=>s.endpoint.promoted),endpointPromotedPct:r1(A.pct(sum(s=>s.endpoint.promoted),spans)),
    endpointProvenanceLoss:sum(s=>s.endpoint.provenanceLoss),endpointProvenanceLossPct:r1(A.pct(sum(s=>s.endpoint.provenanceLoss),spans)),
    completeSourcePromoted:sum(s=>s.completeSource.promoted),completeSourceProvenanceLoss:sum(s=>s.completeSource.provenanceLoss)},
  descriptiveNotPrespecified:{understatementM:{n:all.length,median:r3(quant(all,.5)),q1:r3(quant(all,.25)),q3:r3(quant(all,.75)),p95:r3(quant(all,.95))}}};
fs.writeFileSync(path.join(ROOT,'results','copdem_masks_r1.json'),JSON.stringify(out,null,1)+'\n');
console.log(JSON.stringify(out,null,1));
