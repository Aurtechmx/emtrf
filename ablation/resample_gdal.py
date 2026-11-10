#!/usr/bin/env python3
"""Raster resampling of the terrain grid with GDAL, scored against the source cells.

Question: does the failure of the evidence contract also occur for a second representation
operator, the resampling of a terrain raster to coarser cells?

Input: the production DTM grid of each of the four crops, as three aligned GeoTIFFs written by
ablation/export_dtm_grids.cjs: m_sup (measured support 0-100, no-data outside measured cells),
i_sup (interpolation support 0-100, no-data outside interpolated cells) and prov (1 = measured,
2 = interpolated, no-data 0 = unsupported).

Operator: gdalwarp to cells 2 and 4 times the source cell, aligned on the grid origin (-tr and
-te, so every coarse cell is an exact 2x2 or 4x4 block of source cells), with resampling
  near     on m_sup, i_sup and prov
  average  on m_sup and i_sup only
  mode     on prov only
  min      on m_sup and i_sup only (the contract's reference rule for the support bands).

Scoring, per coarse cell, with its block of source cells as the complete required source set:
  support promotion             the resampled value of a support band exceeds the minimum of that
                                band over the block's cells that carry it, by more than 1e-6;
  provenance loss               the resampled prov code omits a provenance type (measured,
                                interpolated) present in the block;
  value over unsupported cells  the resampled raster carries a value in a coarse cell whose block
                                contains at least one unsupported cell.
Coarse cells whose block has no supported cell are not scored. Reported per site, factor and
resampling: the coarse cells scored and the count and share of each failure, and, as a check,
that min shows no support promotion.

Choices where the rules are silent:
  - a grid whose size is not a multiple of the factor is extended to whole coarse cells on its
    north and east edges; a partial block is scored on the source cells it does contain;
  - a failure is counted once per coarse cell for a resampling when it occurs in any raster that
    resampling is applied to; the per-raster counts are recorded as well;
  - a coarse prov cell left without a value loses every provenance type present in its block.

Block alignment is verified, not assumed: a raster holding each source cell's index is warped with
min, max and average at the same extent and resolution and must return exactly the minimum and
maximum index of every block and the mean index of every full block computed here (on a partial
edge block the average must lie within the block's range), and near must return a cell of the block.

Usage: python ablation/resample_gdal.py [directory written by export_dtm_grids.cjs]
Without an argument the grids are exported to a temporary directory first.
Output: results/resample_gdal_r1.json
"""
import json, subprocess, sys, tempfile
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
FACTORS = (2, 4)
EPS = 1e-6
NODATA = -9999.0
PLAN = {"near": ("m_sup", "i_sup", "prov"), "average": ("m_sup", "i_sup"), "mode": ("prov",), "min": ("m_sup", "i_sup")}


def run(*cmd):
    return subprocess.run([str(c) for c in cmd], check=True, capture_output=True, text=True).stdout


def read(path, work):
    """Raster as a float64 array with row 0 at the southern edge."""
    info = json.loads(run("gdalinfo", "-json", path))
    cols, rows = info["size"]
    dtype = {"Byte": np.uint8, "Float32": "<f4"}[info["bands"][0]["type"]]
    raw = Path(work) / (Path(path).stem + ".envi")
    run("gdal_translate", "-q", "-of", "ENVI", path, raw)
    a = np.fromfile(raw, dtype=dtype).reshape(rows, cols).astype(np.float64)
    return a[::-1], info["geoTransform"]


def write_index(path, cols, rows, gt):
    """Float32 raster whose value is the source cell index (row from south * cols + col + 1)."""
    idx = (np.arange(rows * cols, dtype=np.float64).reshape(rows, cols) + 1)
    idx[::-1].astype("<f4").tofile(path.with_suffix(".raw"))
    path.write_text(
        f'<VRTDataset rasterXSize="{cols}" rasterYSize="{rows}"><GeoTransform>{", ".join(repr(float(g)) for g in gt)}</GeoTransform>'
        f'<VRTRasterBand dataType="Float32" band="1" subClass="VRTRawRasterBand"><NoDataValue>{NODATA}</NoDataValue>'
        f'<SourceFilename relativeToVRT="1">{path.with_suffix(".raw").name}</SourceFilename><ImageOffset>0</ImageOffset>'
        f'<PixelOffset>4</PixelOffset><LineOffset>{4 * cols}</LineOffset><ByteOrder>LSB</ByteOrder></VRTRasterBand></VRTDataset>\n')
    return idx


def warp(src, dst, method, te, tr, nodata):
    run("gdalwarp", "-q", "-overwrite", "-of", "GTiff", "-r", method, "-tr", tr, tr, "-te", *te,
        "-srcnodata", nodata, "-dstnodata", nodata, src, dst)


