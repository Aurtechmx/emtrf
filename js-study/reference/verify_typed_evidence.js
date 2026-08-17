const assert=require('assert').strict;
const {typedMeet,contourEvidence,stitchEvidence,smoothEvidence}=require('./build/typedEvidenceOperators.js');
const results=[]; const pass=(name,detail={})=>results.push({name,status:'pass',...detail});
const M=(v)=>({state:'measured',provenance:['measured'],support:{'empirical-measured-reliability':v}});
const I=(v)=>({state:'interpolated',provenance:['interpolated'],support:{'geometric-interpolation-support':v}});
const U=()=>({state:'unsupported',provenance:[],support:{}});
let e=contourEvidence([M(.91),M(.78),I(.44),I(.63)]);
assert.deepEqual(e.provenance,['measured','interpolated']);
assert.equal(e.support['empirical-measured-reliability'],.78);
assert.equal(e.support['geometric-interpolation-support'],.44);
assert.equal(Object.keys(e.support).length,2);
pass('mixed contour preserves distinct semantic support channels',e);
assert.equal(contourEvidence([M(.8),M(.7),U(),I(.5)]),null);
pass('unsupported source is absorbing');
let j=stitchEvidence(
  {provenance:['measured'],support:{'empirical-measured-reliability':.82}},
  {provenance:['interpolated'],support:{'geometric-interpolation-support':.35}}
);
assert.deepEqual(j.provenance,['measured','interpolated']);
assert.equal(j.support['empirical-measured-reliability'],.82);
assert.equal(j.support['geometric-interpolation-support'],.35);
pass('stitch unions provenance without cross-semantic numerical collapse',j);
let s=smoothEvidence(
  {provenance:['measured'],support:{'raw-measured-support':.9}},
  {provenance:['measured'],support:{'raw-measured-support':.55}}
);
assert.equal(s.support['raw-measured-support'],.55);
pass('same-semantic smoothing uses channel-wise minimum',s);
const a=typedMeet([
 {provenance:['measured'],support:{'raw-measured-support':.9}},
 {provenance:['interpolated'],support:{'geometric-interpolation-support':.6}},
]);
const left=typedMeet([a,{provenance:['measured'],support:{'raw-measured-support':.4}}]);
const right=typedMeet([
 {provenance:['measured'],support:{'raw-measured-support':.9}},
 typedMeet([
  {provenance:['interpolated'],support:{'geometric-interpolation-support':.6}},
  {provenance:['measured'],support:{'raw-measured-support':.4}},
 ])
]);
assert.deepEqual(left,right);
pass('typed meet is associative');
const idem=typedMeet([M(.77),M(.77)]); assert.equal(idem.support['empirical-measured-reliability'],.77); assert.deepEqual(idem.provenance,['measured']);
pass('typed meet is idempotent');
console.log(JSON.stringify({status:'PASS',checks:results.length,results},null,2));
