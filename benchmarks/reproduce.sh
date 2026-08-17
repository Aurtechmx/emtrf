#!/usr/bin/env bash
# Runnable EC-DP metadata-overhead microbenchmark (Section 4.3, synthetic leg).
# Node >= 22. Timing is machine-dependent; the committed results/performance.json is a
# representative single-machine record, not a cross-platform performance claim.
set -euo pipefail
cd "$(dirname "$0")"
tmp="$(mktemp -d)"
cp ../js-study/reference/typedEvidenceOperators.ts ../js-study/reference/evidenceConstrainedGeneralizeTyped.ts \
   ../js-study/experiments/source-arc-stress/performanceBenchmark.ts "$tmp/"
perl -0pi -e "s/(from '\.\/[A-Za-z0-9_]+)'/\$1.ts'/g" "$tmp"/*.ts
mkdir -p results
if [ "${1:-}" = "--sweep" ]; then export EMTRF_SWEEP=1; fi
node --experimental-strip-types "$tmp/performanceBenchmark.ts" > results/performance.json
rm -rf "$tmp"
echo "wrote results/performance.json"
