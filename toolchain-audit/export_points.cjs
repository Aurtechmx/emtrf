#!/usr/bin/env node
'use strict';
// Writes each committed crop's ground returns as x,y,z CSV plus its grid, for the third-party
// toolchains. Only file decoding is shared with the main study; no OLV terrain module is used.
const fs=require('node:fs'),path=require('node:path');
const A=require('../ablation/reconstruct_ablation.cjs');
// Cross-check only: the production binning, to compare against the GDAL and GRASS cell counts.
const {rasterizeDtm}=require('../real-data-audit/dist/src/terrain/ground/rasterizeDtm.js');
const out=process.argv[2];fs.mkdirSync(out,{recursive:true});
const sites=[];
for(const d of A.DATASETS){
  const{points,grid}=A.loadDataset(d);
  fs.writeFileSync(path.join(out,`${d.id}.csv`),'x,y,z\n'+points.map(p=>`${p.x},${p.y},${p.z}`).join('\n')+'\n');
  const olvCounts=Array.from(rasterizeDtm(points,new Uint8Array(points.length).fill(1),{grid,aggregation:'mean'}).counts);
  sites.push({id:d.id,label:d.label,points:points.length,...grid,olvCounts});
}
fs.writeFileSync(path.join(out,'sites.json'),JSON.stringify(sites,null,1));
console.log(sites.map(s=>`${s.id} ${s.points} ${s.cols}x${s.rows} @${s.cellSizeM}`).join('\n'));
