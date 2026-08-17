# benchmarks/

EC-DP overhead timing (Section 4.3).

- `reproduce.sh` runs the synthetic microbenchmark (`performanceBenchmark.ts`): 640,000 source
  vertices (10,000 x 64-vertex polylines and other sizes), 30 paired repetitions. Writes
  `results/performance.json`. Requires Node 22.
- `reconstruct_real_contour_timing.cjs` runs the four-site real-contour benchmark: it rebuilds
  the exact documented corpus (289 stitched polylines, 5,305 source vertices per pass) and times
  ordinary DP against the complete-source evidence pass with matched retained geometry. Run:
  `node benchmarks/reconstruct_real_contour_timing.cjs`. This is a reconstructed driver (see
  `../docs/RECONSTRUCTED_DRIVERS.md`).
- `reported_values.csv` holds the manuscript's reported medians (author reference machine).

Absolute timing is single-machine and machine/JIT-dependent; the corpus identity and protocol
(warmups, 30 paired repetitions, batched passes) are reproduced exactly, the wall-clock is not.
