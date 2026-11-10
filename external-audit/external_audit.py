"""Endpoint attribution on third-party contours (rules: PREREGISTRATION.md, part B).

Contours and points: Zenodo 10.5281/zenodo.12771247 (You and Lee, 2024; CC0), as published. This
script bins the points, gives every published contour segment the evidence of the cell under its
midpoint, simplifies the published lines with third-party simplifiers at a tolerance of one cell and
compares the record built from a span's two end segments with the record of all segments it replaces.
"""
import csv, gzip, json, math, sys
from pathlib import Path
import numpy as np
from scipy.ndimage import distance_transform_edt
from simplification.cutil import simplify_coords, simplify_coords_vw

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "ablation"))
from ecwrap_tools import simplifiers, score  # noqa: E402


def load():
    rd = lambda n: list(csv.reader(gzip.open(HERE / "data" / n, "rt")))
    c = rd("contour.csv.gz"); header = [h.strip() for h in c[0]]
    lines = {}
    for x, y, z, i in c[1:]:
        lines.setdefault(int(float(i)), []).append((float(x), float(y), float(z)))
    P = np.array([[float(v) for v in r] for r in rd("lidar_xyz.csv.gz")[1:]])
    return header, lines, P


def evidence(lines, P, L, x0, y0, x1, y1):
    C, R = int(math.floor((x1 - x0) / L)) + 1, int(math.floor((y1 - y0) / L)) + 1
    n = np.zeros((R, C), dtype=int)
    np.add.at(n, (np.floor((P[:, 1] - y0) / L).astype(int), np.floor((P[:, 0] - x0) / L).astype(int)), 1)
    dist = distance_transform_edt(n == 0) * L  # centre-to-centre distance to the nearest measured cell
    runs = []
    for V in lines:
        E = []
        for (ax, ay), (bx, by) in zip(V[:-1], V[1:]):
            r, c = int(math.floor(((ay + by) / 2 - y0) / L)), int(math.floor(((ax + bx) / 2 - x0) / L))
            E.append({"M": int(n[r, c]), "I": None, "provenance": "M"} if n[r, c] else {"M": None, "I": -float(dist[r, c]), "provenance": "I"})
        runs.append((V, E))
    return runs, {"cols": C, "rows": R, "measuredCellPct": round(100 * float((n > 0).mean()), 1)}


if __name__ == "__main__":
    header, raw, P = load()
    kept = [[[x, y] for x, y, _ in v] for v in raw.values() if len(v) >= 3]
    xs = [p[0] for v in kept for p in v] + list(P[:, 0]); ys = [p[1] for v in kept for p in v] + list(P[:, 1])
    x0, y0, x1, y1 = min(xs), min(ys), max(xs), max(ys)
    spacing = math.sqrt((P[:, 0].max() - P[:, 0].min()) * (P[:, 1].max() - P[:, 1].min()) / len(P))
    L0 = float(math.ceil(spacing))
    tools, versions, missing = simplifiers()
    rust = {"Rust DP": lambda Ls, t: [[list(p) for p in simplify_coords(V, t)] for V in Ls],
            "Rust VW": lambda Ls, t: [[list(p) for p in simplify_coords_vw(V, t * t)] for V in Ls]}
    rows = []
    for L, S in ((L0, {**rust, **tools}), (L0 / 2, {"Rust DP": rust["Rust DP"]}), (L0 * 2, {"Rust DP": rust["Rust DP"]})):
        runs, grid = evidence(kept, P, L, x0, y0, x1, y1)
        segs = [e for _, E in runs for e in E]
        for label, f in S.items():
            row = {"cellSizeM": L, "simplifier": label, **score(runs, f([V for V, _ in runs], L)),
                   "measuredSegmentPct": round(100 * sum(e["provenance"] == "M" for e in segs) / len(segs), 1), **grid}
            rows.append(row)
            print(f"L={L:4.1f} {label:13s} lines {row['lines']:4d} red {row['vertexReductionPct']:5.1f}% spans {row['spans']:6d} endpoint prom "
                  f"{row['endpointPromotion']} ({row['endpointPromotionPct']}%) loss {row['endpointProvenanceLoss']} ({row['endpointProvenanceLossPct']}%) "
                  f"ecwrap {row['ecwrapPromotion']}/{row['ecwrapProvenanceLoss']} removed {row['linesRemovedByTool']} unmatched {row['linesNotSubsequence']}")
    out = {"driver": "endpoint attribution on third-party contours", "rules": "external-audit/PREREGISTRATION.md, part B",
           "source": "doi:10.5281/zenodo.12771247 (CC0)", "contourFileColumns": header,
           "publishedLines": len(raw), "linesWithFewerThanThreeVertices": len(raw) - len(kept),
           "publishedContourVertices": sum(len(v) for v in raw.values()), "points": int(len(P)),
           "nominalPointSpacingM": round(spacing, 3), "primaryCellSizeM": L0,
           "versions": ["simplification 2.0.0 (Rust)"] + versions, "toolsNotInstalled": missing, "rows": rows}
    (HERE.parent / "results" / "external_audit_r1.json").write_text(json.dumps(out, indent=1) + "\n")
