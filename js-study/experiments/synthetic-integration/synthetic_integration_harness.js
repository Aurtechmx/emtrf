// OPTIONAL integration harness. It exercises the EMTRF contour path on a synthetic DTM using a
// FULL compiled OpenLiDARViewer terrain core, which is NOT bundled in this standalone repository
// (the audited OLV modules live in ../../../real-data-audit/, and the standalone reproduction path
// is js-study/reproduce.sh + the oracles). Point EMTRF_OLV_CORE at a compiled OLV terrain core to
// run it; otherwise it skips cleanly. It is not required to reproduce any manuscript result.
const fs = require('fs');
const path = require('path');
const core = process.env.EMTRF_OLV_CORE || path.join(__dirname, 'compiled_core');
const need = [
  'src/terrain/ground/rasterizeDtm.js', 'src/terrain/ground/surfaceFromRaster.js',
  'src/terrain/ground/cellConfidence.js', 'src/terrain/contour/contoursAt.js',
  'src/terrain/contour/stitchContours.js',
];
if (!need.every(f => fs.existsSync(path.join(core, f)))) {
  console.log('synthetic-integration: compiled OpenLiDARViewer terrain core not present; skipping.');
  console.log('  (set EMTRF_OLV_CORE to a compiled OLV core to run this optional harness.)');
  process.exit(0);
}
const { rasterizeDtm } = require(path.join(core,'src/terrain/ground/rasterizeDtm.js'));
const { buildSurfaceFromRaster } = require(path.join(core,'src/terrain/ground/surfaceFromRaster.js'));
const { buildDtmGrid, directionalSupport } = require(path.join(core,'src/terrain/ground/cellConfidence.js'));
const { contoursAt } = require(path.join(core,'src/terrain/contour/contoursAt.js'));
const { stitchContourSet } = require(path.join(core,'src/terrain/contour/stitchContours.js'));

const GRID = {originH1:0, originH2:0, cols:100, rows:100, cellSizeM:1};
const plane = (x,y) => 100 + 0.08*x + 0.06*y;

