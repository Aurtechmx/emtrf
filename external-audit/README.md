# External audit: contours and points published by other authors

Supplementary Methods S19. Rules: `PREREGISTRATION.md` (written before any evidence was computed).

## Data

You, G., Lee, Y. (2024). Zenodo, doi:10.5281/zenodo.12771247, **CC0 1.0**. Two files of that record
are used as published:

| File here | From the record | Rows | MD5 of the file here |
|---|---|---|---|
| `data/contour.csv.gz` | contour table (X, Y, Z, LineNum) | 139,271 vertices, 1,015 lines | `caac27eb19bbee4f4c15fac0e5b419fb` |
| `data/lidar_xyz.csv.gz` | LiDAR point table (X, Y, Z) | 96,502 points | `cd93aeb21c1a6cc066c025e4f0474402` |

`ods2csv.py` is the conversion from the record's spreadsheet files to these CSVs; values are not
changed. The record does not say how the contours were drawn. The contour file has no evidence field.

## Run

```bash
$EMTRF_TOOLCHAIN_PY external-audit/external_audit.py
```

Needs numpy, scipy and `simplification` (`toolchain-audit/requirements.txt`). QGIS 3.40 and
mapshaper 0.6.102 are optional; set `QGIS_PROCESS` and `MAPSHAPER` if they are not on `PATH`.
Simplifiers that are not installed are listed under `toolsNotInstalled` in the output and skipped.
Output: `results/external_audit_r1.json`.

## What it shows and what it does not

The evidence rule (point count per 5 m cell; distance to the nearest measured cell for empty cells)
is ours, applied to geometry and points we did not produce. Endpoint attribution promoted support on
28.0–40.7 % of spans under six simplifiers; EC-wrap's records showed no promotion and no provenance
loss. The test shows that the mechanism operates on external data; how often published products contain
the failure is left to a prevalence study.
