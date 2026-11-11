"""Worked example on real data: one span traced from returns to exported record.

Reads results/worked_example_r2.json, written by ablation/worked_example.cjs. Every value drawn
comes from that file; nothing is typed by hand.
"""
import json
from pathlib import Path

import matplotlib as mpl
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.colors import LinearSegmentedColormap
from matplotlib.lines import Line2D
from matplotlib.patches import Rectangle

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "figures"
PNG = OUT / "_png"
PNG.mkdir(parents=True, exist_ok=True)
mpl.rcParams.update({"font.family": "Helvetica Neue", "mathtext.fontset": "stixsans", "font.size": 8.5,
                     "pdf.fonttype": 42, "ps.fonttype": 42, "axes.linewidth": 0.8, "axes.edgecolor": "#B7BBBF"})
BLUE = "#0072B2"; VERM = "#D55E00"; INK = "#222222"; GREY = "#5F6368"; MID = "#D4D7DA"

d = json.load(open(ROOT / "results" / "worked_example_r2.json"))
E = d["example"]; W = E["window"]; cs = E["cellSizeM"]
ox = E["origin"][0] + W["col0"] * cs
oy = E["origin"][1] + W["row0"] * cs
weak = E["weakestCell"]

fig, (ax, bx) = plt.subplots(1, 2, figsize=(7.3, 3.7), gridspec_kw={"width_ratios": [1.0, 1.15]})

# ---- (a) returns -> cells -> source line -> DP chord ----
cmap = LinearSegmentedColormap.from_list("ret", ["#FFFFFF", "#9ECAE1", "#3E7CB1"])
vmax = max(c["returns"] for c in W["cells"])
for c in W["cells"]:
    x0, y0 = (c["col"] - W["col0"]) * cs, (c["row"] - W["row0"]) * cs
    face = cmap(c["returns"] / vmax) if c["coverage"] == "measured" else "#EDEDED"
    ax.add_patch(Rectangle((x0, y0), cs, cs, facecolor=face, edgecolor="white", lw=0.6, zorder=1))
    ax.text(x0 + cs / 2, y0 + cs / 2, str(c["returns"]), ha="center", va="center", fontsize=6.3,
            color=INK if c["returns"] < 0.7 * vmax else "white", zorder=2)
R = np.array(W["returns"])
ax.scatter(R[:, 0] - ox, R[:, 1] - oy, s=1.2, color=INK, alpha=0.22, lw=0, zorder=3)
wx, wy = (weak["col"] - W["col0"]) * cs, (weak["row"] - W["row0"]) * cs
ax.add_patch(Rectangle((wx, wy), cs, cs, fill=False, edgecolor=VERM, lw=1.8, zorder=6))
a, b = E["spanVertexRange"]
V = np.array(E["runVertices"])[a:b + 1] - [ox, oy]
ax.plot(V[:, 0], V[:, 1], color=INK, lw=1.0, marker="o", ms=3.2, mfc="white", mew=0.9, zorder=4)
ax.plot(V[[0, -1], 0], V[[0, -1], 1], color=BLUE, lw=2.0, zorder=5, solid_capstyle="round")
nx_ = W["col1"] - W["col0"] + 1
ax.annotate(f"{weak['returns']} returns\n(site median {E['medianReturnsPerMeasuredCell']:g})",
            xy=(wx + cs, wy + cs), xytext=(nx_ * cs + 0.25, wy + cs), fontsize=7, color=INK, va="center", annotation_clip=False,  # outside the grid so no cell count is hidden
            bbox=dict(boxstyle="round,pad=0.25", fc="white", ec=VERM, lw=0.8),
            arrowprops=dict(arrowstyle="-", color=VERM, lw=0.9), zorder=7)
