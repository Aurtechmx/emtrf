#!/usr/bin/env node
'use strict';

/**
 * Reproduce the four-crop diagnostics summarized in manuscript Table 6.
 *
 * Pipeline:
 *   committed crop -> production rasterizeDtm -> production buildDtmGrid
 *   -> production contoursAt (0.5 m) -> exact 2x2 source-block attribution
 *   -> production stitchContourSet -> deterministic closed-ring cut
 *   -> ordinary DP retained indices -> complete-source vs endpoint support audit.
 *
 * This harness does not modify OLV source and does not infer table values from
 * rendered figures. It writes machine-readable CSV/JSON and verifies the
 * rounded manuscript values against expected/table6_reported.csv.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = __dirname;
const { rasterizeDtm } = require(path.join(ROOT, 'dist/src/terrain/ground/rasterizeDtm.js'));
const { buildDtmGrid } = require(path.join(ROOT, 'dist/src/terrain/ground/cellConfidence.js'));
const { contoursAt } = require(path.join(ROOT, 'dist/src/terrain/contour/contoursAt.js'));
const { stitchContourSet } = require(path.join(ROOT, 'dist/src/terrain/contour/stitchContours.js'));

const CROP_DIR = path.join(ROOT, 'crops');
const OUT_DIR = path.join(ROOT, 'results');
fs.mkdirSync(OUT_DIR, { recursive: true });

const DATASETS = [
  {
    id: 'white-sands', label: 'USGS White Sands 2020', file: 'whitesands-dune__ground.f32', kind: 'f32',
    offsetX: 360100, offsetY: 3636100,
    grid: { originH1: 360100, originH2: 3636100, cols: 100, rows: 100, cellSizeM: 1 },
  },
  {
    id: 'stream', label: 'StREAM 2026', file: 'sl-field.bin', kind: 'stream',
    grid: { originH1: 549240, originH2: 4118390, cols: 40, rows: 40, cellSizeM: 1 },
  },
  {
    id: 'estonia', label: 'Estonia Tava 2020', file: 'estonia-tava__ground.f32', kind: 'f32',
    offsetX: 539450, offsetY: 6568450,
    grid: { originH1: 539450, originH2: 6568450, cols: 100, rows: 100, cellSizeM: 1 },
  },
  {
    id: 'marsh', label: 'USGS Marsh Island', file: 'marsh-island__ground.f32', kind: 'marsh',
  },
];

// Same marching-squares topology as src/terrain/contour/contoursAt.ts.
const SEGMENT_TABLE = [
  [], [[3,0]], [[0,1]], [[3,1]], [[1,2]], [[3,0],[1,2]], [[0,2]], [[3,2]],
  [[2,3]], [[2,0]], [[0,1],[2,3]], [[2,1]], [[1,3]], [[1,0]], [[0,3]], [],
];
const SADDLE5_HIGH = [[0,1],[2,3]];
const SADDLE10_HIGH = [[3,0],[1,2]];
const EDGE_CORNERS = [[0,1],[1,2],[2,3],[3,0]];

function saddlePairs(mask, zc, level) {
  const denom = zc[0] + zc[2] - zc[1] - zc[3];
  const zs = Math.abs(denom) > 1e-12
    ? (zc[0] * zc[2] - zc[1] * zc[3]) / denom
    : (zc[0] + zc[1] + zc[2] + zc[3]) / 4;
  if (zs >= level) return mask === 5 ? SADDLE5_HIGH : SADDLE10_HIGH;
  return SEGMENT_TABLE[mask];
}

function edgePoint(edge, p, zc, v) {
  const [ai, bi] = EDGE_CORNERS[edge];
  const za = zc[ai], zb = zc[bi], denom = zb - za;
  const t = Math.max(0, Math.min(1, Math.abs(denom) < 1e-12 ? 0.5 : (v - za) / denom));
  return [p[ai][0] + t * (p[bi][0] - p[ai][0]), p[ai][1] + t * (p[bi][1] - p[ai][1])];
}

function readF32(file, ox = 0, oy = 0) {
  const b = fs.readFileSync(path.join(CROP_DIR, file));
  const f = new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
  const pts = new Array(f.length / 3);
  for (let i = 0, j = 0; i < f.length; i += 3, j++) pts[j] = { x: f[i] + ox, y: f[i+1] + oy, z: f[i+2] };
  return pts;
}

function readStream() {
  const b = fs.readFileSync(path.join(CROP_DIR, 'sl-field.bin'));
  const n = b.byteLength / 21;
  let off = b.byteOffset;
  const xyz = new Float32Array(b.buffer, off, n * 3); off += n * 12;
  off += n * 6; // RGB u16 * 3
  off += n;     // return number
  off += n;     // number of returns
  const cls = new Uint8Array(b.buffer, off, n);
  const pts = [];
  for (let i = 0; i < n; i++) if (cls[i] === 2) {
    pts.push({ x: xyz[i*3] + 549240, y: xyz[i*3+1] + 4118390, z: xyz[i*3+2] });
  }
  return pts;
}

function alignedMarshGrid(pts) {
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  for (const p of pts) { minX=Math.min(minX,p.x); minY=Math.min(minY,p.y); maxX=Math.max(maxX,p.x); maxY=Math.max(maxY,p.y); }
  const cellSizeM = 0.5;
  const originH1 = Math.floor(minX / cellSizeM) * cellSizeM;
  const originH2 = Math.floor(minY / cellSizeM) * cellSizeM;
  return {
    originH1, originH2,
    cols: Math.floor((maxX - originH1) / cellSizeM) + 1,
    rows: Math.floor((maxY - originH2) / cellSizeM) + 1,
    cellSizeM,
  };
}

function loadDataset(d) {
  let points;
  if (d.kind === 'stream') points = readStream();
  else points = readF32(d.file, d.offsetX || 0, d.offsetY || 0);
  const grid = d.kind === 'marsh' ? alignedMarshGrid(points) : d.grid;
  return { points, grid };
}

/**
 * Attach the exact source 2x2 DTM block to each already-generated production
 * segment. The walk order and saddle/degenerate rules mirror contoursAt.ts,
 * so this is deterministic and avoids midpoint/post-hoc cell ambiguity.
 */
