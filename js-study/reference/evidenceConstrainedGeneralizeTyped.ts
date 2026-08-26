/**
 * EMTRF typed Evidence-Constrained Douglas–Peucker reference.
 * Geometry may simplify; scientific evidence is aggregated over each COMPLETE
 * source arc using typedMeet, so unlike support meanings remain distinct.
 */
import { typedMeet, type TypedEvidence } from './typedEvidenceOperators';

export type VertexState = 'measured' | 'interpolated' | 'mixed' | 'unsupported';
export interface TypedEvidenceVertex extends TypedEvidence {
  readonly x:number;
  readonly y:number;
  readonly state: VertexState;
}
export interface TypedEvidenceSegment extends TypedEvidence {
  readonly a: TypedEvidenceVertex;
  readonly b: TypedEvidenceVertex;
  readonly sourceStart:number;
  readonly sourceEnd:number;
}
export interface TypedSimplificationResult {
  readonly retainedIndices: readonly number[];
  readonly segments: readonly TypedEvidenceSegment[];
}

function perpendicularDistance(p:TypedEvidenceVertex,a:TypedEvidenceVertex,b:TypedEvidenceVertex):number{
  const dx=b.x-a.x, dy=b.y-a.y, len2=dx*dx+dy*dy;
  if(len2<=1e-24) return Math.hypot(p.x-a.x,p.y-a.y);
  const t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/len2));
  return Math.hypot(p.x-(a.x+t*dx),p.y-(a.y+t*dy));
}
function dpIndices(v:readonly TypedEvidenceVertex[],a:number,b:number,tol:number):number[]{
  if(b<=a+1) return [a,b];
  let idx=-1,max=-1;
  for(let i=a+1;i<b;i++){ const d=perpendicularDistance(v[i],v[a],v[b]); if(d>max){max=d;idx=i;} }
  if(max>tol && idx>a){ const l=dpIndices(v,a,idx,tol),r=dpIndices(v,idx,b,tol); return [...l.slice(0,-1),...r]; }
  return [a,b];
}
/**
 * Vertices that geometry may not drop: the endpoints, any unsupported element (so no chord
 * can span a declared gap), and whatever the caller explicitly protects.
 *
 * A provenance transition (measured -> interpolated, and so on) is deliberately NOT pinned.
 * Pinning it would make EC-DP retain vertices ordinary Douglas-Peucker discards, breaking the
 * geometry-preservation property on fully supported input. It is also unnecessary: when a
 * transition is collapsed, the replacing segment inherits the union of the source provenance
 * and the complete-arc meet of every typed channel, so the transition is conserved in the
 * evidence payload rather than in the geometry. A caller that needs a transition retained for
 * some downstream reason (styling a boundary, for instance) passes those indices in
 * extraProtected, which keeps that policy outside the contract.
 */
function mandatory(v:readonly TypedEvidenceVertex[],extra:ReadonlySet<number>):number[]{
  const keep=new Set<number>([0,v.length-1,...extra]);
  for(let i=0;i<v.length;i++){
    if(v[i].state==='unsupported') keep.add(i);
  }
  return [...keep].sort((a,b)=>a-b);
}
/** Unsupported element strictly inside (a,b). Endpoints are retained anyway, so only an
 *  interior gap may block simplification of the supported run between them. */
function hasUnsupportedStrict(v:readonly TypedEvidenceVertex[],a:number,b:number):boolean{
  for(let i=a+1;i<b;i++) if(v[i].state==='unsupported') return true;
  return false;
}
function hasUnsupported(v:readonly TypedEvidenceVertex[],a:number,b:number):boolean{
  for(let i=a;i<=b;i++) if(v[i].state==='unsupported') return true;
  return false;
}
/**
 * Complete-source arc evidence. The WHOLE evidence payload of every source vertex is passed
 * to the meet -- provenance, support, applicability, unavailable, scope and lineage -- with
 * only the geometry (x, y) and the vertex state removed. Reconstructing a partial record here
 * would strip applicability, so a source that is applicable but carries no value would be
 * misread as inapplicable and the segment could report a value the contract requires to be
 * unavailable.
 */
function arcEvidence(v:readonly TypedEvidenceVertex[],a:number,b:number):TypedEvidence{
  const inputs:TypedEvidence[]=[];
  for(let i=a;i<=b;i++){ const {x:_x,y:_y,state:_state,...evidence}=v[i]; inputs.push(evidence); }
  return typedMeet(inputs);
}
export function evidenceConstrainedDouglasPeuckerTyped(
  vertices:readonly TypedEvidenceVertex[], tolerance:number, extraProtected:ReadonlySet<number>=new Set<number>()
):TypedSimplificationResult{
  if(!Number.isFinite(tolerance)||tolerance<0) throw new RangeError('invalid tolerance');
  if(vertices.length<2) return {retainedIndices:vertices.map((_,i)=>i),segments:[]};
  vertices.forEach((x,i)=>{ if(!Number.isFinite(x.x)||!Number.isFinite(x.y)) throw new RangeError(`invalid coordinate at ${i}`); });
  const m=mandatory(vertices,extraProtected), keep=new Set<number>(m);
  // Split the source at unsupported elements into maximal supported runs and simplify each
  // run independently. Testing hasUnsupported() on [a,b] inclusively reports true whenever an
  // interval's own endpoint is the unsupported vertex, which would leave every run beside a
  // gap unsimplified: the gap is honoured but the geometry contract is broken.
  for(let j=0;j<m.length-1;j++){
    const a=m[j],b=m[j+1];
    // a and b are retained regardless, so only an unsupported element strictly inside blocks DP.
    const lo=vertices[a].state==='unsupported'?a+1:a;
    const hi=vertices[b].state==='unsupported'?b-1:b;
    if(hi<=lo){ for(let i=a;i<=b;i++) keep.add(i); continue; }
    if(hasUnsupportedStrict(vertices,lo,hi)){ for(let i=a;i<=b;i++) keep.add(i); continue; }
    for(const i of dpIndices(vertices,lo,hi,tolerance)) keep.add(i);
  }
  const retainedIndices=[...keep].sort((a,b)=>a-b); const segments:TypedEvidenceSegment[]=[];
  for(let j=0;j<retainedIndices.length-1;j++){
    const a=retainedIndices[j],b=retainedIndices[j+1]; if(hasUnsupported(vertices,a,b)) continue;
    const e=arcEvidence(vertices,a,b);
    segments.push({a:vertices[a],b:vertices[b],sourceStart:a,sourceEnd:b,...e});
  }
  return {retainedIndices,segments};
}