nx, ny = W["col1"] - W["col0"] + 1, W["row1"] - W["row0"] + 1
ax.set_xlim(0, nx * cs); ax.set_ylim(0, ny * cs); ax.set_aspect("equal")
ax.set_xlabel("Easting, local (m)"); ax.set_ylabel("Northing, local (m)")
ax.tick_params(labelsize=7, colors=GREY)
ax.set_title(f"(a) {E['site']}, {E['levelM']:g} m contour", fontweight="bold", color=INK, fontsize=9, loc="left")
ax.legend(handles=[Line2D([0], [0], color=INK, lw=1.0, marker="o", ms=3.2, mfc="white", label=f"source line ({E['sourceEdges']} edges)"),
                   Line2D([0], [0], color=BLUE, lw=2.0, label="DP span (one chord)"),
                   Rectangle((0, 0), 1, 1, fill=False, edgecolor=VERM, lw=1.6, label="weakest source cell"),
                   Rectangle((0, 0), 1, 1, facecolor="#EDEDED", edgecolor="none", label="no returns; number = returns per 1 m cell")],
          loc="upper left", bbox_to_anchor=(0.0, -0.17), ncol=1, frameon=False, fontsize=7)

# ---- (b) per-edge measured support along the line vs the two exported records ----
L = np.cumsum([0] + [e["lengthM"] for e in E["edges"]])
sup = [e["measuredSupport"] for e in E["edges"]]
thr = 66
for i, s in enumerate(sup):
    if s < thr:
        bx.axvspan(L[i], L[i + 1], color=VERM, alpha=0.10, lw=0, zorder=0)
bx.step(L, sup + [sup[-1]], where="post", color=INK, lw=1.4, zorder=3)
bx.axhline(thr, color=GREY, lw=0.8, ls=":", zorder=1)
dp, ec = E["dpRecord"]["measuredSupport"], E["ecdpRecord"]["measuredSupport"]
bx.axhline(dp, color=BLUE, lw=1.6, ls="--", zorder=4)
bx.axhline(ec, color=VERM, lw=1.6, ls="--", zorder=4)
bx.text((L[1] + L[4]) / 2, dp + 2.5, f"DP record: {dp:g}  (query accepts)", ha="center", va="bottom", fontsize=7.2, color=INK)
bx.text((L[1] + L[4]) / 2, ec + 2.5, f"EC-DP record: {ec:g}  (query rejects)", ha="center", va="bottom", fontsize=7.2, color=INK)
bx.text(L[-1] - 0.04, thr - 2.5, f"threshold {thr}", ha="right", va="top", fontsize=6.8, color=GREY)
below = sum(e["lengthM"] for e in E["edges"] if e["measuredSupport"] < thr)
bx.text((L[1] + L[4]) / 2, 40, f"{below:.2f} m of {L[-1]:.2f} m\nbelow threshold", ha="center", va="center", fontsize=7, color=INK)
bx.set_xlim(0, L[-1]); bx.set_ylim(0, 100)
bx.set_xlabel("Distance along source line (m)"); bx.set_ylabel("Measured support of source edge (0–100)")
bx.tick_params(labelsize=7, colors=GREY)
for s in ("top", "right"):
    bx.spines[s].set_visible(False)
bx.set_title("(b) What the exported record says", fontweight="bold", color=INK, fontsize=9, loc="left")
bx.legend(handles=[Line2D([0], [0], color=INK, lw=1.4, label="source edges (reference)"),
                   Line2D([0], [0], color=BLUE, lw=1.6, ls="--", label="DP, endpoint attribution"),
                   Line2D([0], [0], color=VERM, lw=1.6, ls="--", label="EC-DP, complete source")],
          loc="upper left", bbox_to_anchor=(0.0, -0.17), ncol=1, frameon=False, fontsize=7)

fig.subplots_adjust(left=0.07, right=0.99, top=0.91, bottom=0.33, wspace=0.62)
fig.savefig(OUT / "fig10_worked_example.pdf", dpi=300)
fig.savefig(PNG / "fig10_worked_example.png", dpi=200)
print("done")
