"""Cut the nine fixed 100 m crops from each tile (rules in README.md). Needs PDAL and laspy.

Usage: extract_crops.py TILE_DIR OUT_DIR. Tiles are found by file name anywhere under TILE_DIR.
"""
import json, math, subprocess, sys, hashlib, tempfile
from pathlib import Path
import numpy as np, laspy

TILES = [("coconino", "USGS_LPC_AZ_Coconino_2019_B19_%s.laz" % t) for t in
         ("w1384n1483", "w1396n1416", "w1404n1455", "w1406n1486", "w1407n1486", "w1410n1389", "w1412n1453", "w1422n1452")] + \
        [("wisconsin", "%s.copc.laz" % t) for t in
         ("20170416_WI_Racine_00251700", "20170417_WI_Racine_00252425", "20170424_WI_Kenosha_00001250", "20170424_WI_Kenosha_00001275")] + \
        [("hawaii", "%s.copc.laz" % t) for t in ("20230214_5QKB450690", "20230214_5QKB450695", "20230214_5QKB455630", "20230315_5QKB950695")] + \
        [("white-sands-parent", "USGS_LPC_NM_WhiteSandsNM_2020_D20_w3597n3635.laz"),
         ("estonia-parent", "568539_2020_tava.laz")]
SIZE = 100

def main(src, out):
    src, out = Path(src), Path(out); out.mkdir(parents=True, exist_ok=True); index = []
    for ti, (survey, rel) in enumerate(TILES):
        found = sorted(src.rglob(rel))  # tiles may sit in any subfolder of the source directory
        assert len(found) == 1, (rel, len(found))
        f = found[0]
        m = json.loads(subprocess.run(["pdal", "info", "--metadata", str(f)], capture_output=True, text=True, check=True).stdout)["metadata"]
        assert m["srs"]["units"] == {"horizontal": "metre", "vertical": "metre"}, rel
        origins = [(math.floor(m["minx"] + fx * (m["maxx"] - m["minx"]) - SIZE / 2), math.floor(m["miny"] + fy * (m["maxy"] - m["miny"]) - SIZE / 2))
                   for fy in (0.25, 0.5, 0.75) for fx in (0.25, 0.5, 0.75)]
        with tempfile.TemporaryDirectory() as td:
            pipe = [str(f), {"type": "filters.range", "limits": "Classification[2:2]"},
                    {"type": "filters.crop", "bounds": ["([%d,%d],[%d,%d])" % (x, x + SIZE, y, y + SIZE) for x, y in origins]},
                    {"type": "writers.las", "filename": td + "/c_0.las", "forward": "scale,offset"}]
            subprocess.run(["pdal", "pipeline", "--stdin"], input=json.dumps(pipe), text=True, check=True)
            for las in sorted(Path(td).glob("c_*.las")):
                L = laspy.read(las); x = np.asarray(L.x); y = np.asarray(L.y); z = np.asarray(L.z)
                if not len(x): continue
                # assign to the crop that contains the points (view numbering is not relied on)
                for ci, (ox, oy) in enumerate(origins):
                    k = (x >= ox) & (x < ox + SIZE) & (y >= oy) & (y < oy + SIZE)
                    if not k.any(): continue
                    name = "t%02d_c%d.f32" % (ti, ci)
                    a = np.column_stack([x[k] - ox, y[k] - oy, z[k]]).astype("<f4")
                    p = out / name
                    with open(p, "ab") as fh: fh.write(a.tobytes())
        for ci, (ox, oy) in enumerate(origins):
            p = out / ("t%02d_c%d.f32" % (ti, ci)); n = p.stat().st_size // 12 if p.exists() else 0
            index.append({"id": "t%02d_c%d" % (ti, ci), "survey": survey, "tile": Path(rel).name, "originX": ox, "originY": oy, "groundReturns": n,
                          "file": p.name if n else None, "sha256": hashlib.sha256(p.read_bytes()).hexdigest() if n else None})
        print(survey, Path(rel).name, [r["groundReturns"] for r in index[-9:]], flush=True)
    (out / "index.json").write_text(json.dumps(index, indent=1) + "\n")

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
