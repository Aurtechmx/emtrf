const assert = require('assert');
const ops = require('./compiled/typedEvidenceOperators.js');
const ecdp = require('./compiled/evidenceConstrainedGeneralizeTyped.js');
const M=(s)=>({state:'measured',provenance:['measured'],support:{'raw-measured-support':s}});
const I=(s)=>({state:'interpolated',provenance:['interpolated'],support:{'geometric-interpolation-support':s}});
const X=(m,i)=>({state:'mixed',provenance:['measured','interpolated'],support:{'raw-measured-support':m,'geometric-interpolation-support':i}});
const c1=ops.contourEvidence([M(.9),M(.75),I(.55),X(.8,.45)]);
const c2=ops.contourEvidence([M(.82),M(.7),I(.5),I(.4)]);
assert(c1&&c2);
const joined=ops.stitchEvidence(c1,c2);
const smoothed=ops.smoothEvidence(joined,c1);
assert.deepStrictEqual(smoothed.provenance,['measured','interpolated']);
assert.strictEqual(smoothed.support['raw-measured-support'],.7);
assert.strictEqual(smoothed.support['geometric-interpolation-support'],.4);
const V=[
 {x:0,y:0,state:'mixed',...smoothed},
 {x:1,y:.001,state:'measured',provenance:['measured'],support:{'raw-measured-support':.31}},
 {x:2,y:0,state:'mixed',...smoothed}
];
const r=ecdp.evidenceConstrainedDouglasPeuckerTyped(V,.01);
assert.strictEqual(r.segments.length,2); // state transitions are protected
const mins=r.segments.map(s=>s.support['raw-measured-support']);
assert(mins.includes(.31));
console.log(JSON.stringify({end_to_end_reference_chain:true,contour1:c1,contour2:c2,joined,smoothed,retained:r.retainedIndices,segment_supports:r.segments.map(s=>s.support)},null,2));
