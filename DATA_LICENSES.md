# Third-party data licenses

The MIT `LICENSE` in this repository covers the **EMTRF code only**. The redistributed
LiDAR-derived crops under `real-data-audit/crops/` are third-party data under their own terms:

| Crop | Source | License / status |
|---|---|---|
| StREAM (`sl-field.bin`) | Virginia Tech StREAM Lab, OpenTopography DOI 10.5069/G9NZ85W7 | **CC BY 4.0**, attribution required (Hession et al., 2026) |
| Marsh Island (`marsh-island__ground.f32`) | USGS, DOI 10.5066/P19TLXVG | CC0 / U.S. public domain (Over et al., 2024) |
| Marsh Island RTK checkpoints (`external-check/marsh-island__checkpoints.json`, 104 check shots in the crop frame) | USGS, DOI 10.5066/P19TLXVG | CC0 / U.S. public domain (Over et al., 2024) |
| Coconino checkpoints and ground-return patches (`external-check/coconino__checkpoints.json`, `external-check/coconino__ground.f32`; 60 accuracy checkpoints, returns within 3 m of each) | USGS 3DEP, AZ Coconino B1 2019 (project 19049), The National Map | U.S. public domain |
| White Sands (`whitesands-dune__ground.f32`) | USGS 3DEP | U.S. Government public domain |
| External audit (`external-audit/data/contour.csv.gz`, `lidar_xyz.csv.gz`) | You and Lee (2024), Zenodo 10.5281/zenodo.12771247 | **CC0 1.0** |
| 3DEP probability sample (`prevalence/`, crops fetched by `draw_sample.py`) | USGS 3D Elevation Program point clouds, public Entwine Point Tile resources (index: github.com/hobuinc/usgs-lidar) | U.S. Government public domain |
| Estonia Tava (`estonia-tava__ground.f32`) | Estonian Land and Spatial Development Board (2020 elevation/LiDAR), via Zenodo 10.5281/zenodo.19232743 | Estonian Land and Spatial Development Board Open Data License; derivatives and redistribution permitted with attribution |

Attribution for CC BY 4.0 data (StREAM) is required in any downstream use. The MIT license
covers EMTRF code only; each redistributed dataset keeps the license in the table above. The
Estonia crop's terms are resolved in full below.

## Estonia crop attribution and license

The Estonia Tava crop derives from Estonian Land and Spatial Development Board 2020
elevation/LiDAR data (via Zenodo 10.5281/zenodo.19232743). That data is published under the
Board's Open Data License, which permits producing derivatives, adapting and combining, using
commercially or non-commercially, and redistributing the data, provided the data origin and date
are identified and the open-data license is referenced.

Attribution: source data (c) Estonian Land and Spatial Development Board, 2020 elevation data,
Open Data License (https://geoportaal.maaruum.ee/eng/spatial-data/elevation-data-p308.html; licence text: https://geoportaal.maaamet.ee/opendata-licence).

## Acknowledgement and changes made

USGS data (3DEP crops, White Sands, Marsh Island): "Data from the U.S. Geological Survey, 3D Elevation
Program." USGS asks for this acknowledgement and places no restriction on use.

Changes made to the redistributed crops (relevant to the CC BY 4.0 StREAM data, stated for all of
them): each crop is a clipped extract of the source point cloud, limited to ground-classified
returns, and stored as 32-bit floating-point values relative to a crop origin in a compact binary
file. No other change was made.
