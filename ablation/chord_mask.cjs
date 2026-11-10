#!/usr/bin/env node
'use strict';
/**
 * Chords over unsupported cells. Rule, written before the run:
 *  - EC-DP splits a line at unsupported source segments, so no simplified segment REPLACES one. A
 *    chord can still pass over an unsupported cell that its source segments went around.
 *  - For every one-cell DP span of the production contour runs, the chord between its two retained
 *    vertices is tested exactly against every cell in its bounding box (segment-rectangle clipping);
 *    the span is counted when the chord passes through the interior of a cell with no supported
 *    elevation (coverage none). Touching only an edge or a corner of such a cell does not count.
 *    The same test is applied to the source segments the span replaces, as a check: it should
 *    count none.
 *  - Reported per site: spans, spans replacing more than one source segment, chords over an
 *    unsupported cell, and the source-segment check. Sites: the four crops, and the 60 crops of
 *    the 3DEP sample when present.
 */
const fs=require('node:fs');
const path=require('node:path');
const A=require('./reconstruct_ablation.cjs');
const W=require('./worked_example.cjs');
const ROOT=path.resolve(__dirname,'..');
function overUnsupported(dtm,grid,p,q){
  const L=grid.cellSizeM,EPS=1e-9,dx=q.x-p.x,dy=q.y-p.y;
  const c0=Math.max(0,Math.floor((Math.min(p.x,q.x)-grid.originH1)/L)),c1=Math.min(grid.cols-1,Math.floor((Math.max(p.x,q.x)-grid.originH1)/L));
  const r0=Math.max(0,Math.floor((Math.min(p.y,q.y)-grid.originH2)/L)),r1=Math.min(grid.rows-1,Math.floor((Math.max(p.y,q.y)-grid.originH2)/L));
  for(let r=r0;r<=r1;r++)for(let c=c0;c<=c1;c++){
    if(dtm.coverage[r*grid.cols+c]!==0)continue;
    const x0=grid.originH1+c*L,y0=grid.originH2+r*L;let t0=0,t1=1,ok=true;
    for(const [d,lo,hi,o] of [[dx,x0,x0+L,p.x],[dy,y0,y0+L,p.y]]){ // Liang-Barsky clipping against the cell
      if(Math.abs(d)<1e-15){if(o<=lo||o>=hi){ok=false;break;}continue;}
      let a=(lo-o)/d,b=(hi-o)/d;if(a>b)[a,b]=[b,a];t0=Math.max(t0,a);t1=Math.min(t1,b);
      if(t1-t0<=EPS){ok=false;break;}
    }
    if(ok)return true;
  }
  return false;
}
function score(spec){
  const {dtm,grid,runs}=W.siteRuns(spec),tol=grid.cellSizeM;
  let spans=0,multi=0,chord=0,source=0,unsupportedCells=0;
  for(let i=0;i<dtm.coverage.length;i++)if(dtm.coverage[i]===0)unsupportedCells++;
  for(const run of runs){
    const keep=A.dpIndices(run.vertices,tol);
    for(let j=0;j<keep.length-1;j++){
      const a=keep[j],b=keep[j+1];spans++;if(b-a>1)multi++;
      if(overUnsupported(dtm,grid,run.vertices[a],run.vertices[b]))chord++;
      for(let k=a;k<b;k++)if(overUnsupported(dtm,grid,run.vertices[k],run.vertices[k+1])){source++;break;}
    }
  }
  return{site:spec.label,unsupportedCellsPct:+(100*unsupportedCells/dtm.coverage.length).toFixed(1),spans,spansReplacingSeveralSegments:multi,
    chordsOverUnsupportedCell:chord,chordsOverUnsupportedCellPct:spans?+(100*chord/spans).toFixed(1):0,spansWithSourceSegmentOverUnsupportedCell:source};
}
const sites=A.DATASETS.map(score);
const out={driver:'chords over unsupported cells',test:'exact segment-cell intersection; interior only',sites};
const sdir=path.join(ROOT,'prevalence','crops');
if(fs.existsSync(path.join(sdir,'index.json'))){
  const st=JSON.parse(fs.readFileSync(path.join(sdir,'index.json'),'utf8')),rel=path.relative(path.join(ROOT,'real-data-audit','crops'),sdir);
  const acc={crops:0,cropsWithUnsupportedCells:0,spans:0,chordsOverUnsupportedCell:0,cropsWithSuchChord:0,spansWithSourceSegmentOverUnsupportedCell:0};
  for(const u of st.units){if(u.status!=='valid')continue;const a=u.attempts[u.attempts.length-1];
    const spec={id:a.id,label:a.id,file:path.join(rel,a.file),kind:'f32',offsetX:a.originX,offsetY:a.originY,grid:{originH1:a.originX,originH2:a.originY,cols:100,rows:100,cellSizeM:1}};
    let r;try{r=score(spec);}catch(e){continue;}
    acc.crops++;if(r.unsupportedCellsPct>0)acc.cropsWithUnsupportedCells++;acc.spans+=r.spans;acc.chordsOverUnsupportedCell+=r.chordsOverUnsupportedCell;
    if(r.chordsOverUnsupportedCell)acc.cropsWithSuchChord++;acc.spansWithSourceSegmentOverUnsupportedCell+=r.spansWithSourceSegmentOverUnsupportedCell;}
  acc.chordsOverUnsupportedCellPct=acc.spans?+(100*acc.chordsOverUnsupportedCell/acc.spans).toFixed(2):0;
  out.sample3dep=acc;
}
fs.writeFileSync(path.join(ROOT,'results','chord_mask_r1.json'),JSON.stringify(out,null,1)+'\n');
console.table(sites);if(out.sample3dep)console.log(out.sample3dep);
