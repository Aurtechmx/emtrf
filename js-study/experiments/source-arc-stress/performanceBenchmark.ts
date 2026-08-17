declare const process: any;
import { evidenceConstrainedDouglasPeuckerTyped, type TypedEvidenceVertex } from './evidenceConstrainedGeneralizeTyped';
type V=TypedEvidenceVertex;
function perp(p:V,a:V,b:V):number{const dx=b.x-a.x,dy=b.y-a.y,len2=dx*dx+dy*dy;if(len2<=1e-24)return Math.hypot(p.x-a.x,p.y-a.y);const t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/len2));return Math.hypot(p.x-(a.x+t*dx),p.y-(a.y+t*dy));}
function dp(v:readonly V[],a:number,b:number,tol:number):number[]{if(b<=a+1)return[a,b];let idx=-1,max=-1;for(let i=a+1;i<b;i++){const d=perp(v[i],v[a],v[b]);if(d>max){max=d;idx=i;}}if(max>tol&&idx>a){const l=dp(v,a,idx,tol),r=dp(v,idx,b,tol);return[...l.slice(0,-1),...r];}return[a,b];}
function rng(seed:number){return()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
function make(seed:number,n:number):V[]{const r=rng(seed),a=.01+.18*r(),f=.7+2.3*r(),ph=6.28*r();const v:V[]=[];for(let i=0;i<n;i++){const x=i/(n-1)*10,y=a*Math.sin(f*x+ph)+.005*(r()-.5),s=.78+.2*r();v.push({x,y,state:'measured',provenance:['measured'],support:{'raw-measured-support':s}});}for(let k=0;k<3;k++){const i=2+Math.floor((n-4)*r());v[i]={...v[i],support:{'raw-measured-support':.08+.42*r()}};}return v;}
function nowMs(){return Number(process.hrtime.bigint())/1e6;}
function median(x:number[]){const a=[...x].sort((a,b)=>a-b);const m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2;}
// default: manuscript 640k x 64-vertex case; EMTRF_SWEEP=1 runs the exploratory 32/64/128/256 sweep
const cases=process.env.EMTRF_SWEEP?[32,64,128,256]:[64];
const tol=.1;const out:any[]=[];
for(const n of cases){const count=Math.max(250,Math.floor(640000/n));const polys:V[][]=[];for(let i=0;i<count;i++)polys.push(make(123456+i,n));
  // warmup
  for(let w=0;w<3;w++){for(const v of polys)dp(v,0,v.length-1,tol);for(const v of polys)evidenceConstrainedDouglasPeuckerTyped(v,tol);}
  const ord:number[]=[], ec:number[]=[];for(let rep=0;rep<30;rep++){
    let t=nowMs();let checksum=0;for(const v of polys)checksum+=dp(v,0,v.length-1,tol).length;ord.push(nowMs()-t);
    t=nowMs();let checksum2=0;for(const v of polys)checksum2+=evidenceConstrainedDouglasPeuckerTyped(v,tol).retainedIndices.length;ec.push(nowMs()-t);
    if(checksum!==checksum2)throw new Error('geometry mismatch');
  }
  const mo=median(ord),me=median(ec);out.push({vertices_per_polyline:n,polylines:count,total_source_vertices:n*count,tolerance:tol,ordinary_dp_median_ms:mo,ecdp_median_ms:me,overhead_ratio:me/mo,ordinary_runs_ms:ord,ecdp_runs_ms:ec});
}
console.log(JSON.stringify({benchmark:'EC-DP metadata overhead microbenchmark',design:{warmups:3,repetitions:30,paired_same_geometry:true,interpretation:'single-machine microbenchmark; not a cross-platform performance claim'},environment:{node:process.version,platform:process.platform,arch:process.arch},results:out},null,2));
