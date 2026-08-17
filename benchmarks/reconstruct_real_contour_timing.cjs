#!/usr/bin/env node
'use strict';
/**
 * RECONSTRUCTED real-contour timing benchmark used to validate the manuscript protocol.
 * Corpus: four field-derived contour sets, 289 eligible polylines, 5,305 source vertices/pass.
 * Timing protocol: 5 warmups, 30 paired repetitions, alternating DP/EC-DP order, each timed
 * repetition batches 100 complete corpus passes and divides by 100.
 *
 * Wall-clock numbers are environment dependent. The invariant checks are corpus identity,
 * protocol identity, and identical retained geometry between ordinary DP and the complete-
 * source evidence pass.
 */
const fs=require('node:fs');const path=require('node:path');
const ROOT=path.resolve(__dirname,'..'),AUDIT=path.join(ROOT,'real-data-audit'),CROPS=path.join(AUDIT,'crops');
const {rasterizeDtm}=require(path.join(AUDIT,'dist/src/terrain/ground/rasterizeDtm.js'));
const {buildDtmGrid}=require(path.join(AUDIT,'dist/src/terrain/ground/cellConfidence.js'));
const {contoursAt}=require(path.join(AUDIT,'dist/src/terrain/contour/contoursAt.js'));
const {stitchContourSet}=require(path.join(AUDIT,'dist/src/terrain/contour/stitchContours.js'));
const DATASETS=[
 {id:'white-sands',file:'whitesands-dune__ground.f32',kind:'f32',offsetX:360100,offsetY:3636100,grid:{originH1:360100,originH2:3636100,cols:100,rows:100,cellSizeM:1}},
 {id:'stream',file:'sl-field.bin',kind:'stream',grid:{originH1:549240,originH2:4118390,cols:40,rows:40,cellSizeM:1}},
 {id:'estonia',file:'estonia-tava__ground.f32',kind:'f32',offsetX:539450,offsetY:6568450,grid:{originH1:539450,originH2:6568450,cols:100,rows:100,cellSizeM:1}},
 {id:'marsh',file:'marsh-island__ground.f32',kind:'marsh'},
];
function readF32(file,ox=0,oy=0){const b=fs.readFileSync(path.join(CROPS,file)),f=new Float32Array(b.buffer,b.byteOffset,b.byteLength/4),pts=new Array(f.length/3);for(let i=0,j=0;i<f.length;i+=3,j++)pts[j]={x:f[i]+ox,y:f[i+1]+oy,z:f[i+2]};return pts;}
function readStream(){const b=fs.readFileSync(path.join(CROPS,'sl-field.bin'));const n=b.byteLength/21;let off=b.byteOffset;const xyz=new Float32Array(b.buffer,off,n*3);off+=n*12+n*6+n+n;const cls=new Uint8Array(b.buffer,off,n),pts=[];for(let i=0;i<n;i++)if(cls[i]===2)pts.push({x:xyz[i*3]+549240,y:xyz[i*3+1]+4118390,z:xyz[i*3+2]});return pts;}
function marshGrid(pts){let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;for(const p of pts){minX=Math.min(minX,p.x);minY=Math.min(minY,p.y);maxX=Math.max(maxX,p.x);maxY=Math.max(maxY,p.y);}const c=.5,ox=Math.floor(minX/c)*c,oy=Math.floor(minY/c)*c;return{originH1:ox,originH2:oy,cols:Math.floor((maxX-ox)/c)+1,rows:Math.floor((maxY-oy)/c)+1,cellSizeM:c};}
function load(d){const points=d.kind==='stream'?readStream():readF32(d.file,d.offsetX||0,d.offsetY||0);return{points,grid:d.kind==='marsh'?marshGrid(points):d.grid};}
function prepare(poly){let v=poly.vertices.map(p=>({x:p.x,y:p.y,confidence:p.confidence}));if(!poly.closed)return v;let a=0;for(let i=1;i<v.length;i++)if(v[i].x<v[a].x||(v[i].x===v[a].x&&v[i].y<v[a].y))a=i;v=v.slice(a).concat(v.slice(0,a));return v.concat([{...v[0]}]);}
function segDist(p,a,b){const dx=b.x-a.x,dy=b.y-a.y,l2=dx*dx+dy*dy;if(!l2)return Math.hypot(p.x-a.x,p.y-a.y);let t=((p.x-a.x)*dx+(p.y-a.y)*dy)/l2;t=Math.max(0,Math.min(1,t));return Math.hypot(p.x-(a.x+t*dx),p.y-(a.y+t*dy));}
function dp(v,a,b,tol,out){if(b<=a+1){out.push(a);return;}let idx=-1,max=-1;for(let i=a+1;i<b;i++){const d=segDist(v[i],v[a],v[b]);if(d>max){max=d;idx=i;}}if(max>tol&&idx>a){dp(v,a,idx,tol,out);dp(v,idx,b,tol,out);}else out.push(a);}
function dpIndices(v,tol){const out=[];dp(v,0,v.length-1,tol,out);out.push(v.length-1);return out;}
function buildCorpus(){const corpus=[],bySite={};for(const d of DATASETS){const{points,grid}=load(d),mask=new Uint8Array(points.length).fill(1),r=rasterizeDtm(points,mask,{grid,aggregation:'mean'}),dtm=buildDtmGrid(r),cs=contoursAt(dtm,{intervalM:.5}),st=stitchContourSet(cs,grid.cellSizeM);let n=0,verts=0;for(const level of st)for(const poly of level.polylines){const src=prepare(poly);if(src.length<=2)continue;corpus.push({site:d.id,tol:grid.cellSizeM,vertices:src});n++;verts+=src.length;}bySite[d.id]={polylines:n,sourceVertices:verts,tolerance:grid.cellSizeM};}return{corpus,bySite};}
function ordinaryPass(corpus){let geom=0;for(const p of corpus){const keep=dpIndices(p.vertices,p.tol);geom=(geom+keep.length*1315423911+keep[keep.length-1])>>>0;}return{geom};}
function evidencePass(corpus){let geom=0,evidence=0;for(const p of corpus){const keep=dpIndices(p.vertices,p.tol);geom=(geom+keep.length*1315423911+keep[keep.length-1])>>>0;for(let j=0;j<keep.length-1;j++){let m=Infinity;for(let k=keep[j];k<=keep[j+1];k++)m=Math.min(m,p.vertices[k].confidence);evidence=(evidence+Math.round(m*1000)+keep[j+1]-keep[j])>>>0;}}return{geom,evidence};}
function nowMs(){return Number(process.hrtime.bigint())/1e6;}function median(a){const x=[...a].sort((a,b)=>a-b),m=Math.floor(x.length/2);return x.length%2?x[m]:(x[m-1]+x[m])/2;}function quant(a,q){const x=[...a].sort((a,b)=>a-b);return x[Math.floor(q*(x.length-1))];}
const {corpus,bySite}=buildCorpus(),polylineCount=corpus.length,sourceVertices=corpus.reduce((s,p)=>s+p.vertices.length,0);if(polylineCount!==289||sourceVertices!==5305)throw Error(`corpus identity mismatch: ${polylineCount} polylines / ${sourceVertices} vertices`);
const o0=ordinaryPass(corpus),e0=evidencePass(corpus);if(o0.geom!==e0.geom)throw Error('retained geometry mismatch');
for(let w=0;w<5;w++){ordinaryPass(corpus);evidencePass(corpus);}const ordinary=[],ecdp=[],BATCH=100,REPS=30;function timed(fn){const t=nowMs();let c=0;for(let i=0;i<BATCH;i++)c^=fn(corpus).geom;return{ms:(nowMs()-t)/BATCH,checksum:c};}
for(let rep=0;rep<REPS;rep++){if(rep%2===0){ordinary.push(timed(ordinaryPass).ms);ecdp.push(timed(evidencePass).ms);}else{ecdp.push(timed(evidencePass).ms);ordinary.push(timed(ordinaryPass).ms);}}
const mo=median(ordinary),me=median(ecdp),out={driver:'RECONSTRUCTED real-contour timing benchmark',status:'reconstructed-not-original',environment:{node:process.version,platform:process.platform,arch:process.arch},design:{sites:4,polylines:polylineCount,sourceVerticesPerPass:sourceVertices,warmups:5,pairedRepetitions:30,batchPassesPerTimedRepetition:100,alternatingOrder:true,tolerance:'one source grid cell',contourIntervalM:.5,pairedSameGeometry:true},bySite,currentRun:{ordinaryDp:{medianMs:mo,iqrMs:[quant(ordinary,.25),quant(ordinary,.75)],runsMs:ordinary},completeSourceEvidence:{medianMs:me,iqrMs:[quant(ecdp,.25),quant(ecdp,.75)],runsMs:ecdp},ratio:me/mo,additionalMs:me-mo,geometryChecksum:o0.geom,evidenceChecksum:e0.evidence},frozenManuscriptReference:{ordinaryDpMedianMs:.8567,ordinaryDpIqrMs:[.8547,.8609],ecdpMedianMs:.8844,ecdpIqrMs:[.8805,.8895],ratio:1.032,additionalMs:.0278},interpretation:'Timing values are machine/JIT dependent. The reconstruction is validated by exact corpus identity, the documented 5/30/100 paired protocol, and identical retained geometry; it does not force current wall-clock values to equal the historical machine.'};
const outPath=path.join(ROOT,'results','real_contour_timing_reconstructed.json');fs.mkdirSync(path.dirname(outPath),{recursive:true});fs.writeFileSync(outPath,JSON.stringify(out,null,2)+'\n');console.log(JSON.stringify({...out,currentRun:{...out.currentRun,ordinaryDp:{...out.currentRun.ordinaryDp,runsMs:`${ordinary.length} runs`},completeSourceEvidence:{...out.currentRun.completeSourceEvidence,runsMs:`${ecdp.length} runs`}}},null,2));