def blocks(a, f, fill):
    """(coarse rows, coarse cols, f*f) view of a south-up grid, padded north and east with `fill`."""
    rows, cols = a.shape
    R, C = -(-rows // f), -(-cols // f)
    p = np.full((R * f, C * f), fill, dtype=np.float64)
    p[:rows, :cols] = a
    return p.reshape(R, f, C, f).transpose(0, 2, 1, 3).reshape(R, C, f * f)


def share(n, d):
    return round(100.0 * n / d, 2) if d else None


def main():
    if len(sys.argv) > 1:
        grid_dir, tmp = Path(sys.argv[1]), None
    else:
        tmp = tempfile.TemporaryDirectory()
        grid_dir = Path(tmp.name) / "grids"
        run("node", ROOT / "ablation" / "export_dtm_grids.cjs", grid_dir)
    work_tmp = tempfile.TemporaryDirectory()
    work = Path(work_tmp.name)
    version = run("gdalwarp", "--version").strip()
    sites = json.loads((grid_dir / "sites.json").read_text())
    rows_out, align_out = [], []
    for s in sites:
        src = {b: grid_dir / f"{s['id']}_{b}.tif" for b in ("m_sup", "i_sup", "prov")}
        m, gt = read(src["m_sup"], work)
        i, gt_i = read(src["i_sup"], work)
        p, gt_p = read(src["prov"], work)
        rows, cols = p.shape
        cs = gt[1]
        if not (gt == gt_i == gt_p and m.shape == i.shape == p.shape and (cols, rows) == (s["cols"], s["rows"])
                and gt[0] == s["originH1"] and gt[3] - rows * cs == s["originH2"] and gt[5] == -cs and cs == s["cellSizeM"]):
            raise SystemExit(f"grids not aligned: {s['id']}")
        if not (np.array_equal(m != NODATA, p == 1) and np.array_equal(i != NODATA, p == 2)):
            raise SystemExit(f"support bands disagree with prov: {s['id']}")
        idx = write_index(work / f"{s['id']}_idx.vrt", cols, rows, gt)
        for f in FACTORS:
            R, C = -(-rows // f), -(-cols // f)
            tr = cs * f
            te = (repr(gt[0]), repr(s["originH2"]), repr(gt[0] + C * tr), repr(s["originH2"] + R * tr))

            def out(band, method, source, nodata):
                dst = work / f"{s['id']}_{band}_x{f}_{method}.tif"
                warp(source, dst, method, te, repr(tr), nodata)
                a, g = read(dst, work)
                if a.shape != (R, C) or g[0] != gt[0] or g[1] != tr or g[5] != -tr or g[3] != s["originH2"] + R * tr:
                    raise SystemExit(f"unexpected output grid: {dst.name}")
                return a

            # block alignment check on the cell-index raster
            ib = blocks(idx, f, np.nan)
            exp = {"min": np.nanmin(ib, axis=2), "max": np.nanmax(ib, axis=2), "average": np.nanmean(ib, axis=2)}
            got = {k: out("idx", k, work / f"{s['id']}_idx.vrt", "-9999") for k in exp}
            near_idx = out("idx", "near", work / f"{s['id']}_idx.vrt", "-9999")
            ok_min = bool(np.array_equal(got["min"], exp["min"]))
            ok_max = bool(np.array_equal(got["max"], exp["max"]))
            full = ~np.isnan(ib).any(axis=2)
            avg_eq = got["average"] == exp["average"].astype(np.float32).astype(np.float64)
            ok_avg = bool(avg_eq[full].all())
            ok_avg_partial = bool(((got["average"] >= exp["min"]) & (got["average"] <= exp["max"]))[~full].all())
            near_empty = near_idx == NODATA
            near_in_block = bool(((ib == near_idx[:, :, None]).any(axis=2) | (near_empty & ~full)).all())
            off = (near_idx - exp["min"])[~near_empty]
            near_offsets = sorted({(int(o // cols), int(o % cols)) for o in np.unique(off)})
            align_out.append({"site": s["label"], "factor": f, "coarseCols": C, "coarseRows": R,
                              "partialBlocks": int(R * C - (rows // f) * (cols // f)),
                              "minMatchesBlockMin": ok_min, "maxMatchesBlockMax": ok_max, "averageMatchesBlockMeanOnFullBlocks": ok_avg,
                              "averageWithinBlockRangeOnPartialBlocks": ok_avg_partial,
                              "partialBlocksWhereAverageDiffersFromBlockMean": int((~avg_eq & ~full).sum()),
                              "nearPicksCellInsideBlockOrNoValueOnPartialBlock": near_in_block,
                              "partialBlocksWhereNearHasNoValue": int(near_empty.sum()),
                              "nearCellOffsetFromBlockSouthWest": [list(o) for o in near_offsets]})
            if not (ok_min and ok_max and ok_avg and ok_avg_partial and near_in_block):
                raise SystemExit(f"block alignment check failed: {s['id']} x{f}")

            pb = blocks(p, f, -1)  # -1 = outside the source grid
            has_m, has_i, has_x = (pb == 1).any(axis=2), (pb == 2).any(axis=2), (pb == 0).any(axis=2)
            scored = has_m | has_i
            n = int(scored.sum())
            ref = {"m_sup": np.where(has_m, np.min(blocks(m, f, NODATA), axis=2, where=pb == 1, initial=np.inf), np.nan),
                   "i_sup": np.where(has_i, np.min(blocks(i, f, NODATA), axis=2, where=pb == 2, initial=np.inf), np.nan)}
            carriers = {"m_sup": has_m, "i_sup": has_i}
            for method, bands in PLAN.items():
                promo = np.zeros((R, C), bool)
                loss = np.zeros((R, C), bool)
                over = np.zeros((R, C), bool)
                per = {}
                for band in bands:
                    if band == "prov":
                        a = out(band, method, src[band], "0")
                        valid = a != 0
                        if not np.isin(a, (0, 1, 2)).all():
                            raise SystemExit("unexpected prov code")
                        l = scored & ((has_m & (a != 1)) | (has_i & (a != 2)))
                        o = scored & valid & has_x
                        loss |= l
                        per[band] = {"cellsWithValue": int((scored & valid).sum()), "provenanceLoss": int(l.sum()), "valueOverUnsupported": int(o.sum()),
                                     "valueInUnscoredCell": int((~scored & valid).sum())}
                    else:
                        a = out(band, method, src[band], "-9999")
                        valid = a != NODATA
                        if (valid & ~carriers[band]).any():
                            raise SystemExit("support value in a block with no carrying cell")
                        with np.errstate(invalid="ignore"):
                            pr = scored & valid & carriers[band] & (a - ref[band] > EPS)
                        o = scored & valid & has_x
                        promo |= pr
                        per[band] = {"blocksCarryingBand": int((scored & carriers[band]).sum()), "cellsWithValue": int((scored & valid).sum()),
                                     "supportPromotion": int(pr.sum()), "valueOverUnsupported": int(o.sum())}
                    over |= o
                sup, prv = any(b != "prov" for b in bands), "prov" in bands
                rows_out.append({
                    "site": s["label"], "factor": f, "resampling": method, "rasters": list(bands), "coarseCellsScored": n,
                    "coarseCellsNotScored": int(R * C - n),
                    "supportPromotion": int(promo.sum()) if sup else None, "supportPromotionPct": share(int(promo.sum()), n) if sup else None,
                    "provenanceLoss": int(loss.sum()) if prv else None, "provenanceLossPct": share(int(loss.sum()), n) if prv else None,
                    "valueOverUnsupported": int(over.sum()), "valueOverUnsupportedPct": share(int(over.sum()), n),
                    "blocksWithMixedProvenance": int((scored & has_m & has_i).sum()), "blocksWithUnsupportedCell": int((scored & has_x).sum()),
                    "perRaster": per})
    min_rows = [r for r in rows_out if r["resampling"] == "min"]
    result = {
        "driver": "raster resampling with gdalwarp scored against the block of source cells",
        "gdalVersion": version,
        "rules": {
            "factors": list(FACTORS), "alignment": "-tr factor*cell, -te from the grid origin, whole coarse cells",
            "resampling": {k: list(v) for k, v in PLAN.items()}, "promotionTolerance": EPS,
            "supportPromotion": "resampled support > minimum of the band over the block's cells that carry it + 1e-6",
            "provenanceLoss": "resampled prov code omits a provenance type present in the block",
            "valueOverUnsupported": "resampled raster carries a value where the block contains an unsupported cell",
            "notScored": "coarse cells whose block has no supported cell",
            "share": "percent of coarse cells scored",
            "choices": ["grid extended to whole coarse cells on north and east edges; partial blocks scored on the cells they contain",
                        "a failure counts once per coarse cell per resampling if it occurs in any raster that resampling is applied to",
                        "a coarse prov cell without a value loses every provenance type present in its block"]},
        "blockAlignmentCheck": align_out,
        "minShowsNoSupportPromotion": all(r["supportPromotion"] == 0 for r in min_rows),
        "rows": rows_out}
    (ROOT / "results" / "resample_gdal_r1.json").write_text(json.dumps(result, indent=1) + "\n")
    print(version)
    print(f"{'site':13} {'x':>1} {'resamp':8} {'scored':>7} {'promotion':>15} {'prov loss':>15} {'over unsupp.':>15}")
    cell = lambda c, pc: f"{'-':>15}" if c is None else f"{c:>7} {pc:6.2f}%"
    for r in rows_out:
        print(f"{r['site']:13} {r['factor']:>1} {r['resampling']:8} {r['coarseCellsScored']:>7} {cell(r['supportPromotion'], r['supportPromotionPct'])} "
              f"{cell(r['provenanceLoss'], r['provenanceLossPct'])} {cell(r['valueOverUnsupported'], r['valueOverUnsupportedPct'])}")
    print("block alignment check passed for every site and factor:", all(a["minMatchesBlockMin"] and a["maxMatchesBlockMax"] and a["averageMatchesBlockMeanOnFullBlocks"] for a in align_out))
    print("min shows no support promotion:", result["minShowsNoSupportPromotion"])


if __name__ == "__main__":
    main()
