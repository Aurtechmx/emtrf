"""Cut the Copernicus DEM GLO-90 windows used by copdem_masks.cjs (rules: docs/RULES_ADDITIONAL_TESTS.md, D14).

Usage: python3 external-check/extract_copdem.py <work-dir>
Needs curl and the GDAL command-line tools. For each of the paper's five field sites it downloads the
DEM, the height error mask (HEM) and the editing mask (EDM) of the GLO-90 tile that contains the site
from the public bucket, and writes the 300 x 300 pixel window centred on the site's pixel (shifted to
stay inside the tile) to external-check/copdem/<site>.bin: DEM (float32), HEM (float32), EDM (uint8),
each row-major with row 0 at the southern edge. index.json records tile, window, and SHA-256 digests.

Produced using Copernicus WorldDEM-90 (c) DLR e.V. 2010-2014 and (c) Airbus Defence and Space GmbH
2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved.
"""
import hashlib
import json
import math
import struct
import subprocess
import sys
from pathlib import Path

BUCKET = "https://copernicus-dem-90m.s3.eu-central-1.amazonaws.com"
WINDOW = 300
# site centres (longitude, latitude), from the crops' own coordinates
SITES = [("white-sands", -106.49455, 32.85453), ("stream", -80.44483, 37.21087), ("estonia", 24.69236, 59.25298),
         ("marsh", -70.91601, 41.65181), ("coconino", -111.60527, 35.15309)]


def tile_name(lon, lat):
    la, lo = math.floor(lat), math.floor(lon)
    return f"Copernicus_DSM_COG_30_{'N' if la >= 0 else 'S'}{abs(la):02d}_00_{'E' if lo >= 0 else 'W'}{abs(lo):03d}_00"


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def run(*cmd):
    return subprocess.run(cmd, check=True, capture_output=True, text=True).stdout


def main(work):
    work = Path(work)
    work.mkdir(parents=True, exist_ok=True)
    out = Path(__file__).resolve().parent / "copdem"
    out.mkdir(exist_ok=True)
    index = {"product": "Copernicus DEM GLO-90 (COP-DEM-GLO-90-F), public bucket copernicus-dem-90m", "windowPixels": WINDOW,
             "layout": "DEM float32, HEM float32, EDM uint8; little-endian, row-major, row 0 at the southern edge", "sites": []}
    for site, lon, lat in SITES:
        t = tile_name(lon, lat)
        files = {"DEM": f"{t}_DEM/{t}_DEM.tif", "HEM": f"{t}_DEM/AUXFILES/{t}_HEM.tif", "EDM": f"{t}_DEM/AUXFILES/{t}_EDM.tif"}
        local = {}
        for k, rel in files.items():
            local[k] = work / Path(rel).name
            if not local[k].exists():
                tmp = local[k].with_suffix(".part")
                run("curl", "-sf", "--retry", "6", "--retry-all-errors", "-o", str(tmp), f"{BUCKET}/{rel}")
                tmp.rename(local[k])
        info = json.loads(run("gdalinfo", "-json", str(local["DEM"])))
        gt, (w, h) = info["geoTransform"], info["size"]
        col, row = int((lon - gt[0]) / gt[1]), int((lat - gt[3]) / gt[5])
        x0 = min(max(col - WINDOW // 2, 0), w - WINDOW)
        y0 = min(max(row - WINDOW // 2, 0), h - WINDOW)
        layers = b""
        for k, ot, fmt, size in (("DEM", "Float32", "f", 4), ("HEM", "Float32", "f", 4), ("EDM", "Byte", "B", 1)):
            li = json.loads(run("gdalinfo", "-json", str(local[k])))
            if li["size"] != [w, h]:
                raise SystemExit(f"{site}: {k} size {li['size']} differs from DEM {[w, h]}")
            raw = work / f"{site}_{k}.raw"
            run("gdal_translate", "-q", "-of", "ENVI", "-ot", ot, "-srcwin", str(x0), str(y0), str(WINDOW), str(WINDOW), str(local[k]), str(raw))
            b = raw.read_bytes()
            if len(b) != WINDOW * WINDOW * size:
                raise SystemExit(f"{site}: {k} window has {len(b)} bytes")
            rows = [b[r * WINDOW * size:(r + 1) * WINDOW * size] for r in range(WINDOW)]
            layers += b"".join(reversed(rows))          # row 0 at the southern edge
        (out / f"{site}.bin").write_bytes(layers)
        index["sites"].append({"id": site, "lon": lon, "lat": lat, "tile": t, "tilePixels": [w, h], "pixelSizeDeg": [gt[1], -gt[5]],
                               "window": {"xOff": x0, "yOff": y0, "cols": WINDOW, "rows": WINDOW},
                               "sourceSha256": {k: sha256(local[k]) for k in files}, "file": f"{site}.bin", "sha256": sha256(out / f"{site}.bin")})
        print(site, t, "window", x0, y0)
    (out / "index.json").write_text(json.dumps(index, indent=1) + "\n")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "copdem-work")
