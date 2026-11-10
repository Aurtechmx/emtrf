#!/usr/bin/env node
'use strict';
/** Scores the scale-test crops (rules and amendment in README.md). Usage: node scale_test.cjs [cropsDir] */
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const B=require('../ablation/baselines.cjs');
const ROOT=path.resolve(__dirname,'..');
const dir=path.resolve(process.argv[2]||path.join(__dirname,'crops'));
if(!fs.existsSync(path.join(dir,'index.json'))){console.log('scale test: crops not present, skipped');process.exit(0);}
const index=JSON.parse(fs.readFileSync(path.join(dir,'index.json'),'utf8'));
const SIZE=100,MIN_RETURNS=1000,MIN_SPANS=20;
const rel=path.relative(path.join(ROOT,'real-data-audit','crops'),dir);
const kept={},crops=[];
for(const c of index){
  const row={id:c.id,survey:c.survey,tile:c.tile,originX:c.originX,originY:c.originY,groundReturns:c.groundReturns,sha256:c.sha256};
  const k=kept[c.tile]||(kept[c.tile]=[]);
  if(k.some(o=>Math.abs(o.originX-c.originX)<SIZE&&Math.abs(o.originY-c.originY)<SIZE)){row.status='overlap';crops.push(row);continue;}
  k.push(c);
  if(c.groundReturns<MIN_RETURNS){row.status='too-few-returns';crops.push(row);continue;}
  if(crypto.createHash('sha256').update(fs.readFileSync(path.join(dir,c.file))).digest('hex')!==c.sha256)throw Error(`digest mismatch ${c.id}`);
  const spec={id:c.id,label:c.id,file:path.join(rel,c.file),kind:'f32',offsetX:c.originX,offsetY:c.originY,grid:{originH1:c.originX,originH2:c.originY,cols:SIZE,rows:SIZE,cellSizeM:1}};
  const m=Object.fromEntries(B.evaluateSite(spec).methods.map(x=>[x.method,x]));
  Object.assign(row,{status:'scored',lines:m.DP.lines,sourceVertices:m.DP.sourceVertices,dpVertices:m.DP.retainedVertices,spans:m.DP.spans,
    promoted:m.DP.supportPromotionCount,provLoss:m.DP.provenanceLossCount,ecPromoted:m['EC-DP'].supportPromotionCount,ecProvLoss:m['EC-DP'].provenanceLossCount,
    split0Vertices:m['SPLIT-0'].retainedVertices,split0Promoted:m['SPLIT-0'].supportPromotionCount});
  crops.push(row);process.stderr.write(`${c.id} spans ${row.spans} promoted ${row.promoted}\n`);
}
const r1=x=>Math.round(x*10)/10,r2=x=>Math.round(x*100)/100;
function quant(v,q){if(!v.length)return null;const s=[...v].sort((a,b)=>a-b),h=(s.length-1)*q,lo=Math.floor(h);return s[lo]+(h-lo)*((s[Math.min(lo+1,s.length-1)])-s[lo]);}
const dist=v=>v.length?{min:r1(quant(v,0)),q1:r1(quant(v,.25)),median:r1(quant(v,.5)),q3:r1(quant(v,.75)),max:r1(quant(v,1))}:null;
function summary(rows){
  const sc=rows.filter(r=>r.status==='scored'),rated=sc.filter(r=>r.spans>=MIN_SPANS),sum=k=>sc.reduce((s,r)=>s+r[k],0),spans=sum('spans');
  return{tiles:new Set(rows.map(r=>r.tile)).size,crops:rows.length,overlap:rows.filter(r=>r.status==='overlap').length,tooFewReturns:rows.filter(r=>r.status==='too-few-returns').length,
    scored:sc.length,scoredWithAtLeast20Spans:rated.length,cropsWithPromotion:sc.filter(r=>r.promoted>0).length,cropsWithProvenanceLoss:sc.filter(r=>r.provLoss>0).length,
    pooled:{spans,promoted:sum('promoted'),promotionPct:spans?r1(100*sum('promoted')/spans):null,provLoss:sum('provLoss'),provLossPct:spans?r1(100*sum('provLoss')/spans):null,
      ecPromoted:sum('ecPromoted'),ecProvLoss:sum('ecProvLoss'),split0Promoted:sum('split0Promoted'),split0VertexMultiple:sum('dpVertices')?r2(sum('split0Vertices')/sum('dpVertices')):null},
    perCropPromotionPct:dist(rated.map(r=>100*r.promoted/r.spans)),perCropProvLossPct:dist(rated.map(r=>100*r.provLoss/r.spans)),
    perCropSplit0VertexMultiple:(d=>d&&Object.fromEntries(Object.entries(d).map(([k,v])=>[k,v])))(rated.length?{min:r2(quant(rated.map(r=>r.split0Vertices/r.dpVertices),0)),median:r2(quant(rated.map(r=>r.split0Vertices/r.dpVertices),.5)),max:r2(quant(rated.map(r=>r.split0Vertices/r.dpVertices),1))}:null)};
}
const parents=new Set(['white-sands-parent','estonia-parent']);
const out={driver:'scale test on public-agency tiles',rules:'scale/README.md',
  all:summary(crops),withoutParentTiles:summary(crops.filter(r=>!parents.has(r.survey))),
  bySurvey:Object.fromEntries([...new Set(crops.map(r=>r.survey))].map(s=>[s,summary(crops.filter(r=>r.survey===s))])),crops};
fs.writeFileSync(path.join(ROOT,'results','scale_test_r1.json'),JSON.stringify(out,null,1)+'\n');
const show=(n,s)=>console.log(n.padEnd(22),`tiles ${s.tiles} crops ${s.crops} overlap ${s.overlap} few ${s.tooFewReturns} scored ${s.scored} (>=20 spans ${s.scoredWithAtLeast20Spans}) with promotion ${s.cropsWithPromotion} | pooled spans ${s.pooled.spans} prom ${s.pooled.promoted} (${s.pooled.promotionPct}%) loss ${s.pooled.provLoss} (${s.pooled.provLossPct}%) EC ${s.pooled.ecPromoted}/${s.pooled.ecProvLoss} SPLIT-0 x${s.pooled.split0VertexMultiple} | per-crop prom`,JSON.stringify(s.perCropPromotionPct),'loss',JSON.stringify(s.perCropProvLossPct));
show('all',out.all);show('without parent tiles',out.withoutParentTiles);for(const[k,v]of Object.entries(out.bySurvey))show(k,v);
