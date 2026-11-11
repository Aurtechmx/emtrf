"""Illustrative, fully deterministic contour example for EMTRF (not a field result).

A synthetic DTM with a known measured/interpolated mask and a known support field shows, on
one map: (a) what display grade draws, (b) where each segment's elevations come from, and
(c, d) what an attribute query keeps after Douglas-Peucker simplification when each simplified
segment takes its record from its two end segments or from every segment it replaces.
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


# --- Known support field (0-100). Measured cells: high near each flight line's centre, falling to
# the edge of the swath; one stretch of the first line has few returns. Interpolated cells: low.
dmin = np.minimum(d1, d2)
sup = np.where(measured, 100.0*(1.0 - 0.45*(dmin/4.0)**2), 30.0/(1.0 + 0.25*np.maximum(dmin-4.0, 0.0)))
weak = measured & (np.hypot(xx-21, yy-23) < 3.2)          # sparse returns on one flight line
sup = np.where(weak, 25.0, sup)

def block(px, py):
    i = int(np.clip(np.floor(py), 0, n-2)); j = int(np.clip(np.floor(px), 0, n-2))
    return support[i:i+2, j:j+2], sup[i:i+2, j:j+2]
def edge_record(p, q):
    """Provenance set and support of a source segment: union and minimum over its 2x2 block."""
    st, sv = block((p[0]+q[0])/2, (p[1]+q[1])/2)
    prov = ({"M"} if (st == 2).any() else set()) | ({"I"} if (st == 1).any() else set())
    return prov, float(sv.min())
def passes(prov, s, t=66.0):
    return prov == {"M"} and s >= t
def dp(pts, eps):
    keep = [0, len(pts)-1]
    def rec(a, b):
        if b <= a+1: return
        p, q = pts[a], pts[b]; d = q-p; L = np.hypot(*d)
        dist = [abs(d[0]*(p[1]-pts[k][1]) - d[1]*(p[0]-pts[k][0]))/L if L else np.hypot(*(pts[k]-p)) for k in range(a+1, b)]
        k = int(np.argmax(dist)) + a + 1
        if dist[k-a-1] > eps: keep.append(k); rec(a, k); rec(k, b)
    rec(0, len(pts)-1); return sorted(set(keep))

EPS = 1.0   # one-cell tolerance, as in the field runs
CORRECT, FALSE_ACC, WRONG_REJ = BLUE, VERM, "#7A5195"
tot = {"len": 0.0, "qual": 0.0, "end": dict(fa=0.0, wr=0.0, ca=0.0), "ec": dict(fa=0.0, wr=0.0, ca=0.0)}
draw = {"end": [], "ec": []}
for seg in cs.allsegs:
    for line in seg:
        if len(line) < 3: continue
        pts = np.asarray(line); keep = dp(pts, EPS)
        recs = [edge_record(pts[k], pts[k+1]) for k in range(len(pts)-1)]
        for a, b in zip(keep[:-1], keep[1:]):
            arc = recs[a:b]
            end = (recs[a][0] | recs[b-1][0], min(recs[a][1], recs[b-1][1]))
            ec = (set().union(*[r[0] for r in arc]), min(r[1] for r in arc))
            for k in range(a, b):
                L = float(np.hypot(*(pts[k+1]-pts[k]))); ok = passes(*recs[k]); tot["len"] += L; tot["qual"] += L*ok
                for name, r in (("end", end), ("ec", ec)):
                    acc = passes(*r)
                    kind = ("ca" if ok else "fa") if acc else ("wr" if ok else "cr")
                    if kind != "cr": tot[name][kind] += L
                    draw[name].append((pts[k], pts[k+1], kind))

# --- Plot: four panels, same isolines ---
mpl.rcParams.update({"axes.labelsize": 8, "xtick.labelsize": 7, "ytick.labelsize": 7})
fig, axs = plt.subplots(2, 2, figsize=(5.6, 6.1), sharex=True, sharey=True)
axs = axs.ravel()
bg_cmap = ListedColormap(["#FFF5D8", "#DCEEF7"])   # I, M
for ax in axs:
    ax.imshow(np.where(support == 2, 1, 0), origin="lower", extent=[0, n, 0, n],
              cmap=bg_cmap, interpolation="nearest", alpha=0.72, aspect="equal")
    ax.set_xlim(0, n); ax.set_ylim(0, n)
    ax.tick_params(labelcolor=GREY, color=MID)
for ax in axs[2:]: ax.set_xlabel("Easting (cells)")
for ax in axs[0::2]: ax.set_ylabel("Northing (cells)")
grade_style = {"solid": dict(color=BLUE, ls="-", lw=1.4), "dashed": dict(color=ORANGE, ls="--", lw=1.3)}
typed_style = {"M": dict(color=BLUE, ls="-", lw=1.4), "I": dict(color=ORANGE, ls="--", lw=1.4),
               "X": dict(color=GREEN, ls="-", lw=1.9)}
for seg in cs.allsegs:
    for line in seg:
        if len(line) < 2: continue
        for k in range(len(line) - 1):
            (x0, y0), (x1, y1) = line[k], line[k+1]
            mx, my = (x0+x1)/2, (y0+y1)/2
            axs[0].plot([x0, x1], [y0, y1], **grade_style[cell_grade(mx, my)])
            axs[1].plot([x0, x1], [y0, y1], **typed_style[cell_ancestry(mx, my)])
out_style = {"ca": dict(color=CORRECT, ls="-", lw=1.6), "fa": dict(color=FALSE_ACC, ls="-", lw=2.6),
             "wr": dict(color=WRONG_REJ, ls=(0, (2.2, 1.4)), lw=1.8), "cr": dict(color="#9A9EA3", ls="-", lw=0.6)}
for ax, name in ((axs[2], "end"), (axs[3], "ec")):
    for order in ("cr", "ca", "wr", "fa"):
        for p, q, kind in draw[name]:
            if kind == order: ax.plot([p[0], q[0]], [p[1], q[1]], **out_style[kind])

axs[0].set_title("(a) Display grade", fontweight="bold", color=BLACK, fontsize=8.5)
axs[1].set_title("(b) Provenance", fontweight="bold", color=BLACK, fontsize=8.5)
axs[2].set_title("(c) Query on endpoint records", fontweight="bold", color=BLACK, fontsize=8.5)
axs[3].set_title("(d) Query on EC-DP records", fontweight="bold", color=BLACK, fontsize=8.5)
leg = dict(loc="upper right", frameon=True, facecolor="white", framealpha=0.88, edgecolor="lightgrey", fontsize=7)
grade_handles = [Line2D([0],[0], color=BLUE, lw=1.5, ls="-", label="solid"),
                 Line2D([0],[0], color=ORANGE, lw=1.5, ls="--", label="dashed")]
prov_handles = [Line2D([0],[0], color=BLUE, lw=1.6, ls="-", label="M"),
                Line2D([0],[0], color=ORANGE, lw=1.6, ls="--", label="I"),
                Line2D([0],[0], color=GREEN, lw=2.0, ls="-", label="X (mixed)")]
outcome_handles = [Line2D([0],[0], **out_style["ca"], label="accepted, source passes"),
                   Line2D([0],[0], **out_style["fa"], label="accepted, source fails"),
                   Line2D([0],[0], **out_style["wr"], label="rejected, source passes"),
                   Line2D([0],[0], **out_style["cr"], label="rejected, source fails")]
bg_handles = [Patch(facecolor="#DCEEF7", edgecolor=MID, label="Measured-derived DTM cell"),
              Patch(facecolor="#FFF5D8", edgecolor=MID, label="Interpolated-derived DTM cell")]
fig.legend(handles=outcome_handles + bg_handles, loc="lower center", ncol=3, frameon=False,
           bbox_to_anchor=(0.5, 0.0), fontsize=7, columnspacing=1.2, handlelength=2.2)
# panel (a)/(b) keys sit below the figure, off the contours
fig.legend(handles=grade_handles, title="(a) display grade", loc="upper center", ncol=2, frameon=False,
           bbox_to_anchor=(0.30, 0.0), fontsize=7, title_fontsize=7, handlelength=2.2)
fig.legend(handles=prov_handles, title="(b) provenance", loc="upper center", ncol=3, frameon=False,
           bbox_to_anchor=(0.70, 0.0), fontsize=7, title_fontsize=7, handlelength=2.2)
fig.subplots_adjust(bottom=0.135, wspace=0.08, hspace=0.30, top=0.96)
for ax in axs[2:]: ax.set_xticks([0, 10, 20, 30])
for ax, name in ((axs[2], "end"), (axs[3], "ec")):
    fa = 100*tot[name]["fa"]/tot["len"]; ret = 100*tot[name]["ca"]/tot["qual"]
    # result line under the panel title, so no contour is covered
    ax.text(0.5, 1.012, ("false acceptance: none" if fa == 0 else f"false acceptance: {fa:.1f}% of total source length") + f"\nqualifying length kept: {ret:.0f}%",
            transform=ax.transAxes, ha="center", va="bottom", fontsize=7, color=GREY)
    ax.set_title(ax.get_title(), fontweight="bold", color=BLACK, fontsize=8.5, pad=24)
fig.savefig(OUT/"fig9_contour_example.pdf", bbox_inches="tight", pad_inches=0.05, dpi=300)
fig.savefig(PNG/"fig9_contour_example.png", bbox_inches="tight", pad_inches=0.05, dpi=150)
plt.close(fig)
f = lambda v: round(100*v/tot["len"], 1)
print("contour length (cells)", round(tot["len"], 1), "qualifying", round(tot["qual"], 1))
for name in ("end", "ec"):
    print(name, "false-accept %", f(tot[name]["fa"]), "wrong-reject %", f(tot[name]["wr"]),
          "retention %", round(100*tot[name]["ca"]/tot["qual"], 1) if tot["qual"] else None)
