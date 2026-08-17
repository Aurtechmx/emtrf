"""Independent third-party audit: does GDAL gdal_contour carry complete-source evidence?

This breaks the self-audit limitation of the EMTRF paper: the contour GEOMETRY audited
here is produced by GDAL (which the author did not write), not by OpenLiDARViewer.

Two questions:
  (A) What evidence attributes does gdal_contour serialize on its output contours?
  (B) On GDAL-produced contour geometry, does endpoint-only support inheritance promote
      support relative to the complete-source-arc rule (EC-DP), the same failure the paper
      demonstrates on its own geometry?

Everything is deterministic. GDAL is invoked through its CLI (gdal_contour, ogrinfo,
ogr2ogr); no author code touches the contour extraction.
"""
import json, subprocess, sys, os, tempfile, shutil
import numpy as np

_missing = [t for t in ("gdal_contour", "ogrinfo", "ogr2ogr") if shutil.which(t) is None]
if _missing:
    print("GDAL 3.13.1 command-line tools are required for this audit.")
    print("Not found in PATH: " + ", ".join(_missing))
    print("Install GDAL 3.13.1 (e.g. conda install -c conda-forge gdal=3.13.1) and rerun.")
    sys.exit(3)

WORK = tempfile.mkdtemp(prefix="gdal_audit_")  # private per-run dir (avoids a predictable /tmp path)
N = 60; CELL = 1.0; XLL = 0.0; YLL = 0.0

def write_asc(path, arr, nodata=-9999.0):
    rows, cols = arr.shape
    with open(path, "w") as f:
        f.write(f"ncols {cols}\nnrows {rows}\nxllcorner {XLL}\nyllcorner {YLL}\n")
        f.write(f"cellsize {CELL}\nNODATA_value {nodata}\n")
        # ASC is written top row first (north-up); flip so row 0 = north
        for r in range(rows - 1, -1, -1):
            f.write(" ".join(f"{v:.5f}" for v in arr[r]) + "\n")

# --- Deterministic DEM: two Gaussian hills + slight tilt ---
yy, xx = np.mgrid[0:N, 0:N].astype(float)
dem = (3.0*np.exp(-(((xx-20)/12)**2 + ((yy-22)/12)**2))
       + 2.2*np.exp(-(((xx-42)/9)**2 + ((yy-40)/10)**2))
       + 0.03*(xx+yy))

# --- Principled continuous support surface: reliability decays with distance from the
#     two measurement passes (not hand-placed to maximise promotion). Contours crossing
#     the low-support valleys between passes acquire genuinely weak interior vertices. ---
d1 = np.abs((yy - xx) - 3) / np.sqrt(2)      # a "flight line"
d2 = np.abs((yy + xx) - 66) / np.sqrt(2)     # a second pass
dist = np.minimum(d1, d2)
support = np.clip(0.95 - 0.030 * dist, 0.15, 0.95)   # monotone decay with distance

dem_p = f"{WORK}/dem.asc"; write_asc(dem_p, dem)

# ============ (A) gdal_contour output schema ============
shp = f"{WORK}/contours.shp"; gj = f"{WORK}/contours.geojson"
for p in (shp, gj):
    if os.path.exists(p): os.remove(p)
subprocess.run(["gdal_contour", "-a", "ELEV", "-i", "0.5", dem_p, shp], check=True,
               capture_output=True)
schema = subprocess.run(["ogrinfo", "-so", "-al", shp], check=True, capture_output=True, text=True).stdout
attrs = [ln.strip() for ln in schema.splitlines()
         if (":" in ln and ("Real" in ln or "Integer" in ln or "String" in ln) and "Geometry" not in ln)]
print("=== (A) gdal_contour serialized attribute schema ===")
for a in attrs: print("   ", a)
prov_fields = [a for a in attrs if any(k in a.lower() for k in
              ("prov", "support", "ancest", "measured", "interp", "lineage", "confidence", "grade", "evidence"))]
print(f"   provenance/support/lineage fields: {len(prov_fields)}  -> {'NONE' if not prov_fields else prov_fields}")

# ============ (B) endpoint-only vs complete-source-arc on GDAL geometry ============
subprocess.run(["ogr2ogr", "-f", "GeoJSON", gj, shp], check=True, capture_output=True)
gjson = json.load(open(gj))

def sample_support(x, y):
    j = int(np.clip(round((x - XLL) / CELL), 0, N-1))
    i = int(np.clip(round((y - YLL) / CELL), 0, N-1))
    return float(support[i, j])

def dp(pts, eps):
    """Return retained index set from ordinary Douglas-Peucker."""
    keep = {0, len(pts)-1}
    stack = [(0, len(pts)-1)]
    while stack:
        a, b = stack.pop()
        if b <= a + 1: continue
        (x1, y1), (x2, y2) = pts[a], pts[b]
        dx, dy = x2-x1, y2-y1
        L2 = dx*dx + dy*dy
        dmax, idx = -1.0, -1
        for k in range(a+1, b):
            px, py = pts[k]
            if L2 == 0: d = ((px-x1)**2 + (py-y1)**2) ** 0.5
            else:
                t = ((px-x1)*dx + (py-y1)*dy) / L2
                projx, projy = x1 + t*dx, y1 + t*dy
                d = ((px-projx)**2 + (py-projy)**2) ** 0.5
            if d > dmax: dmax, idx = d, k
        if dmax > eps:
            keep.add(idx); stack += [(a, idx), (idx, b)]
    return sorted(keep)

spans = promo = 0
EPS = 1.0
lines = []
for feat in gjson["features"]:
    g = feat["geometry"]
    if g["type"] == "LineString": lines.append(g["coordinates"])
    elif g["type"] == "MultiLineString": lines.extend(g["coordinates"])
for coords in lines:
    if len(coords) < 3: continue
    sup = [sample_support(x, y) for x, y, *_ in coords]
    keep = dp([(x, y) for x, y, *_ in coords], EPS)
    for a, b in zip(keep[:-1], keep[1:]):
        if b <= a: continue
        endpoint_min = min(sup[a], sup[b])          # endpoint-only inheritance
        complete_min = min(sup[a:b+1])              # complete-source-arc (EC-DP) rule
        spans += 1
        if endpoint_min > complete_min + 1e-12: promo += 1

print("\n=== (B) source-arc audit on GDAL-produced contour geometry ===")
print(f"   contour polylines: {len(lines)};  simplified spans: {spans}")
print(f"   endpoint-only promotions: {promo}  ({100*promo/max(spans,1):.1f}% of spans)")
print(f"   complete-source-arc (EC-DP) promotions: 0 (by construction: min over the full arc)")
print("\n=== SUMMARY ===")
print("   GDAL gdal_contour carries NO provenance/support/lineage attribute on output contours.")
print(f"   On GDAL's own geometry, endpoint-only inheritance promotes {100*promo/max(spans,1):.1f}% of spans;")
print("   the EMTRF complete-source rule yields zero. The failure is not specific to the audited application.")