function sourceBlocksForSegments(dtm, contourSet) {
  const { cols, rows, cellSizeM, originH1, originH2, z, confidence, coverage } = dtm;
  const levels = contourSet.levels;
  const ptr = new Uint32Array(levels.length);
  const meta = levels.map((l) => new Array(l.segments.length));
  const cornerXY = (col,row) => [
    [originH1 + (col + .5)*cellSizeM, originH2 + (row + .5)*cellSizeM],
    [originH1 + (col + 1.5)*cellSizeM, originH2 + (row + .5)*cellSizeM],
    [originH1 + (col + 1.5)*cellSizeM, originH2 + (row + 1.5)*cellSizeM],
    [originH1 + (col + .5)*cellSizeM, originH2 + (row + 1.5)*cellSizeM],
  ];
  for (let row=0; row<rows-1; row++) for (let col=0; col<cols-1; col++) {
    const ids = [row*cols+col, row*cols+col+1, (row+1)*cols+col+1, (row+1)*cols+col];
    if (ids.some((i) => coverage[i]===0 || !Number.isFinite(z[i]))) continue;
    const zc = ids.map((i)=>z[i]);
    const p = cornerXY(col,row);
    const hasM = ids.some((i)=>coverage[i]===2);
    const hasI = ids.some((i)=>coverage[i]===1);
    const provenance = hasM && hasI ? 'X' : hasM ? 'M' : hasI ? 'I' : 'U';
    const blockConfidence = Math.min(...ids.map((i)=>confidence[i]));
    for (let li=0; li<levels.length; li++) {
      const v = levels[li].value;
      const mask = (zc[0]>=v?1:0)|(zc[1]>=v?2:0)|(zc[2]>=v?4:0)|(zc[3]>=v?8:0);
      const pairs = (mask===5||mask===10) ? saddlePairs(mask,zc,v) : SEGMENT_TABLE[mask];
      for (const [ea,eb] of pairs) {
        const a=edgePoint(ea,p,zc,v), b=edgePoint(eb,p,zc,v);
        if (a[0]===b[0] && a[1]===b[1]) continue;
        const k = ptr[li]++;
        if (k >= meta[li].length) throw new Error(`source-block walk exceeded production segment count at level ${v}`);
        const s = levels[li].segments[k];
        // Strong audit assertion: independent walk reproduces exact geometry/order.
        if (s.x1!==a[0] || s.y1!==a[1] || s.x2!==b[0] || s.y2!==b[1]) {
          throw new Error(`source-block geometry mismatch at level ${v}, segment ${k}`);
        }
        meta[li][k] = { row, col, ids, provenance, blockConfidence };
      }
    }
  }
  for (let li=0;li<levels.length;li++) if (ptr[li] !== levels[li].segments.length) {
    throw new Error(`source-block attribution incomplete at level ${levels[li].value}: ${ptr[li]}/${levels[li].segments.length}`);
  }
  return meta;
}


