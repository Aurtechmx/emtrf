"""SciPy / scikit-image chain: bin returns (NumPy), fill gaps (scipy.interpolate.griddata, linear
Delaunay), distance to data (scipy.ndimage.distance_transform_edt), contour
(skimage.measure.find_contours), simplify (skimage.measure.approximate_polygon, Douglas-Peucker).
Usage: run_scipy.py WORKDIR SITE_ID XMIN YMIN XMAX YMAX CELL
"""
import json, shutil, sys
from pathlib import Path
import numpy as np
from scipy.interpolate import griddata
from scipy.ndimage import distance_transform_edt
from skimage.measure import approximate_polygon, find_contours

W, S = Path(sys.argv[1]), sys.argv[2]; X0, Y0, X1, Y1, C = map(float, sys.argv[3:8])
D = W / "scipy" / S; shutil.rmtree(D, ignore_errors=True); D.mkdir(parents=True)
cols, rows = round((X1 - X0) / C), round((Y1 - Y0) / C)
P = np.loadtxt(W / f"{S}.csv", delimiter=",", skiprows=1, ndmin=2)
c = np.floor((P[:, 0] - X0) / C).astype(int); r = np.floor((P[:, 1] - Y0) / C).astype(int)
ok = (c >= 0) & (c < cols) & (r >= 0) & (r < rows)
count = np.zeros((rows, cols)); total = np.zeros((rows, cols))
np.add.at(count, (r[ok], c[ok]), 1); np.add.at(total, (r[ok], c[ok]), P[ok, 2])
meas = count > 0
mean = np.where(meas, total / np.where(meas, count, 1), np.nan)
rr, cc = np.mgrid[0:rows, 0:cols]
dtm = mean.copy()
dtm[~meas] = griddata((cc[meas], rr[meas]), mean[meas], (cc[~meas], rr[~meas]), method="linear")
dist = distance_transform_edt(~meas)

def asc(a, f):  # row 0 = south in memory; written north-up
    a = np.where(np.isfinite(a), a, -9999.0)[::-1]
    (D / f).write_text(f"ncols {cols}\nnrows {rows}\nxllcorner {X0!r}\nyllcorner {Y0!r}\ncellsize {C!r}\nnodata_value -9999\n"
                       + "\n".join(" ".join(repr(float(v)) for v in row) for row in a) + "\n")
asc(count, "count.asc"); asc(dist, "dist.asc"); asc(dtm, "dtm.asc")
valid = np.isfinite(dtm); filled = np.where(valid, dtm, np.nanmin(dtm))
levels = np.arange(np.ceil(np.nanmin(dtm) / C) * C, np.floor(np.nanmax(dtm) / C) * C + C / 2, C)
src, simp = [], []
for lv in levels:
    for line in find_contours(filled, lv, mask=valid):
        xy = np.c_[X0 + (line[:, 1] + 0.5) * C, Y0 + (line[:, 0] + 0.5) * C]
        if len(xy) < 2: continue
        for out, g in ((src, xy), (simp, approximate_polygon(xy, tolerance=C))):
            out.append({"type": "Feature", "properties": {"level": float(lv)}, "geometry": {"type": "LineString", "coordinates": g.tolist()}})
(D / "contours.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": src}))
(D / "simplified.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": simp}))
