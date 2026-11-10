#!/usr/bin/env bash
# GDAL chain: bin returns (gdal_rasterize -add), mean, fill gaps (fill-nodata), distance to data
# (proximity), contour (gdal_contour), simplify (GEOS topology-preserving Douglas-Peucker).
# Usage: run_gdal.sh WORKDIR SITE_ID XMIN YMIN XMAX YMAX CELL
set -euo pipefail
W=$1; S=$2; X0=$3; Y0=$4; X1=$5; Y1=$6; C=$7
D=$W/gdal/$S; rm -rf "$D"; mkdir -p "$D"
OO="-oo X_POSSIBLE_NAMES=x -oo Y_POSSIBLE_NAMES=y"
gdal_rasterize -q $OO -a z -add -init 0 -a_nodata 0 -te $X0 $Y0 $X1 $Y1 -tr $C $C -ot Float64 "$W/$S.csv" "$D/sum.tif"
gdal_rasterize -q $OO -burn 1 -add -init 0 -a_nodata 0 -te $X0 $Y0 $X1 $Y1 -tr $C $C -ot Float64 "$W/$S.csv" "$D/count.tif"
gdal_rasterize -q $OO -burn 1 -init 0 -te $X0 $Y0 $X1 $Y1 -tr $C $C -ot Byte "$W/$S.csv" "$D/hasdata.tif"
gdal raster edit --nodata none "$D/hasdata.tif"
gdal raster calc -q -i "$D/sum.tif" -i "$D/count.tif" --dialect builtin --calc div --propagate-nodata --nodata -9999 --ot Float64 -o "$D/mean.tif"
gdal raster proximity -q --target-values 1 --distance-units pixel --max-distance 100000 --ot Float32 -i "$D/hasdata.tif" -o "$D/dist.tif"
gdal raster fill-nodata -q --max-distance 10 -i "$D/mean.tif" -o "$D/dtm.tif"
gdal_contour -q -a elev -i $C "$D/dtm.tif" "$D/contours.gpkg"
gdal vector simplify -q -i "$D/contours.gpkg" -o "$D/simplified.gpkg" --tolerance $C
for r in count dist dtm; do gdal raster convert -q -f AAIGrid "$D/$r.tif" "$D/$r.asc"; done
for v in contours simplified; do ogr2ogr -f GeoJSON -lco COORDINATE_PRECISION=9 "$D/$v.geojson" "$D/$v.gpkg"; done