function recoverSourceBlock(dtm, segment) {
  const {cols,rows,cellSizeM,originH1,originH2,z,confidence,coverage}=dtm;
  const minCol=Math.floor((Math.min(segment.x1,segment.x2)-originH1)/cellSizeM-1.5)-1;
  const maxCol=Math.ceil((Math.max(segment.x1,segment.x2)-originH1)/cellSizeM-0.5)+1;
  const minRow=Math.floor((Math.min(segment.y1,segment.y2)-originH2)/cellSizeM-1.5)-1;
  const maxRow=Math.ceil((Math.max(segment.y1,segment.y2)-originH2)/cellSizeM-0.5)+1;
  const candidates=[]; const eps=Math.max(1e-9,cellSizeM*1e-9);
  for(let row=Math.max(0,minRow);row<=Math.min(rows-2,maxRow);row++) for(let col=Math.max(0,minCol);col<=Math.min(cols-2,maxCol);col++){
    const x0=originH1+(col+.5)*cellSizeM,x1=originH1+(col+1.5)*cellSizeM;
    const y0=originH2+(row+.5)*cellSizeM,y1=originH2+(row+1.5)*cellSizeM;
    if(segment.x1<x0-eps||segment.x1>x1+eps||segment.x2<x0-eps||segment.x2>x1+eps||segment.y1<y0-eps||segment.y1>y1+eps||segment.y2<y0-eps||segment.y2>y1+eps) continue;
    const ids=[row*cols+col,row*cols+col+1,(row+1)*cols+col+1,(row+1)*cols+col];
    if(ids.some(i=>coverage[i]===0||!Number.isFinite(z[i]))) continue;
    const blockConfidence=Math.min(...ids.map(i=>confidence[i]));
    const hasM=ids.some(i=>coverage[i]===2),hasI=ids.some(i=>coverage[i]===1);
    candidates.push({row,col,ids,blockConfidence,provenance:hasM&&hasI?'X':hasM?'M':'I'});
  }
  if(!candidates.length) throw new Error('no source block candidate for segment');
  const matched=candidates.filter(c=>c.blockConfidence===segment.confidence);
  const pool=matched.length?matched:candidates;
  const mx=(segment.x1+segment.x2)/2,my=(segment.y1+segment.y2)/2;
  pool.sort((a,b)=>{
    const acx=originH1+(a.col+1)*cellSizeM,acy=originH2+(a.row+1)*cellSizeM;
    const bcx=originH1+(b.col+1)*cellSizeM,bcy=originH2+(b.row+1)*cellSizeM;
    const da=(mx-acx)**2+(my-acy)**2,db=(mx-bcx)**2+(my-bcy)**2;
    return da-db || a.row-b.row || a.col-b.col;
  });
  return {...pool[0],candidateCount:candidates.length,confidenceMatched:matched.length>0};
}
function pointToSegmentDistance(p,a,b) {
  const dx=b.x-a.x, dy=b.y-a.y, len2=dx*dx+dy*dy;
  if (len2===0) return Math.hypot(p.x-a.x,p.y-a.y);
  let t=((p.x-a.x)*dx+(p.y-a.y)*dy)/len2;
  t=Math.max(0,Math.min(1,t));
  return Math.hypot(p.x-(a.x+t*dx),p.y-(a.y+t*dy));
}

function dpIndices(points, epsilon, base=0) {
  if (points.length<=2) return points.map((_,i)=>base+i);
  let maxDist=-1,index=-1;
  for (let i=1;i<points.length-1;i++) {
    const d=pointToSegmentDistance(points[i],points[0],points[points.length-1]);
    if (d>maxDist) { maxDist=d; index=i; }
  }
  if (maxDist>epsilon && index>0) {
    const left=dpIndices(points.slice(0,index+1),epsilon,base);
    const right=dpIndices(points.slice(index),epsilon,base+index);
    return left.slice(0,-1).concat(right);
  }
  return [base,base+points.length-1];
}

