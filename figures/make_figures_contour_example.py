"""Illustrative, fully-deterministic worked contour example for EMTRF.

NOT a field result: a synthetic DTM with a known measured/interpolated support mask,
used only to show, in one place, how a typed complete-source contour differs from a
grade-styled one. Every value is generated deterministically from a fixed seed.
"""
import numpy as np
import matplotlib as mpl
import matplotlib.pyplot as plt
import seaborn as sns
from pathlib import Path
from matplotlib.colors import ListedColormap
from matplotlib.lines import Line2D
from matplotlib.patches import Patch

# Paths are resolved relative to the package root so figures regenerate on any machine.
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "figures"; OUT.mkdir(parents=True, exist_ok=True)
PNG = ROOT / "figures" / "_png"; PNG.mkdir(parents=True, exist_ok=True)
sns.set_theme(font_scale=1.0, style="white", font="Helvetica Neue")
mpl.rcParams.update({"font.family":"Helvetica Neue","mathtext.fontset":"stixsans",
                     "pdf.fonttype":42,"ps.fonttype":42,"axes.linewidth":0.8,"axes.edgecolor":"#B7BBBF"})
# Okabe-Ito colorblind-safe palette.
BLUE="#0072B2"; ORANGE="#E69F00"; GREEN="#009E73"; VERM="#D55E00"; BLACK="#222222"; GREY="dimgrey"; MID="#D4D7DA"

# --- Deterministic synthetic DTM (smooth two-bump surface) ---
rng = np.random.default_rng(20260809)
n = 40
yy, xx = np.mgrid[0:n, 0:n].astype(float)
Z = (3.0*np.exp(-(((xx-13)/9)**2 + ((yy-15)/9)**2))
     + 2.2*np.exp(-(((xx-28)/7)**2 + ((yy-26)/8)**2))
     + 0.04*(xx+yy))

# --- Known support mask: measured (2) near two diagonal "flight lines", interpolated (1) elsewhere ---
d1 = np.abs((yy - xx) - 2) / np.sqrt(2)          # distance to line y = x+2
d2 = np.abs((yy + xx) - 46) / np.sqrt(2)         # distance to line y = -x+46
measured = (np.minimum(d1, d2) < 4.0)
support = np.where(measured, 2, 1)               # 2 = measured-derived, 1 = interpolated-derived

# --- Contours via marching-squares (matplotlib) ---
levels = np.arange(1.0, 5.0, 0.5)
cs = plt.contour(xx, yy, Z, levels=levels)
plt.close()

def cell_ancestry(px, py):
    """Ancestry of the 2x2 DTM block containing point (px,py): 'M','I', or 'X'."""
    i = int(np.clip(np.floor(py), 0, n-2)); j = int(np.clip(np.floor(px), 0, n-2))
    block = support[i:i+2, j:j+2]
    has_m = (block == 2).any(); has_i = (block == 1).any()
    return "X" if (has_m and has_i) else ("M" if has_m else "I")

# grade proxy: a contour vertex is "solid" over measured cells, "dashed" over interpolated
def cell_grade(px, py):
    i = int(np.clip(np.round(py), 0, n-1)); j = int(np.clip(np.round(px), 0, n-1))
    return "solid" if support[i, j] == 2 else "dashed"

# --- Plot: two panels, same isolines, different evidence semantics ---
fig, axs = plt.subplots(1, 2, figsize=(7.3, 3.8), sharex=True, sharey=True)
bg_cmap = ListedColormap(["#FFF5D8", "#DCEEF7"])   # I, M
for ax in axs:
    ax.imshow(np.where(support == 2, 1, 0), origin="lower", extent=[0, n, 0, n],
              cmap=bg_cmap, interpolation="nearest", alpha=0.72, aspect="equal")
    ax.set_xlim(0, n); ax.set_ylim(0, n); ax.set_xlabel("Easting (cells)")
    ax.tick_params(labelcolor=GREY, color=MID)
axs[0].set_ylabel("Northing (cells)")

grade_style = {"solid": dict(color=BLUE, ls="-", lw=1.4), "dashed": dict(color=ORANGE, ls="--", lw=1.3)}
typed_style = {"M": dict(color=BLUE, ls="-", lw=1.4), "I": dict(color=ORANGE, ls="--", lw=1.4),
               "X": dict(color=GREEN, ls="-", lw=1.9)}

for seg in cs.allsegs:
    for line in seg:
        if len(line) < 2:
            continue
        for k in range(len(line) - 1):
            (x0, y0), (x1, y1) = line[k], line[k+1]
            mx, my = (x0+x1)/2, (y0+y1)/2
            axs[0].plot([x0, x1], [y0, y1], **grade_style[cell_grade(mx, my)])
            axs[1].plot([x0, x1], [y0, y1], **typed_style[cell_ancestry(mx, my)])

axs[0].set_title("(a) Display-grade styling", fontweight="bold", color=BLACK)
axs[1].set_title("(b) Typed complete-source ancestry", fontweight="bold", color=BLACK)

left_handles = [Line2D([0],[0], color=BLUE, lw=1.5, ls="-", label="solid"),
                Line2D([0],[0], color=ORANGE, lw=1.5, ls="--", label="dashed")]
right_handles = [Line2D([0],[0], color=BLUE, lw=1.6, ls="-", label="M"),
                 Line2D([0],[0], color=ORANGE, lw=1.6, ls="--", label="I"),
                 Line2D([0],[0], color=GREEN, lw=2.0, ls="-", label="X (mixed)")]
axs[0].legend(handles=left_handles, loc="upper right", frameon=True, facecolor="white",
              framealpha=0.85, edgecolor="lightgrey", fontsize=7.5, ncol=2)
axs[1].legend(handles=right_handles, loc="upper right", frameon=True, facecolor="white",
              framealpha=0.85, edgecolor="lightgrey", fontsize=7.5, ncol=3)
bg_handles = [Patch(facecolor="#DCEEF7", edgecolor=MID, label="Measured-derived DTM cell"),
              Patch(facecolor="#FFF5D8", edgecolor=MID, label="Interpolated-derived DTM cell")]
fig.legend(handles=bg_handles, loc="lower center", ncol=2, frameon=False,
           bbox_to_anchor=(0.5, -0.06), fontsize=7.6)
fig.suptitle("Worked contour example: identical isolines, grade vs. typed ancestry",
             fontweight="bold", y=1.0, color=BLACK)
fig.subplots_adjust(bottom=0.16, wspace=0.08, top=0.86)
fig.savefig(OUT/"fig9_contour_example.pdf", bbox_inches="tight", pad_inches=0.05, dpi=300)
fig.savefig(PNG/"fig9_contour_example.png", bbox_inches="tight", pad_inches=0.05, dpi=150)
plt.close(fig)
print("done")
