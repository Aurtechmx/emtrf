"""Draw the probability sample of USGS 3DEP work units (rules: docs/RULES_ADDITIONAL_TESTS.md, D4).

Usage: draw_sample.py resources.geojson OUT_DIR
Needs PDAL on PATH, and numpy, laspy and pyproj. Writes OUT_DIR/<id>.f32 (x, y relative to the crop
origin, z in metres, little-endian float32 triples) and OUT_DIR/index.json with every unit tried.
A unit already present in index.json is not fetched again, so an interrupted run can be resumed.
"""
import hashlib, json, math, subprocess, sys, tempfile, urllib.request
from pathlib import Path
import numpy as np, laspy
from pyproj import Transformer

SEED, TARGET, MAX_UNITS, POINTS_PER_UNIT, SIZE, MIN_RETURNS, MARGIN_M = 20261109, 60, 200, 3, 100, 1000, 5.0
FT = 0.3048


def mulberry32(a):
    a &= 0xFFFFFFFF
    def f():
        nonlocal a
        a = (a + 0x6D2B79F5) & 0xFFFFFFFF
        t = a
        t = (t ^ (t >> 15)) * (t | 1) & 0xFFFFFFFF
        t = (t ^ ((t + ((t ^ (t >> 7)) * (t | 61) & 0xFFFFFFFF)) & 0xFFFFFFFF)) & 0xFFFFFFFF
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296
    return f


def inside(lon, lat, multipolygon):
    """Even-odd rule over every ring of the MultiPolygon."""
    c = False
    for poly in multipolygon:
        for ring in poly:
            for (x1, y1), (x2, y2) in zip(ring[:-1], ring[1:]):
                if (y1 > lat) != (y2 > lat) and lon < (x2 - x1) * (lat - y1) / (y2 - y1) + x1:
                    c = not c
    return c


def epqs(lon, lat):
    u = f"https://epqs.nationalmap.gov/v1/json?x={lon:.7f}&y={lat:.7f}&wkid=4326&units=Meters&includeDate=false"
    for _ in range(3):
        try:
            v = float(json.loads(urllib.request.urlopen(u, timeout=60).read())["value"])
            return v if v > -10000 else None
        except Exception:
            continue
    return None


def fetch(url, epsg, ox, oy, las):
    t = Transformer.from_crs(epsg, 3857, always_xy=True)
    xs, ys = zip(*[t.transform(ox + dx, oy + dy) for dx in (0, SIZE) for dy in (0, SIZE)])
    b = "([%.2f,%.2f],[%.2f,%.2f])" % (min(xs) - 10, max(xs) + 10, min(ys) - 10, max(ys) + 10)
    pipe = [{"type": "readers.ept", "filename": url, "bounds": b},
            {"type": "filters.range", "limits": "Classification[2:2]"},
            {"type": "filters.reprojection", "in_srs": "EPSG:3857", "out_srs": f"EPSG:{epsg}"},
            {"type": "filters.crop", "bounds": "([%d,%d],[%d,%d])" % (ox, ox + SIZE, oy, oy + SIZE)},
            {"type": "writers.las", "filename": las}]
    subprocess.run(["pdal", "pipeline", "--stdin"], input=json.dumps(pipe), text=True, check=True, capture_output=True, timeout=900)
    L = laspy.read(las)
    return np.asarray(L.x), np.asarray(L.y), np.asarray(L.z)


def main(index_file, out):
    out = Path(out); out.mkdir(parents=True, exist_ok=True)
    raw = Path(index_file).read_bytes()
    units = sorted(json.loads(raw)["features"], key=lambda f: f["properties"]["name"])
    order = list(range(len(units))); r = mulberry32(SEED)
    for i in range(len(order) - 1, 0, -1):
        j = int(r() * (i + 1)); order[i], order[j] = order[j], order[i]
    ipath = out / "index.json"
    state = json.loads(ipath.read_text()) if ipath.exists() else {"frameSha256": hashlib.sha256(raw).hexdigest(), "frameUnits": len(units), "seed": SEED, "units": []}
    done = {u["unit"] for u in state["units"]}
    for rank, i in enumerate(order[:MAX_UNITS]):
        if sum(u["status"] == "valid" for u in state["units"]) >= TARGET:
            break
        f = units[i]; name = f["properties"]["name"]
        if name in done:
            continue
        rec = {"rank": rank, "unit": name, "sortedIndex": i, "status": None, "attempts": []}
        polys = f["geometry"]["coordinates"]
        lons = [p[0] for poly in polys for ring in poly for p in ring]; lats = [p[1] for poly in polys for ring in poly for p in ring]
        ru = mulberry32(SEED + 1 + i)
        for _ in range(POINTS_PER_UNIT):
            for _try in range(100000):
                lon = min(lons) + ru() * (max(lons) - min(lons)); lat = min(lats) + ru() * (max(lats) - min(lats))
                if inside(lon, lat, polys):
                    break
            else:
                rec["attempts"].append({"reason": "no point inside boundary"}); continue
            epsg = (32600 if lat >= 0 else 32700) + int(math.floor((lon + 180) / 6)) % 60 + 1
            e, n = Transformer.from_crs(4326, epsg, always_xy=True).transform(lon, lat)
            ox, oy = math.floor(e - SIZE / 2), math.floor(n - SIZE / 2)
            a = {"lon": round(lon, 7), "lat": round(lat, 7), "epsg": epsg, "originX": ox, "originY": oy}
            try:
                with tempfile.TemporaryDirectory() as td:
                    x, y, z = fetch(f["properties"]["url"], epsg, ox, oy, td + "/c.las")
            except Exception as ex:
                a["reason"] = "read error: " + type(ex).__name__; rec["attempts"].append(a); continue
            k = (x >= ox) & (x < ox + SIZE) & (y >= oy) & (y < oy + SIZE); x, y, z = x[k], y[k], z[k]
            a["groundReturns"] = int(len(z))
            if len(z) < MIN_RETURNS:
                a["reason"] = "fewer than 1,000 ground returns"; rec["attempts"].append(a); continue
            q = epqs(lon, lat); med = float(np.median(z)); a["medianZAsStored"] = round(med, 3); a["epqsM"] = q
            if q is None:
                a["reason"] = "vertical unit undetermined (no reference elevation)"; rec["attempts"].append(a); continue
            dm, df = abs(med - q), abs(med * FT - q)
            if df - dm >= MARGIN_M:
                a["verticalUnit"] = "metre"
            elif dm - df >= MARGIN_M:
                a["verticalUnit"] = "foot"; z = z * FT
            else:
                a["reason"] = "vertical unit undetermined"; rec["attempts"].append(a); continue
            cid = "u%03d" % rank
            arr = np.column_stack([x - ox, y - oy, z]).astype("<f4"); (out / f"{cid}.f32").write_bytes(arr.tobytes())
            a.update(id=cid, file=f"{cid}.f32", sha256=hashlib.sha256(arr.tobytes()).hexdigest())
            rec["attempts"].append(a); rec["status"] = "valid"; break
        if rec["status"] is None:
            rec["status"] = "not used"
        state["units"].append(rec); done.add(name)
        ipath.write_text(json.dumps(state, indent=1) + "\n")
        last = rec["attempts"][-1] if rec["attempts"] else {}
        print(rank, name, rec["status"], last.get("groundReturns"), last.get("verticalUnit") or last.get("reason"), flush=True)
    v = sum(u["status"] == "valid" for u in state["units"])
    print(f"valid crops {v}; units tried {len(state['units'])}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
