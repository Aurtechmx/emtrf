# Third-party toolchain audit

The main study builds its DTM, contours and simplified lines with the production OLV modules.
This audit rebuilds all three with six independent, free and open-source toolchains, then applies
the endpoint and complete-source attribution rules to each tool's own output. No OLV or PDAL code
runs in any chain.

| Chain | Bin returns per cell | Fill empty cells | Distance to data | Contours | Simplify (tolerance = cell size) |
|---|---|---|---|---|---|
| GDAL | `gdal_rasterize -add` | `gdal raster fill-nodata` | `gdal raster proximity` | `gdal_contour` | `gdal vector simplify` (GEOS, topology-preserving) |
| GRASS GIS | `r.in.xyz` | `r.fillnulls` | `r.grow.distance` | `r.contour` | `v.generalize method=douglas` |
| SAGA GIS | Shapes to Grid | Close Gaps | Proximity Grid | Contour Lines from Grid | Line Simplification |
| WhiteboxTools | VectorPointsToRaster (sum, number) | FillMissingData | EuclideanDistance | ContoursFromRaster | scikit-image `approximate_polygon` |
| R lidR | `lidR::pixel_metrics` | `lidR::rasterize_terrain` (TIN) | `terra::distance` | `isoband::isolines` | `sf::st_simplify` |
| SciPy / scikit-image | NumPy | `scipy.interpolate.griddata` (linear) | `scipy.ndimage.distance_transform_edt` | `skimage.measure.find_contours` | `skimage.measure.approximate_polygon` |

WhiteboxTools has no line simplifier, so its lines are simplified with scikit-image. Every
simplifier is a Douglas-Peucker implementation.

`export_points.cjs` decodes the committed crops into x,y,z CSV and records the production cell
counts for comparison. `attribute.py` reads each tool's count and distance rasters and its source
and simplified lines. The evidence of a source edge comes from the 2x2 block of cell centres it
crosses, and the script checks that every block brackets the contour level. Support is compared
by order only (return count for measured cells, distance to data for empty cells), so the
promotion counts hold for any support function that rises with return count and falls with
distance to data.

Cell counts. The tools assign returns to cells by four different rules, recorded per chain in the
output (`binningRule`), and re-binning the returns with each rule reproduces that tool's counts in
every cell at every site:
- production and NumPy: half-open cells, rows counted from the south;
- GDAL, GRASS, WhiteboxTools: a return lying exactly on a horizontal cell edge goes to the cell above;
- lidR: as GDAL, after rounding coordinates to its 0.001 LAS scale, keeping returns that lie on the
  outer grid boundary;
- SAGA: as production, but returns in the outer half-cell band are outside its grid extent.

Tool notes (WhiteboxTools 2.4.0): `VectorPointsToRaster` panics with `assign=mean` or `--nodata`,
so the cell mean is `sum / number`; its ASCII export writes the lower-left corner one cell too far
north, so the GeoTIFF outputs are read directly and their georeference is checked; the Python
wrapper returns 0 when a tool panics, so every output file is checked.

Run: `bash toolchain-audit/reproduce.sh`. Each chain runs when its tools are installed (GDAL >= 3.11
for the `gdal` CLI; GRASS 8; SAGA via `SAGA_CMD` or `saga_cmd`, which QGIS bundles; R with lidR,
isoband, sf and terra; Python packages in `requirements.txt`, interpreter from
`EMTRF_TOOLCHAIN_PY`). Output: `results/toolchain_audit_r3.json`; versions in
`results/toolchain_audit_versions.txt`.
