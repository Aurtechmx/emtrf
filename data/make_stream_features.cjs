#!/usr/bin/env node
/*
 * Deterministically regenerate data/stream_features.json from the redistributed
 * StREAM crop (../real-data-audit/crops/sl-field.bin) using the production
 * rasterization and confidence-aware DTM. The coverage grid it writes drives the
 * StREAM map panel in ../figures/make_figures_nextlevel.py (Figure 8).
 *
 * Coverage encoding (from cellConfidence): 2 = measured, 1 = interpolated, 0 = none.
 * Node >= 18. No dependencies.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const AUDIT = path.join(__dirname, '..', 'real-data-audit');
const { rasterizeDtm } = require(path.join(AUDIT, 'dist/src/terrain/ground/rasterizeDtm.js'));
const { buildDtmGrid } = require(path.join(AUDIT, 'dist/src/terrain/ground/cellConfidence.js'));

const GRID = { originH1: 549240, originH2: 4118390, cols: 40, rows: 40, cellSizeM: 1 };

function readStream() {
  const b = fs.readFileSync(path.join(AUDIT, 'crops', 'sl-field.bin'));
  const n = b.byteLength / 21;
  let off = b.byteOffset;
  const xyz = new Float32Array(b.buffer, off, n * 3); off += n * 12;
  off += n * 6; off += n; off += n;              // RGB u16*3, return number, number of returns
  const cls = new Uint8Array(b.buffer, off, n);
  const pts = [];
  for (let i = 0; i < n; i++) if (cls[i] === 2) {
    pts.push({ x: xyz[i * 3] + GRID.originH1, y: xyz[i * 3 + 1] + GRID.originH2, z: xyz[i * 3 + 2] });
  }
  return pts;
}

const points = readStream();
const mask = new Uint8Array(points.length).fill(1);
const raster = rasterizeDtm(points, mask, { grid: GRID, aggregation: 'mean' });
const dtm = buildDtmGrid(raster);

// The simplified-contour overlay for Figure 8 is a reconstructed feature-level export
// (docs/RECONSTRUCTED_DRIVERS.md); it reproduces the StREAM ablation targets. Merge it in so the
// figure draws both the coverage background and the typed-contour overlay.
const exportPath = path.join(__dirname, 'stream_feature_level_export.json');
const simplified = fs.existsSync(exportPath)
  ? JSON.parse(fs.readFileSync(exportPath, 'utf8')).simplified
  : [];

const out = {
  source: 'derived from real-data-audit/crops/sl-field.bin (Virginia Tech StREAM, CC BY 4.0)',
  dtm: {
    rows: dtm.rows, cols: dtm.cols,
    originH1: dtm.originH1, originH2: dtm.originH2, cellSizeM: dtm.cellSizeM,
    coverage: Array.from(dtm.coverage),          // 2=measured, 1=interpolated, 0=none
  },
  simplified,                                    // typed-contour overlay (reconstructed export)
};
fs.writeFileSync(path.join(__dirname, 'stream_features.json'), JSON.stringify(out) + '\n');
const c = out.dtm.coverage;
const m = c.filter(v => v === 2).length, i = c.filter(v => v === 1).length, z = c.filter(v => v === 0).length;
console.log(`stream_features.json: ${dtm.rows}x${dtm.cols} grid, measured ${m}, interpolated ${i}, none ${z}; ${simplified.length} overlay features`);
