"""WhiteboxTools chain: bin returns (VectorPointsToRaster mean + number), fill gaps (FillMissingData),
distance to data (EuclideanDistance), contour (ContoursFromRaster, smoothing and generalisation off),
simplify (scikit-image approximate_polygon, Douglas-Peucker; WhiteboxTools has no line simplifier).
Usage: run_whitebox.py WORKDIR SITE_ID XMIN YMIN XMAX YMAX CELL
"""
import json, shutil, subprocess, sys
from pathlib import Path
import numpy as np
import tifffile
import whitebox
from skimage.measure import approximate_polygon
sys.path.insert(0, str(Path(__file__).resolve().parent))
from shp_to_geojson import convert

W, S = Path(sys.argv[1]), sys.argv[2]; X0, Y0, X1, Y1, C = map(float, sys.argv[3:8])
D = W / "whitebox" / S; shutil.rmtree(D, ignore_errors=True); D.mkdir(parents=True)
cols, rows = round((X1 - X0) / C), round((Y1 - Y0) / C)
(D / "base.asc").write_text(f"ncols {cols}\nnrows {rows}\nxllcorner {X0}\nyllcorner {Y0}\ncellsize {C}\nnodata_value -9999\n" + ("0.0 " * cols + "\n") * rows)  # float zeros: WhiteboxTools types outputs from the base raster
wbt = whitebox.WhiteboxTools(); wbt.set_verbose_mode(False); wbt.set_working_dir(str(D))
def run(name, **kw):
    # The wrapper returns 0 even when the tool panics, so the output file is checked as well.
    out = D / kw["output"]
    if wbt.run_tool(name, [f"--{k}={v}" if v is not True else f"--{k}" for k, v in kw.items()]) != 0 or not out.exists():
        raise SystemExit(f"WhiteboxTools {name} failed")
run("NewRasterFromBase", base="base.asc", output="base.tif", value=0.0, data_type="double")
run("CsvPointsToVector", input=str(W / f"{S}.csv"), output="points.shp", xfield=0, yfield=1)
# assign=mean and --nodata both panic in v2.4.0, so the cell mean is sum / number with empty cells
# marked as nodata by SetNodataValue.
run("VectorPointsToRaster", input="points.shp", field="z", output="sum.tif", assign="sum", base="base.tif")
run("VectorPointsToRaster", input="points.shp", field="z", output="count.tif", assign="number", base="base.tif")
run("SetNodataValue", input="count.tif", output="countnd.tif", back_value=0.0)
run("Divide", input1="sum.tif", input2="countnd.tif", output="mean.tif")
run("FillMissingData", input="mean.tif", output="dtm.tif", filter=21, weight=2.0)
run("EuclideanDistance", input="count.tif", output="distm.tif")
run("Divide", input1="distm.tif", input2=str(C), output="dist.tif")
run("ContoursFromRaster", input="dtm.tif", output="contours.shp", interval=C, base=0.0, smooth=1, tolerance=0.0)
# WhiteboxTools' own ASCII export writes the lower-left corner one cell too far north (v2.4.0), so
# the GeoTIFFs are read directly and their georeference is checked against the requested grid.
for r in ("count", "dist", "dtm"):
    with tifffile.TiffFile(D / f"{r}.tif") as t:
        a = t.asarray().astype(float); tags = t.pages[0].tags
        tie = tags["ModelTiepointTag"].value; scale = tags["ModelPixelScaleTag"].value
        nd = float(tags["GDAL_NODATA"].value) if "GDAL_NODATA" in tags else None
    if a.shape != (rows, cols) or abs(tie[3] - X0) > 1e-6 or abs(tie[4] - Y1) > 1e-6 or abs(scale[0] - C) > 1e-9:
        raise SystemExit(f"{r}.tif georeference differs from the requested grid")
    if nd is not None: a[a == nd] = -9999.0
    (D / f"{r}.asc").write_text(f"ncols {cols}\nnrows {rows}\nxllcorner {X0}\nyllcorner {Y0}\ncellsize {C}\nnodata_value -9999\n"
                                + "\n".join(" ".join(repr(float(v)) for v in row) for row in a) + "\n")
convert(D / "contours.shp", D / "contours.geojson")
src = json.loads((D / "contours.geojson").read_text())
for f in src["features"]:
    c = np.array(f["geometry"]["coordinates"]); f["geometry"]["coordinates"] = approximate_polygon(c, tolerance=C).tolist()
(D / "simplified.geojson").write_text(json.dumps(src))