function makeCellPoints({mask=()=>true, counts=()=>4, surface=plane}) {
  const pts=[];
  for (let row=0;row<GRID.rows;row++) {
    for (let col=0;col<GRID.cols;col++) {
      if (!mask(col,row)) continue;
      const n=counts(col,row);
      const x=col+0.5, y=row+0.5, z=surface(x,y);
      for (let k=0;k<n;k++) pts.push({x,y,z});
    }
  }
  return pts;
}
function raster(points) {
  return rasterizeDtm(points, new Uint8Array(points.length).fill(1), {grid:GRID, aggregation:'median', verticalAxis:'z'});
}
function countsCoverage(dtm) {
  const out={unsupported:0, interpolated:0, measured:0};
  for (const c of dtm.coverage) c===0?out.unsupported++:c===1?out.interpolated++:out.measured++;
  return out;
}
function contourResiduals(set, fn) {
  const a=[];
  let segCount=0;
  for (const lev of set.levels) for (const s of lev.segments) {
    segCount++;
    a.push(Math.abs(fn(s.x1,s.y1)-lev.value),Math.abs(fn(s.x2,s.y2)-lev.value));
  }
  a.sort((x,y)=>x-y);
  const q=(p)=>a.length?a[Math.min(a.length-1,Math.floor(p*(a.length-1)))]:null;
  return {segments:segCount, max:a.length?a[a.length-1]:null, median:q(.5), p95:q(.95)};
}
function flattenGeometry(set) {
  const arr=[];
  for (const lev of set.levels) for (const s of lev.segments) arr.push([lev.value,s.x1,s.y1,s.x2,s.y2]);
  return arr;
}
function geomEqual(a,b,tol=0) {
  if (a.length!==b.length) return false;
  let max=0;
  for (let i=0;i<a.length;i++) for(let j=0;j<a[i].length;j++){ const d=Math.abs(a[i][j]-b[i][j]); if(d>max)max=d; if(d>tol)return {equal:false,maxDiff:max,index:i,field:j}; }
  return {equal:true,maxDiff:max};
}
function hashObj(x){const crypto=require('crypto'); return crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');}

const result={schema:'emtrf-synthetic-integration/1.0', source:'OpenLiDARViewer v0.6.4 exact pure modules', grid:GRID, fixtures:{}};

// P01 fully measured analytic plane
{
  const points=makeCellPoints({});
  const r=raster(points);
  const built=buildSurfaceFromRaster(r,{despike:false,targetCount:4,crs:'LOCAL_METRIC'});
  const dtm=built.dtm;
  const cs=contoursAt(dtm,{intervalM:1,maxLevels:50});
  result.fixtures.P01={
    name:'2-D tilted plane, fully measured', pointCount:points.length, coverage:countsCoverage(dtm),
    meanConfidence:dtm.meanConfidence, contour:contourResiduals(cs,plane), levels:cs.levels.length,
    hashes:{dtm:hashObj(Array.from(dtm.z)),contours:hashObj(flattenGeometry(cs))}
  };
}
// P02 missing vertical strip -> interpolated
{
  const points=makeCellPoints({mask:(c,r)=>!(c>=40&&c<60)});
  const r=raster(points);
  const built=buildSurfaceFromRaster(r,{despike:false,targetCount:4,crs:'LOCAL_METRIC'});
  const dtm=built.dtm;
  const cs=contoursAt(dtm,{intervalM:1,maxLevels:50});
  let interpErr=[];
  for(let row=0;row<100;row++)for(let col=40;col<60;col++){
    const i=row*100+col; if(dtm.coverage[i]===1) interpErr.push(Math.abs(dtm.z[i]-plane(col+.5,row+.5)));
  }
  interpErr.sort((a,b)=>a-b);
  result.fixtures.P02={
    name:'Tilted plane with 20 m observation strip removed; production geodesic fill',pointCount:points.length,coverage:countsCoverage(dtm),meanConfidence:dtm.meanConfidence,
    interpolationError:{median:interpErr[Math.floor(interpErr.length/2)],p95:interpErr[Math.floor(.95*(interpErr.length-1))],max:interpErr.at(-1)},
    contour:contourResiduals(cs,plane),levels:cs.levels.length,
    hashes:{dtm:hashObj(Array.from(dtm.z)),contours:hashObj(flattenGeometry(cs))}
  };
}
// P03 same strip but hard refusal past max distance 4 cells
{
  const points=makeCellPoints({mask:(c,r)=>!(c>=40&&c<60)});
  const r=raster(points);
  const dtm=buildDtmGrid(r,{targetCount:4,interpolation:'geodesic',maxInterpDistanceCells:4,extrapolationGuard:{radiusCells:8,penalty:.5},crs:'LOCAL_METRIC'});
  const cs=contoursAt(dtm,{intervalM:1,maxLevels:50});
  let segmentsTouchingUnsupported=0, segCount=0;
  for(const lev of cs.levels)for(const s of lev.segments){
    segCount++;
    const mx=(s.x1+s.x2)/2,my=(s.y1+s.y2)/2;
    const c=Math.max(0,Math.min(99,Math.floor(mx))), rr=Math.max(0,Math.min(99,Math.floor(my)));
    if(dtm.coverage[rr*100+c]===0) segmentsTouchingUnsupported++;
  }
  const stitched=stitchContourSet(cs,1e-3);
  let open=0,closed=0,poly=0;
  for(const l of stitched){for(const p of l.polylines){poly++; p.closed?closed++:open++;}}
  result.fixtures.P03={
    name:'Tilted plane with same 20 m observation strip and 4-cell interpolation refusal',pointCount:points.length,coverage:countsCoverage(dtm),meanConfidence:dtm.meanConfidence,
    contour:{segments:segCount,segmentsWhoseMidpointIsUnsupported:segmentsTouchingUnsupported,polylines:poly,open,closed},
    hashes:{dtm:hashObj(Array.from(dtm.z)),contours:hashObj(flattenGeometry(cs))}
  };
}
// A02 same numerical DTM, alternate provenance/support field: exact same contour geometry
{
  const points=makeCellPoints({});
  const r=raster(points);
  const base=buildDtmGrid(r,{targetCount:4,interpolation:'geodesic',crs:'LOCAL_METRIC'});
  const alt={...base, z:base.z.slice(), counts:base.counts.slice(), coverage:base.coverage.slice(), confidence:base.confidence.slice(), interpDistanceCells:base.interpDistanceCells.slice()};
  for(let row=0;row<100;row++)for(let col=40;col<60;col++){
    const i=row*100+col; alt.coverage[i]=1; alt.confidence[i]=40; alt.counts[i]=0; alt.interpDistanceCells[i]=1;
  }
  const c1=contoursAt(base,{intervalM:1,maxLevels:50});
  const c2=contoursAt(alt,{intervalM:1,maxLevels:50});
  const g1=flattenGeometry(c1),g2=flattenGeometry(c2);
  result.fixtures.A02={name:'Identical elevation grid with different evidence state in a 20 m band',coverageBase:countsCoverage(base),coverageAltered:countsCoverage(alt),geometryComparison:geomEqual(g1,g2,0),contourHashBase:hashObj(g1),contourHashAltered:hashObj(g2),gradeChangedSegments:(()=>{let n=0;for(let li=0;li<c1.levels.length;li++){const a=c1.levels[li].segments,b=c2.levels[li].segments;for(let i=0;i<a.length;i++)if(a[i].grade!==b[i].grade||a[i].confidence!==b[i].confidence)n++;}return n;})()};
}
// P04 one-sided half-domain support; compare guard off/on
{
  const points=makeCellPoints({mask:(c,r)=>c<50});
  const r=raster(points);
  const off=buildDtmGrid(r,{targetCount:4,interpolation:'geodesic',crs:'LOCAL_METRIC'});
  const on=buildDtmGrid(r,{targetCount:4,interpolation:'geodesic',extrapolationGuard:{radiusCells:8,penalty:.5},crs:'LOCAL_METRIC'});
  let penalized=0, same=0, interp=0;
  let ratios=[];
  for(let i=0;i<on.coverage.length;i++) if(on.coverage[i]===1){interp++; if(on.confidence[i]<off.confidence[i]){penalized++; if(off.confidence[i]>0)ratios.push(on.confidence[i]/off.confidence[i]);} else same++;}
  ratios.sort((a,b)=>a-b);
  result.fixtures.P04={name:'One-sided half-domain observations; extrapolation guard ablation',pointCount:points.length,coverage:countsCoverage(on),interpolatedCells:interp,penalizedCells:penalized,unpenalizedInterpolatedCells:same,penaltyRatioMedian:ratios.length?ratios[Math.floor(ratios.length/2)]:null};
}


// P05 Gaussian hill with central missing band -> mixed M/I contour environment
{
  const gaussian=(x,y)=>100+8*Math.exp(-(((x-50)**2+(y-50)**2)/(2*18*18)));
  const points=makeCellPoints({mask:(c,r)=>!(c>=45&&c<55),surface:gaussian});
  const r=raster(points);
  const built=buildSurfaceFromRaster(r,{despike:false,targetCount:4,crs:'LOCAL_METRIC'});
  const dtm=built.dtm;
  const cs=contoursAt(dtm,{intervalM:1,maxLevels:50});
  let interpErr=[];
  for(let row=0;row<100;row++)for(let col=45;col<55;col++){const i=row*100+col;if(dtm.coverage[i]===1)interpErr.push(Math.abs(dtm.z[i]-gaussian(col+.5,row+.5)));}
  interpErr.sort((a,b)=>a-b);
  let segInBand=0, segTotal=0;
  for(const lev of cs.levels)for(const sg of lev.segments){segTotal++; const mx=(sg.x1+sg.x2)/2; if(mx>=45&&mx<55)segInBand++;}
  result.fixtures.P05={name:'Gaussian hill with 10 m central observation band removed',pointCount:points.length,coverage:countsCoverage(dtm),meanConfidence:dtm.meanConfidence,interpolationError:{median:interpErr[Math.floor(interpErr.length/2)],p95:interpErr[Math.floor(.95*(interpErr.length-1))],max:interpErr.at(-1)},contour:{segments:segTotal,segmentsWithMidpointInInterpolationBand:segInBand},levels:cs.levels.length,hashes:{dtm:hashObj(Array.from(dtm.z)),contours:hashObj(flattenGeometry(cs))}};
}

fs.mkdirSync(path.join(__dirname,'results'),{recursive:true});
fs.writeFileSync(path.join(__dirname,'results','synthetic_integration_results.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
