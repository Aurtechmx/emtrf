#!/usr/bin/env bash
# Third-party toolchain audit. Six independent chains, each run when its tools are
# installed: GDAL (>= 3.11 for the `gdal` CLI), GRASS 8, SAGA (SAGA_CMD or saga_cmd; QGIS bundles
# it), WhiteboxTools (Python `whitebox` package), R lidR + isoband + sf, and SciPy + scikit-image.
# Python packages: toolchain-audit/requirements.txt, interpreter from EMTRF_TOOLCHAIN_PY.
set -euo pipefail
cd "$(dirname "$0")"
PY=${EMTRF_TOOLCHAIN_PY:-python3}; export EMTRF_TOOLCHAIN_PY=$PY
if [ -z "${SAGA_CMD:-}" ]; then
  SAGA_CMD=$(command -v saga_cmd || true)
  [ -z "$SAGA_CMD" ] && [ -x /Applications/QGIS-LTR.app/Contents/MacOS/bin/saga_cmd ] && SAGA_CMD=/Applications/QGIS-LTR.app/Contents/MacOS/bin/saga_cmd
  export SAGA_CMD
fi
has() { case $1 in
  gdal) command -v gdal >/dev/null && command -v gdal_contour >/dev/null ;;
  grass) command -v grass >/dev/null ;;
  saga) [ -n "$SAGA_CMD" ] && "$PY" -c "import shapefile" 2>/dev/null ;;
  whitebox) "$PY" -c "import whitebox, tifffile, shapefile, skimage" 2>/dev/null ;;
  lidr) command -v Rscript >/dev/null && Rscript -e 'for(p in c("lidR","isoband","sf","terra")) if(!requireNamespace(p,quietly=TRUE)) quit(status=1)' >/dev/null 2>&1 ;;
  scipy) "$PY" -c "import scipy, skimage" 2>/dev/null ;;
esac; }
W=$(mktemp -d "${TMPDIR:-/tmp}/emtrf_toolchain.XXXXXX")
node export_points.cjs "$W" >/dev/null
python3 - "$W" <<'PY' > "$W/grids.txt"
import json,sys
for s in json.load(open(sys.argv[1]+"/sites.json")):
    print(s["id"], s["originH1"], s["originH2"], s["originH1"]+s["cols"]*s["cellSizeM"], s["originH2"]+s["rows"]*s["cellSizeM"], s["cellSizeM"])
PY
RAN=""
for ch in gdal grass saga whitebox lidr scipy; do
  has $ch || { echo "  $ch: tools not installed, chain skipped" >&2; continue; }
  RAN="$RAN $ch"
  while read -r id x0 y0 x1 y1 c; do
    case $ch in
      gdal)     ./run_gdal.sh  "$W" "$id" "$x0" "$y0" "$x1" "$y1" "$c" ;;
      grass)    ./run_grass.sh "$W" "$id" "$x0" "$y0" "$x1" "$y1" "$c" ;;
      saga)     ./run_saga.sh  "$W" "$id" "$x0" "$y0" "$x1" "$y1" "$c" ;;
      whitebox) "$PY" run_whitebox.py "$W" "$id" "$x0" "$y0" "$x1" "$y1" "$c" ;;
      lidr)     Rscript run_lidr.R "$W" "$id" "$x0" "$y0" "$x1" "$y1" "$c" ;;
      scipy)    "$PY" run_scipy.py "$W" "$id" "$x0" "$y0" "$x1" "$y1" "$c" ;;
    esac > "$W/$ch.$id.log" 2>&1 || { echo "FAILED: $ch on $id (see log below)" >&2; tail -20 "$W/$ch.$id.log" >&2; exit 1; }
  done < "$W/grids.txt"
done
"$PY" attribute.py "$W" ../results/toolchain_audit_r3.json
{ echo "chains run:$RAN"
  command -v gdal >/dev/null && gdal --version
  command -v grass >/dev/null && grass --version | head -1
  [ -n "$SAGA_CMD" ] && "$SAGA_CMD" --version 2>&1 | head -1
  "$PY" -c "import whitebox,numpy,scipy,skimage;w=whitebox.WhiteboxTools();print(w.version().splitlines()[0]);print('NumPy',numpy.__version__,'SciPy',scipy.__version__,'scikit-image',skimage.__version__)" 2>/dev/null
  command -v Rscript >/dev/null && Rscript -e 'cat(R.version.string,"lidR",format(packageVersion("lidR")),"isoband",format(packageVersion("isoband")),"sf",format(packageVersion("sf")),"terra",format(packageVersion("terra")),"\n")' 2>/dev/null
} > ../results/toolchain_audit_versions.txt
[ -n "${KEEP:-}" ] || rm -rf "$W"