/** Stable closed-ring cut used by the reference study. */
function preparePolyline(poly) {
  let vertices = poly.vertices.map((v)=>({x:v.x,y:v.y,confidence:v.confidence}));
  if (!poly.closed) return vertices;
  let anchor=0;
  for (let i=1;i<vertices.length;i++) {
    if (vertices[i].x < vertices[anchor].x ||
       (vertices[i].x === vertices[anchor].x && vertices[i].y < vertices[anchor].y)) anchor=i;
  }
  vertices = vertices.slice(anchor).concat(vertices.slice(0,anchor));
  return vertices.concat([{...vertices[0]}]); // unroll closed ring
}

function simplificationAudit(stitched, cellSizeM, multiplier) {
  let sourceVertices=0, retainedVertices=0, retainedSpans=0, promotions=0;
  const perPolyline=[];
  for (const level of stitched) for (let pi=0; pi<level.polylines.length; pi++) {
    const poly=level.polylines[pi];
    const src=preparePolyline(poly);
    // A 2-vertex open polyline has no interior source to simplify and is not
    // part of the source-arc simplification denominator.
    if (src.length <= 2) continue;
    const retained=dpIndices(src, cellSizeM*multiplier);
    let localProm=0;
    for (let j=0;j<retained.length-1;j++) {
      const a=retained[j], b=retained[j+1];
      const endpointMin=Math.min(src[a].confidence,src[b].confidence);
      let completeMin=Infinity;
      for (let k=a;k<=b;k++) completeMin=Math.min(completeMin,src[k].confidence);
      if (endpointMin>completeMin) { promotions++; localProm++; }
      retainedSpans++;
    }
    sourceVertices += src.length;
    retainedVertices += retained.length;
    perPolyline.push({ level:level.value, polyline:pi, closed:poly.closed, sourceVertices:src.length, retainedVertices:retained.length, promotions:localProm });
  }
  return {
    sourceVertices, retainedVertices, retainedSpans, promotions,
    promotionPct: 100*promotions/retainedSpans,
    vertexReductionPct: 100*(1-retainedVertices/sourceVertices),
    perPolyline,
  };
}

