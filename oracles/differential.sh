#!/usr/bin/env bash
# Cross-language DP/EC-DP differential oracle (Section 4.1, Table 3).
# 1) regenerate the shared corpus and assert byte-identity with the committed frozen file;
# 2) run the shipped JavaScript EC-DP and an independent Python reimplementation on it;
# 3) assert their ordinary-DP indices, EC-DP indices, source intervals, and complete-arc
#    support are identical (support within 1e-15). Any mismatch exits non-zero.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p results
node make_corpus.mjs > results/_corpus_regen.jsonl
if ! cmp -s results/_corpus_regen.jsonl fixtures/differential_2500.jsonl; then
  echo "differential: FAIL -- regenerated corpus != committed fixtures/differential_2500.jsonl" >&2
  rm -f results/_corpus_regen.jsonl
  exit 1
fi
rm -f results/_corpus_regen.jsonl
node js_differential.mjs
python3 dpecdp_differential.py
python3 compare_differential.py
