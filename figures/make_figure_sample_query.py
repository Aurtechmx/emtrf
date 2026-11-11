"""Support promotion across the 3DEP probability sample and the cost of conservative filtering.

Reads results/prevalence_3dep_r1.json (rules D4) and results/query_sample_r1.json (rules D5).
Panel (a): per-crop share of simplified spans with promoted support under endpoint records,
crops ranked by that share; crops with fewer than 20 spans as open symbols. Panels (b) and (c):
pooled sample estimates with crop-bootstrap 95% intervals at query threshold 66, on separate axes.
"""
import json
import matplotlib as mpl
import matplotlib.lines
import matplotlib.pyplot as plt
import seaborn as sns
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "figures"; PNG = OUT / "_png"; PNG.mkdir(parents=True, exist_ok=True)
sns.set_theme(font_scale=1.0, style="white", font="Helvetica Neue")
mpl.rcParams.update({"font.family": "Helvetica Neue", "pdf.fonttype": 42, "axes.edgecolor": "#B8BCC2",
                     "axes.labelsize": 8, "xtick.labelsize": 7, "ytick.labelsize": 7})
BLUE, VERM, BLACK, GREY = "#0072B2", "#D55E00", "#222222", "dimgrey"

prev = json.loads((ROOT / "results" / "prevalence_3dep_r1.json").read_text())
q = json.loads((ROOT / "results" / "query_sample_r1.json").read_text())["summary"]["66"]
crops = sorted(prev["crops"], key=lambda c: 100 * c["promoted"] / c["spans"])
rate = [100 * c["promoted"] / c["spans"] for c in crops]
small = [c["spans"] < 20 for c in crops]
assert prev["allValidCrops"]["ecPromoted"] == 0 and q["pooled"]["ecdp"]["falseAcceptPerKm"] == 0

fig = plt.figure(figsize=(5.6, 4.3))
gs = fig.add_gridspec(2, 2, width_ratios=[1.2, 1], hspace=0.75, wspace=0.42)
ax = fig.add_subplot(gs[:, 0])
x = list(range(1, len(crops) + 1))
P2 = prev["P2"]
ax.axhspan(P2["q1Pct"], P2["q3Pct"], color="#EEEFF1", zorder=0, lw=0)
ax.axhline(P2["medianPct"], color=GREY, lw=0.8, ls=(0, (3, 2)), zorder=1)
ax.text(len(crops), P2["q1Pct"] - 1.0, f"dashed: median {P2['medianPct']:.1f}%\ngrey band: quartiles\n(crops with \u226520 spans)",
        fontsize=6.8, color=GREY, va="top", ha="right")
ax.scatter([i for i, sm in zip(x, small) if not sm], [r for r, sm in zip(rate, small) if not sm],
           s=13, color=VERM, label="crop with \u226520 spans", zorder=3)
ax.scatter([i for i, sm in zip(x, small) if sm], [r for r, sm in zip(rate, small) if sm],
           s=16, facecolor="white", edgecolor=VERM, lw=1.1, label="crop with <20 spans", zorder=3)
ax.axhline(0, color=BLUE, lw=1.6, zorder=2)
ax.text(len(crops), 1.2, "EC-DP: 0 in every crop", color=BLUE, ha="right", va="bottom", fontsize=7.5)
ax.set_xlim(0, len(crops) + 1); ax.set_ylim(-3, 62)
ax.set_xlabel("Crops ranked by endpoint promotion"); ax.set_ylabel("Spans with promoted support,\nendpoint records (%)")
ax.set_xticks([1, 20, 40, 60])
ax.set_title(f"(a) Promotion per crop: {prev['P1']['cropsWithPromotion']}/{prev['P1']['validCrops']} crops", loc="left", fontweight="bold", fontsize=8.5, color=BLACK)
ax.legend(loc="upper left", frameon=True, facecolor="white", edgecolor="none", framealpha=1, fontsize=7, borderaxespad=0.6)


