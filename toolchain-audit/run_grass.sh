#!/usr/bin/env bash
# GRASS chain: bin returns (r.in.xyz mean and n), fill gaps (r.fillnulls), distance to data
# (r.grow.distance), contour (r.contour), simplify (v.generalize method=douglas).
# Usage: run_grass.sh WORKDIR SITE_ID XMIN YMIN XMAX YMAX CELL
set -euo pipefail
W=$1; S=$2; X0=$3; Y0=$4; X1=$5; Y1=$6; C=$7
D=$W/grass/$S; rm -rf "$D"; mkdir -p "$D"
cat > "$D/job.sh" <<JOB
set -e
export GRASS_OVERWRITE=1 GRASS_VERBOSE=0
g.region w=$X0 s=$Y0 e=$X1 n=$Y1 res=$C
r.in.xyz input=$W/$S.csv output=mean method=mean separator=comma skip=1
r.in.xyz input=$W/$S.csv output=n method=n separator=comma skip=1
r.fillnulls input=mean output=dtm method=bilinear
r.grow.distance input=mean distance=distm metric=euclidean
r.mapcalc expression="dist = distm / $C"
r.contour input=dtm output=contours step=$C
v.generalize input=contours output=simplified method=douglas threshold=$C
r.out.gdal input=n output=$D/count.asc format=AAIGrid nodata=0 -c
r.out.gdal input=dist output=$D/dist.asc format=AAIGrid -c
r.out.gdal input=dtm output=$D/dtm.asc format=AAIGrid -c
v.out.ogr input=contours output=$D/contours.geojson format=GeoJSON lco=COORDINATE_PRECISION=9
v.out.ogr input=simplified output=$D/simplified.geojson format=GeoJSON lco=COORDINATE_PRECISION=9
JOB
grass --tmp-project XY --exec bash "$D/job.sh"
