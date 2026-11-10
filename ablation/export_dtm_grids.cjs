#!/usr/bin/env node
'use strict';
/**
 * Writes, for each of the four crops, the production DTM grid as three aligned GeoTIFFs:
 *   <site>_m_sup.tif  Float32  measured support 0-100; no-data (-9999) outside measured cells
 *   <site>_i_sup.tif  Float32  interpolation support 0-100; no-data (-9999) outside interpolated cells
 *   <site>_prov.tif   Byte     1 = measured, 2 = interpolated; no-data 0 = unsupported
 * Source codes (cellConfidence.ts, CellCoverage): coverage 2 = measured, 1 = interpolated, 0 = none.
 * The DTM is row-major with row 0 at the southern edge (originH2 is the minimum northing), so rows
 * are written in reverse order to give north-up rasters. Each grid is written as raw little-endian
 * samples with a VRT header and converted to GeoTIFF with gdal_translate.
 *
 * Usage: node ablation/export_dtm_grids.cjs <output-directory>
 */
const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const A=require('./reconstruct_ablation.cjs');
const W=require('./worked_example.cjs');
const NODATA=-9999;
const outDir=process.argv[2];
if(!outDir){console.error('usage: export_dtm_grids.cjs <output-directory>');process.exit(2);}
fs.mkdirSync(outDir,{recursive:true});

function writeGrid(name,data,type,nodata,g){
  const{cols,rows,cellSizeM:cs,originH1,originH2}=g,bytes=type==='Byte'?1:4;
  const buf=Buffer.alloc(cols*rows*bytes);
  for(let line=0;line<rows;line++){const r=rows-1-line; // north-up: first raster line is the northernmost DTM row
    for(let c=0;c<cols;c++){const v=data[r*cols+c],o=(line*cols+c)*bytes;if(bytes===1)buf.writeUInt8(v,o);else buf.writeFloatLE(v,o);}}
  fs.writeFileSync(path.join(outDir,`${name}.raw`),buf);
  const vrt=`<VRTDataset rasterXSize="${cols}" rasterYSize="${rows}">
 <GeoTransform>${originH1}, ${cs}, 0, ${originH2+rows*cs}, 0, ${-cs}</GeoTransform>
 <VRTRasterBand dataType="${type}" band="1" subClass="VRTRawRasterBand">
  <NoDataValue>${nodata}</NoDataValue>
  <SourceFilename relativeToVRT="1">${name}.raw</SourceFilename>
  <ImageOffset>0</ImageOffset><PixelOffset>${bytes}</PixelOffset><LineOffset>${bytes*cols}</LineOffset><ByteOrder>LSB</ByteOrder>
 </VRTRasterBand>
</VRTDataset>
`;
  fs.writeFileSync(path.join(outDir,`${name}.vrt`),vrt);
  execFileSync('gdal_translate',['-q','-of','GTiff',path.join(outDir,`${name}.vrt`),path.join(outDir,`${name}.tif`)]);
}

const index=[];
for(const spec of A.DATASETS){
  const{dtm,grid}=W.siteRuns(spec),n=grid.cols*grid.rows;
  if(dtm.cols!==grid.cols||dtm.rows!==grid.rows||dtm.coverage.length!==n)throw Error(`grid mismatch ${spec.id}`);
  const m=new Float32Array(n),i=new Float32Array(n),p=new Uint8Array(n);const cells={measured:0,interpolated:0,unsupported:0};
  for(let k=0;k<n;k++){
    const cov=dtm.coverage[k];m[k]=NODATA;i[k]=NODATA;
    if(cov===2){if(!(dtm.counts[k]>0))throw Error(`measured cell without returns ${spec.id} ${k}`);m[k]=dtm.confidence[k];p[k]=1;cells.measured++;}
    else if(cov===1){i[k]=dtm.confidence[k];p[k]=2;cells.interpolated++;}
    else if(cov===0){cells.unsupported++;}
    else throw Error(`unknown coverage code ${cov}`);
  }
  writeGrid(`${spec.id}_m_sup`,m,'Float32',NODATA,grid);
  writeGrid(`${spec.id}_i_sup`,i,'Float32',NODATA,grid);
  writeGrid(`${spec.id}_prov`,p,'Byte',0,grid);
  index.push({id:spec.id,label:spec.label,cols:grid.cols,rows:grid.rows,cellSizeM:grid.cellSizeM,originH1:grid.originH1,originH2:grid.originH2,cells});
}
fs.writeFileSync(path.join(outDir,'sites.json'),JSON.stringify(index,null,1)+'\n');
console.table(index.map(s=>({site:s.label,cols:s.cols,rows:s.rows,cell:s.cellSizeM,...s.cells})));