def interval(axh, rows, xlabel, title, notes):
    for y, (label, v, lo, hi, col) in enumerate(rows):
        axh.plot([lo, hi], [y, y], color=col, lw=2.2, solid_capstyle="butt")
        axh.plot([v], [y], "o", color=col, ms=6, mec="white", mew=0.8)
        axh.text(hi if hi > lo else lo, y - 0.14, f"{v:.1f} [{lo:.1f}–{hi:.1f}]" if hi > lo else "0, guaranteed by the rule", fontsize=7,
                 color=col, ha="right" if hi > lo else "left", va="bottom")
    axh.set_yticks(range(len(rows))); axh.set_yticklabels([r[0] for r in rows], fontsize=7.5)
    axh.set_ylim(-0.6 - 0.9*any(n[1] > 0.5 for n in notes), len(rows) + 0.55); axh.invert_yaxis()
    axh.set_xlabel(xlabel, fontsize=7.5); axh.tick_params(axis="x", labelsize=7)
    axh.set_title(title, loc="left", fontweight="bold", fontsize=8.5, color=BLACK)
    for (tx, ty, ha, va, text) in notes:
        axh.text(tx, ty, text, transform=axh.transAxes, fontsize=7, color=GREY, ha=ha, va=va)

P, D = q["pooled"], q["pooledDifferenceEcdpMinusEndpoint"]
r = lambda v: round(v, 1)
DIFF = ("difference: %.1f points\n[%.1f, %.1f]" % (D["retentionPctPoints"], *D["retention95"])).replace("-", "\u2212").replace("EC\u2212DP", "EC-DP")
axb = fig.add_subplot(gs[0, 1])
interval(axb, [("Endpoint", r(P["endpoint"]["falseAcceptPerKm"]), *map(r, P["endpoint"]["falseAccept95"]), VERM),
               ("EC-DP", 0, 0, 0, BLUE)],
         "Failing source line accepted (m/km)", "(b) Overstatement cost",
         [(0.98, 0.04, "right", "bottom", f"false acceptance in\n{q['cropsWithFalseAcceptance']['endpoint']}/{q['crops']} crops (endpoint)")])
axb.set_xlim(-2, 50)
axc = fig.add_subplot(gs[1, 1])
interval(axc, [("Endpoint", r(P["endpoint"]["retentionPct"]), *map(r, P["endpoint"]["retention95"]), VERM),
               ("EC-DP", r(P["ecdp"]["retentionPct"]), *map(r, P["ecdp"]["retention95"]), BLUE)],
         "Qualifying source line retained (%)", "(c) Retention cost",
         [(0.02, 0.98, "left", "top", f"{q['cropsWithQualifyingLength']}/{q['crops']} crops\nwith qualifying line"),
          (0.97, 0.04, "right", "bottom", DIFF)])
axc.set_xlim(20, 80)
for a in (ax, axb, axc):
    sns.despine(ax=a)

fig.savefig(OUT / "fig11_sample_query.pdf", bbox_inches="tight", pad_inches=0.05)
fig.savefig(PNG / "fig11_sample_query.png", bbox_inches="tight", pad_inches=0.05, dpi=150)

# Concentration of the pooled t = 66 values (stated in the figure caption).
rows = [c for c in json.loads((ROOT / "results" / "query_sample_r1.json").read_text())["crops"] if c["t66"]]
def top3(vals):
    v = sorted(vals, reverse=True); return round(100 * sum(v[:3]) / sum(v), 1)
conc = {"falseAcceptLengthTop3CropsPct": top3([c["t66"]["endpoint"]["fa"] for c in rows]),
        "qualifyingLengthTop3CropsPct": top3([c["t66"]["qualifyingM"] for c in rows]),
        "medianCropFalseAcceptPerKm": q["typicalCrop"]["endpoint"]["falseAcceptPerKm"]["median"]}
(ROOT / "results" / "query_sample_concentration.json").write_text(json.dumps(conc, indent=1) + "\n")
print(conc)
