// Deterministic language-neutral fixture corpus for the JavaScript<->Python DP/EC-DP
// differential oracle. Same adversarial family as the source-arc stress benchmark
// (mulberry32, sinusoidal geometry, strong support [0.78,0.98), injected weak support
// [0.08,0.50)). 500 distinct 64-vertex fixtures per tolerance = 2,500 total. Both the
// JavaScript and the Python implementation read THIS file; neither regenerates geometry.
// Emitted as newline-delimited JSON; each line: {fixture_id, tolerance, coordinates[[x,y]], support[]}.
function mulberry32(seed){ return ()=>{ seed|=0; seed=seed+0x6D2B79F5|0; let t=Math.imul(seed^seed>>>15,1|seed); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }
function makeFixture(seed,n=64){
  const rnd=mulberry32(seed);
  const amp=0.01+0.18*rnd(), freq=0.7+2.3*rnd(), phase=6.283185307*rnd();
  const coordinates=[], support=[];
  for(let i=0;i<n;i++){
    const x=i/(n-1)*10;
    const y=amp*Math.sin(freq*x+phase)+0.005*(rnd()-0.5);
    const r9=v=>Number(v.toFixed(9)); coordinates.push([r9(x),r9(y)]); support.push(r9(0.78+0.2*rnd()));
  }
  const dips=1+Math.floor(4*rnd());
  for(let k=0;k<dips;k++){ const i=2+Math.floor((n-4)*rnd()); support[i]=Number((0.08+0.42*rnd()).toFixed(9)); }
  return {coordinates,support};
}
const tolerances=[0.02,0.05,0.10,0.20,0.40];
const out=[]; let id=0;
for(let ti=0;ti<tolerances.length;ti++){
  for(let k=0;k<500;k++){
    const {coordinates,support}=makeFixture(0xC0FFEE + ti*100000 + k);
    out.push(JSON.stringify({fixture_id:id++,tolerance:tolerances[ti],coordinates,support}));
  }
}
process.stdout.write(out.join('\n')+'\n');
