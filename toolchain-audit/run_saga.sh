#!/usr/bin/env bash
# SAGA chain: bin returns (Shapes to Grid, mean + count), fill gaps (Close Gaps), distance to data
# (Proximity Grid), contour (Contour Lines from Grid), simplify (Line Simplification, Douglas-Peucker).
# Usage: run_saga.sh WORKDIR SITE_ID XMIN YMIN XMAX YMAX CELL   (needs SAGA_CMD or saga_cmd in PATH)
set -euo pipefail
W=$1; S=$2; X0=$3; Y0=$4; X1=$5; Y1=$6; C=$7
SAGA=${SAGA_CMD:-saga_cmd}; PY=${EMTRF_TOOLCHAIN_PY:-python3}
D=$W/saga/$S; rm -rf "$D"; mkdir -p "$D"
tr ',' '\t' < "$W/$S.csv" > "$D/points.xyz"
CX0=$(python3 -c "print($X0+$C/2)"); CX1=$(python3 -c "print($X1-$C/2)"); CY0=$(python3 -c "print($Y0+$C/2)"); CY1=$(python3 -c "print($Y1-$C/2)")
G="-TARGET_DEFINITION 0 -TARGET_USER_SIZE $C -TARGET_USER_XMIN $CX0 -TARGET_USER_XMAX $CX1 -TARGET_USER_YMIN $CY0 -TARGET_USER_YMAX $CY1"
$SAGA -f=q io_shapes 3 -POINTS "$D/points.shp" -HEADLINE 1 -FILENAME "$D/points.xyz"
$SAGA -f=q grid_gridding 0 -INPUT "$D/points.shp" -FIELD z -OUTPUT 2 -MULTIPLE 4 $G -GRID "$D/mean.sgrd" -COUNT "$D/count.sgrd"
$SAGA -f=q grid_tools 26 -FEATURES "$D/mean.sgrd" -DISTANCE "$D/distm.sgrd"
$SAGA -f=q grid_calculus 1 -GRIDS "$D/distm.sgrd" -RESULT "$D/dist.sgrd" -FORMULA "g1/$C"
$SAGA -f=q grid_tools 7 -INPUT "$D/mean.sgrd" -RESULT "$D/dtm.sgrd"
$SAGA -f=q shapes_grid 5 -GRID "$D/dtm.sgrd" -CONTOUR "$D/contours.shp" -ZSTEP $C -LINE_PARTS 1
$SAGA -f=q shapes_lines 4 -LINES "$D/contours.shp" -OUTPUT "$D/simplified.shp" -TOLERANCE $C
for r in count dist dtm; do $SAGA -f=q io_grid 0 -GRID "$D/$r.sgrd" -FILE "$D/$r.asc" -FORMAT 1 -GEOREF 0 -PREC -1; done
"$PY" "$(dirname "$0")/shp_to_geojson.py" "$D/contours.shp" "$D/contours.geojson"
"$PY" "$(dirname "$0")/shp_to_geojson.py" "$D/simplified.shp" "$D/simplified.geojson"