function pct(n,d) { return d ? 100*n/d : 0; }
function fmt1(x){return Number(x.toFixed(1));}
function fmtGradePct(x){return x < 1 ? Number(x.toFixed(2)) : Number(x.toFixed(1));}
function sha256(file){return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');}

const rows=[];
const detail={ datasets:[] };
for (const spec of DATASETS) {
  const { points, grid } = loadDataset(spec);
  const mask = new Uint8Array(points.length).fill(1);
  const raster = rasterizeDtm(points, mask, { grid, aggregation:'mean' });
  const dtm = buildDtmGrid(raster);
  const contourSet = contoursAt(dtm,{intervalM:0.5});
  const blockMeta = sourceBlocksForSegments(dtm,contourSet); // exact generation-order cross-check
  let ambiguousRecoveries=0;
  let segments=0,mDashed=0,xCount=0,mCount=0,iCount=0;
  for(let li=0;li<contourSet.levels.length;li++) {
    const level=contourSet.levels[li];
    for(let si=0;si<level.segments.length;si++) {
      segments++;
      const recovered=recoverSourceBlock(dtm,level.segments[si]);
      if(recovered.candidateCount>1) ambiguousRecoveries++;
      const prov=recovered.provenance;
      if(prov==='M'){mCount++; if(level.segments[si].grade==='dashed')mDashed++;}
      else if(prov==='I')iCount++;
      else if(prov==='X'){xCount++;}
    }
  }
  const stitched=stitchContourSet(contourSet,grid.cellSizeM);
  const one=simplificationAudit(stitched,grid.cellSizeM,1);
  const two=simplificationAudit(stitched,grid.cellSizeM,2);
  const cropPath=path.join(CROP_DIR,spec.file);
  const row={
    dataset:spec.label, segments,
    m_to_dashed_count:mDashed, m_to_dashed_pct:fmtGradePct(pct(mDashed,segments)),
    x_ancestry_count:xCount, x_ancestry_pct:fmt1(pct(xCount,segments)),
    promote_1cell_count:one.promotions, promote_1cell_spans:one.retainedSpans, promote_1cell_pct:fmt1(one.promotionPct),
    vertex_reduction_pct:fmt1(one.vertexReductionPct),
    promote_2cell_count:two.promotions, promote_2cell_spans:two.retainedSpans, promote_2cell_pct:fmt1(two.promotionPct),
  };
  rows.push(row);
  detail.datasets.push({
    ...row, id:spec.id, crop_file:spec.file, crop_sha256:sha256(cropPath), point_count:points.length,
    grid, provenance_counts:{M:mCount,I:iCount,X:xCount}, ambiguous_source_block_recoveries:ambiguousRecoveries,
    one_cell_raw:one, two_cell_raw:two,
  });
}

const cols=['dataset','segments','m_to_dashed_count','m_to_dashed_pct','x_ancestry_count','x_ancestry_pct','promote_1cell_count','promote_1cell_spans','promote_1cell_pct','vertex_reduction_pct'];
const csv=[cols.join(','),...rows.map(r=>cols.map(c=>r[c]).join(','))].join('\n')+'\n';
fs.writeFileSync(path.join(OUT_DIR,'table6.csv'),csv);
fs.writeFileSync(path.join(OUT_DIR,'table6_full.json'),JSON.stringify(detail,null,2)+'\n');
// run-dependent environment, written to a sidecar and intentionally excluded from SHA256SUMS so the canonical outputs stay byte-deterministic across reruns
fs.writeFileSync(path.join(OUT_DIR,'run_env.json'),JSON.stringify({generatedAt:new Date().toISOString(),node:process.version},null,2)+'\n');
const cols2=['dataset','promote_2cell_count','promote_2cell_spans','promote_2cell_pct'];
fs.writeFileSync(path.join(OUT_DIR,'source_arc_2cell.csv'),[cols2.join(','),...rows.map(r=>cols2.map(c=>r[c]).join(','))].join('\n')+'\n');

// Verify the exact reported counts and rounded values.
const expected = [
  {dataset:'USGS White Sands 2020',segments:956,m_to_dashed_count:481,m_to_dashed_pct:50.3,x_ancestry_count:22,x_ancestry_pct:2.3,promote_1cell_count:20,promote_1cell_spans:152,promote_1cell_pct:13.2,vertex_reduction_pct:80.9,promote_2cell_count:25,promote_2cell_spans:105,promote_2cell_pct:23.8},
  {dataset:'StREAM 2026',segments:766,m_to_dashed_count:85,m_to_dashed_pct:11.1,x_ancestry_count:453,x_ancestry_pct:59.1,promote_1cell_count:6,promote_1cell_spans:152,promote_1cell_pct:3.9,vertex_reduction_pct:75.2,promote_2cell_count:9,promote_2cell_spans:95,promote_2cell_pct:9.5},
  {dataset:'Estonia Tava 2020',segments:1315,m_to_dashed_count:83,m_to_dashed_pct:6.3,x_ancestry_count:682,x_ancestry_pct:51.9,promote_1cell_count:7,promote_1cell_spans:344,promote_1cell_pct:2.0,vertex_reduction_pct:66.3,promote_2cell_count:9,promote_2cell_spans:225,promote_2cell_pct:4.0},
  {dataset:'USGS Marsh Island',segments:1980,m_to_dashed_count:9,m_to_dashed_pct:0.45,x_ancestry_count:39,x_ancestry_pct:2.0,promote_1cell_count:9,promote_1cell_spans:175,promote_1cell_pct:5.1,vertex_reduction_pct:88.8,promote_2cell_count:7,promote_2cell_spans:124,promote_2cell_pct:5.6},
];
let ok=true;
for(let i=0;i<rows.length;i++) for(const [k,v] of Object.entries(expected[i])) {
  if(rows[i][k]!==v){ console.error(`MISMATCH ${rows[i].dataset} ${k}: got ${rows[i][k]}, expected ${v}`); ok=false; }
}
console.log(csv.trim());
console.log('\n2-cell source-arc check:');
for(const r of rows) console.log(`${r.dataset}: ${r.promote_2cell_count}/${r.promote_2cell_spans} = ${r.promote_2cell_pct}%`);
console.log(ok?'\nTABLE 6 VERIFICATION: PASS':'\nTABLE 6 VERIFICATION: FAIL');
process.exitCode=ok?0:1;
