// JavaScript side of the cross-language differential. Reads the shared frozen corpus
// (oracles/fixtures/differential_2500.jsonl) and runs the SHIPPED typed EC-DP plus an
// ordinary Douglas-Peucker with the identical clamped-segment distance metric. Emits, per
// fixture, the ordinary-DP retained indices, the EC-DP retained indices, the EC-DP source
// intervals, and the per-interval complete-arc support. Never regenerates geometry.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { evidenceConstrainedDouglasPeuckerTyped } =
  require(join(__dirname, '..', 'js-study', 'reference', 'compiled', 'evidenceConstrainedGeneralizeTyped.js'));

function perp(p,a,b){
  const dx=b.x-a.x, dy=b.y-a.y, len2=dx*dx+dy*dy;
  if(len2<=1e-24) return Math.hypot(p.x-a.x,p.y-a.y);
  const t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/len2));
  return Math.hypot(p.x-(a.x+t*dx),p.y-(a.y+t*dy));
}
function dp(v,a,b,tol){
  if(b<=a+1) return [a,b];
  let idx=-1,max=-1;
  for(let i=a+1;i<b;i++){ const d=perp(v[i],v[a],v[b]); if(d>max){max=d;idx=i;} }
  if(max>tol && idx>a){ const l=dp(v,a,idx,tol),r=dp(v,idx,b,tol); return [...l.slice(0,-1),...r]; }
  return [a,b];
}
const corpus=join(__dirname,'fixtures','differential_2500.jsonl');
const lines=readFileSync(corpus,'utf8').split('\n').filter(Boolean);
mkdirSync(join(__dirname,'results'),{recursive:true});
const out=[];
for(const line of lines){
  const {fixture_id,tolerance,coordinates,support}=JSON.parse(line);
  const verts=coordinates.map((c,i)=>({x:c[0],y:c[1],state:'measured',provenance:['measured'],support:{'raw-measured-support':support[i]}}));
  const dpIdx=dp(verts,0,verts.length-1,tolerance);
  const ec=evidenceConstrainedDouglasPeuckerTyped(verts,tolerance);
  const intervals=ec.segments.map(s=>[s.sourceStart,s.sourceEnd]);
  const segSupport=ec.segments.map(s=>s.support['raw-measured-support']);
  out.push(JSON.stringify({fixture_id,tolerance,dp:dpIdx,ecdp:[...ec.retainedIndices],intervals,support:segSupport}));
}
writeFileSync(join(__dirname,'results','js_differential.jsonl'),out.join('\n')+'\n');
console.log(`js differential: wrote ${out.length} fixture results`);
