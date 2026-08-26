/**
 * Unsupported-gap regression (Section 3.5 / 4.2).
 *
 * The bridge count alone is not sufficient evidence that the operator behaves as specified:
 * an implementation that refuses to simplify anything adjacent to a gap also emits zero
 * bridges. These assertions additionally require that each maximal supported run IS
 * simplified, and simplified exactly as ordinary Douglas-Peucker would simplify that run
 * in isolation.
 */
import { evidenceConstrainedDouglasPeuckerTyped, type TypedEvidenceVertex } from './reference/evidenceConstrainedGeneralizeTyped';

const M=(x:number,y:number):TypedEvidenceVertex=>({x,y,state:'measured',
  provenance:['measured'], support:{'raw-measured-support':0.8},
  applicability:['raw-measured-support'], unavailable:[], scope:['crop'], lineage:['src']} as any);
const U=(x:number,y:number):TypedEvidenceVertex=>({x,y,state:'unsupported',
  provenance:[], support:{}, applicability:[], unavailable:[], scope:['crop'], lineage:['src']} as any);

let fail=0;
const chk=(n:string,c:boolean)=>{ if(!c){ console.error("  FAIL: "+n); fail++; } };

// supported run A -> U -> supported run B
const v=[M(0,0),M(1,0.001),M(2,0), U(3,0), M(4,0),M(5,0.001),M(6,0)];
const r=evidenceConstrainedDouglasPeuckerTyped(v,0.5);
chk("no segment crosses U", !r.segments.some(s=>s.sourceStart<3&&s.sourceEnd>3));
chk("no represented source interval contains U", !r.segments.some(s=>s.sourceStart<=3&&s.sourceEnd>=3));
chk("run A is simplified", !r.retainedIndices.includes(1));
chk("run B is simplified", !r.retainedIndices.includes(5));
chk("U retained as gap marker", r.retainedIndices.includes(3));

// each run identical to ordinary DP on that run alone
const dpA=evidenceConstrainedDouglasPeuckerTyped([M(0,0),M(1,0.001),M(2,0)],0.5).retainedIndices;
const dpB=evidenceConstrainedDouglasPeuckerTyped([M(4,0),M(5,0.001),M(6,0)],0.5).retainedIndices.map(i=>i+4);
chk("run A == ordinary DP on run A alone", JSON.stringify(r.retainedIndices.filter(i=>i<3))===JSON.stringify(dpA));
chk("run B == ordinary DP on run B alone", JSON.stringify(r.retainedIndices.filter(i=>i>3))===JSON.stringify(dpB));

// a weak source adjacent to the gap stays represented in evidence
const weak=[M(0,0),{...M(1,0.001),support:{'raw-measured-support':0.1}} as TypedEvidenceVertex,M(2,0),U(3,0),M(4,0)];
const rw=evidenceConstrainedDouglasPeuckerTyped(weak,0.5);
const segA=rw.segments.find(s=>s.sourceStart===0);
chk("weak source beside gap lowers the retained segment's support",
    !!segA && (segA as any).support['raw-measured-support']<=0.1);

// fully supported input unchanged by gap handling
chk("fully supported input still collapses to endpoints",
    JSON.stringify(evidenceConstrainedDouglasPeuckerTyped(
      [M(0,0),M(1,0.001),M(2,0),M(3,0.001),M(4,0)],0.5).retainedIndices)==="[0,4]");

if(fail){ console.error(`unsupported-gap regression: ${fail} assertion(s) failed`); process.exit(1); }
console.log("unsupported-gap regression: PASS (9 assertions: no bridge + runs simplified == ordinary DP)");
