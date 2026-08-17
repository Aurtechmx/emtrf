import { evidenceConstrainedDouglasPeuckerTyped, type TypedEvidenceVertex } from './evidenceConstrainedGeneralizeTyped';

type V = TypedEvidenceVertex;

function perp(p:V,a:V,b:V):number{
  const dx=b.x-a.x, dy=b.y-a.y, len2=dx*dx+dy*dy;
  if(len2<=1e-24) return Math.hypot(p.x-a.x,p.y-a.y);
  const t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/len2));
  return Math.hypot(p.x-(a.x+t*dx),p.y-(a.y+t*dy));
}
function dpIndices(v:readonly V[],a:number,b:number,tol:number):number[]{
  if(b<=a+1) return [a,b]; let idx=-1,max=-1;
  for(let i=a+1;i<b;i++){ const d=perp(v[i],v[a],v[b]); if(d>max){max=d;idx=i;} }
  if(max>tol && idx>a){ const l=dpIndices(v,a,idx,tol),r=dpIndices(v,idx,b,tol); return [...l.slice(0,-1),...r]; }
  return [a,b];
}
function mulberry32(seed:number){ return ()=>{ seed|=0; seed=seed+0x6D2B79F5|0; let t=Math.imul(seed^seed>>>15,1|seed); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }
function makePolyline(seed:number,n=64):V[]{
  const rnd=mulberry32(seed);
  const amp=0.01+0.18*rnd();
  const freq=0.7+2.3*rnd();
  const phase=6.283185307*rnd();
  const verts:V[]=[];
  for(let i=0;i<n;i++){
    const x=i/(n-1)*10;
    const y=amp*Math.sin(freq*x+phase)+0.005*(rnd()-0.5);
    const s=0.78+0.2*rnd();
    verts.push({x,y,state:'measured',provenance:['measured'],support:{'raw-measured-support':s}});
  }
  // Inject 1-4 weak interior evidence locations. These may be geometrically redundant.
  const dips=1+Math.floor(4*rnd());
  for(let k=0;k<dips;k++){
    const i=2+Math.floor((n-4)*rnd());
    verts[i]={...verts[i],support:{'raw-measured-support':0.08+0.42*rnd()}};
  }
  return verts;
}
function arcMin(v:readonly V[],a:number,b:number):number{
  let m=Infinity; for(let i=a;i<=b;i++){ const s=v[i].support['raw-measured-support']; if(s!=null) m=Math.min(m,s); } return m;
}
function ordinarySummary(v:readonly V[], tol:number){
  const keep=dpIndices(v,0,v.length-1,tol);
  let violations=0, segs=0, promotedBy=0, maxPromotion=0;
  for(let j=0;j<keep.length-1;j++){
    const a=keep[j],b=keep[j+1];
    const endpoint=Math.min(v[a].support['raw-measured-support']!,v[b].support['raw-measured-support']!);
    const truth=arcMin(v,a,b); segs++;
    const d=endpoint-truth;
    if(d>1e-12){violations++; promotedBy+=d; maxPromotion=Math.max(maxPromotion,d);}
  }
  return {keep,segs,violations,promotedBy,maxPromotion};
}
function ecdpSummary(v:readonly V[],tol:number){
  const r=evidenceConstrainedDouglasPeuckerTyped(v,tol);
  let violations=0, segs=0,maxPromotion=0;
  for(const s of r.segments){
    const out=s.support['raw-measured-support']!;
    const truth=arcMin(v,s.sourceStart,s.sourceEnd); segs++;
    const d=out-truth; if(d>1e-12){violations++; maxPromotion=Math.max(maxPromotion,d);}
  }
  return {retained:r.retainedIndices.length,segs,violations,maxPromotion};
}

const tolerances=[0.02,0.05,0.10,0.20,0.40];
const N=2000;
const results:any[]=[];
for(const tol of tolerances){
  let ordV=0, ordSeg=0, ordMax=0, ordPromoSum=0, ordRet=0;
  let ecV=0, ecSeg=0, ecMax=0, ecRet=0;
  const t0=Date.now();
  const polys:V[][]=[]; for(let s=1;s<=N;s++) polys.push(makePolyline(0xC0FFEE+s));
  const t1=Date.now();
  for(const v of polys){const r=ordinarySummary(v,tol);ordV+=r.violations;ordSeg+=r.segs;ordMax=Math.max(ordMax,r.maxPromotion);ordPromoSum+=r.promotedBy;ordRet+=r.keep.length;}
  const t2=Date.now();
  for(const v of polys){const r=ecdpSummary(v,tol);ecV+=r.violations;ecSeg+=r.segs;ecMax=Math.max(ecMax,r.maxPromotion);ecRet+=r.retained;}
  const t3=Date.now();
  // Retained-geometry equality: on fully supported input EC-DP must keep exactly the ordinary-DP
  // vertex set (Proposition 2). Counted fixture-by-fixture so Table 4's "0 geometry mismatches" is
  // an executed assertion, not an inference. Runs after timing so it does not affect runtimes.
  let geomMismatch=0;
  for(const v of polys){
    const ord=dpIndices(v,0,v.length-1,tol);
    const ec=evidenceConstrainedDouglasPeuckerTyped(v,tol).retainedIndices;
    if(ord.length!==ec.length || ord.some((x,i)=>x!==ec[i])) geomMismatch++;
  }
  results.push({
    tolerance:tol, polylines:N, vertices_per_polyline:64,
    ordinary:{segments:ordSeg,promotion_violations:ordV,promotion_rate:ordV/ordSeg,max_promotion:ordMax,mean_promotion_among_all_segments:ordPromoSum/ordSeg,mean_retained_vertices:ordRet/N,runtime_ms:t2-t1},
    ecdp:{segments:ecSeg,promotion_violations:ecV,promotion_rate:ecV/Math.max(1,ecSeg),geometry_mismatches:geomMismatch,max_promotion:ecMax,mean_retained_vertices:ecRet/N,runtime_ms:t3-t2},
    fixture_generation_ms:t1-t0
  });
}

// Gap stress test: ordinary geometry-only DP can connect across evidence tagged unsupported;
// EMTRF EC-DP refuses any supported segment spanning an unsupported source vertex.
let gapOrdBridges=0,gapEcBridges=0;
for(let s=1;s<=1000;s++){
  const v=makePolyline(0xBAD5EED+s,48);
  const i=10+(s%28);
  v[i]={...v[i],state:'unsupported',provenance:[],support:{}};
  const keep=dpIndices(v,0,v.length-1,0.25);
  for(let j=0;j<keep.length-1;j++){ if(keep[j]<i && keep[j+1]>i) gapOrdBridges++; }
  const ec=evidenceConstrainedDouglasPeuckerTyped(v,0.25);
  for(const seg of ec.segments){ if(seg.sourceStart<i && seg.sourceEnd>i) gapEcBridges++; }
}

const output={
  benchmark:'EMTRF controlled same-semantic evidence-retention stress benchmark',
  design:{seed_family:'mulberry32 deterministic',polylines_per_tolerance:N,vertices_per_polyline:64,tolerances,weak_support_injections:'1-4 interior locations; support 0.08-0.50',interpretation:'adversarial synthetic stress test; not a population frequency estimate'},
  results,
  gap_stress:{fixtures:1000,tolerance:0.25,ordinary_dp_segments_bridging_unsupported_vertex:gapOrdBridges,ecdp_segments_bridging_unsupported_vertex:gapEcBridges},
  environment:{runtime:'Node.js (version omitted in typed benchmark artifact; exact shell records it separately)'}
};
console.log(JSON.stringify(output,null,2));
