"""Restyle EMTRF figures 1-7 (+ supplementary S1) in the matplotlib-skill aesthetic.

Figure 8 (StREAM map) is intentionally left untouched (its data file is not in the
package). All numeric values are copied verbatim from make_figures_nextlevel.py so the
restyle changes only presentation, never reported results.
"""
import numpy as np
import matplotlib as mpl
import matplotlib.pyplot as plt
import seaborn as sns
from pathlib import Path
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch, Patch

# --- EMTRF: ablation values are loaded from the committed strict analysis output, never
# --- hardcoded. Hardcoding let the manuscript, supplement and figures drift apart once.
import json as _json, os as _os
def _load_ablation():
    _p = _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), "..", "results",
                       "ablation_reconstructed_strict.json")
    with open(_p) as _f:
        _t = _f.read(); _d = _json.loads(_t[_t.find("{"):])
    def _rows(o, a=None):
        a = [] if a is None else a
        if isinstance(o, dict):
            if "frozenTarget" in o: a.append(o)
            for v in o.values(): _rows(v, a)
        elif isinstance(o, list):
            for v in o: _rows(v, a)
        return a
    _order = ["White Sands", "Estonia Tava", "StREAM", "Marsh Island"]
    _by = {r["label"]: r for r in _rows(_d)}
    _missing = [s for s in _order if s not in _by]
    if _missing:
        raise SystemExit("ablation schema mismatch; missing sites: %s" % _missing)
    for _k in ("vertexReductionPct","supportPromotionPct","gradeProvenanceLossPct",
               "typedEndpointProvenanceLossPct"):
        for _s in _order:
            if _k not in _by[_s]:
                raise SystemExit("ablation schema mismatch; %s missing %s" % (_s, _k))
    _r1 = lambda k: [round(_by[s][k], 1) for s in _order]
    return (_r1("vertexReductionPct"), _r1("supportPromotionPct"),
            _r1("gradeProvenanceLossPct"), _r1("typedEndpointProvenanceLossPct"))
_ABL_RED, _ABL_PROM, _ABL_GRADE, _ABL_TYPED = _load_ablation()


# Paths are resolved relative to the package root so figures regenerate on any machine.
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "figures"; OUT.mkdir(parents=True, exist_ok=True)
SUP = ROOT / "supplementary"; SUP.mkdir(parents=True, exist_ok=True)
PNG = ROOT / "figures" / "_png"; PNG.mkdir(parents=True, exist_ok=True)

# --- Style Setup (restrained journal style: despined, Helvetica Neue + STIX-sans math,
#     Okabe-Ito colorblind-safe palette). Preferred for Computers & Geosciences. ---
sns.set_theme(font_scale=1.0, style="whitegrid", font="Helvetica Neue")
mpl.rcParams.update({
    "font.family": "Helvetica Neue", "mathtext.fontset": "stixsans",
    "font.size": 8.5, "axes.titlesize": 10.5, "axes.labelsize": 9,
    "xtick.labelsize": 8, "ytick.labelsize": 8, "legend.fontsize": 8,
    "figure.titlesize": 11, "pdf.fonttype": 42, "ps.fonttype": 42,
    "axes.linewidth": 0.8, "axes.edgecolor": "#B7BBBF",
    "axes.titleweight": "bold", "axes.grid.axis": "y",
    "grid.color": "#E4E6E8", "grid.linewidth": 0.7,
})
# Okabe-Ito colorblind-safe palette.
BLUE="#0072B2"; ORANGE="#E69F00"; GREEN="#009E73"; VERM="#D55E00"; BLACK="#222222"
GREY="dimgrey"; MID="#D4D7DA"
LEG = dict(frameon=True, facecolor="white", framealpha=0.8, edgecolor="lightgrey")

def finish(fig, name, folder=OUT, despine=True):
    if despine:
        for ax in fig.axes:
            sns.despine(ax=ax, left=True, bottom=True)
    fig.savefig(folder/name, bbox_inches="tight", pad_inches=0.05, dpi=300)
    fig.savefig(PNG/name.replace(".pdf", ".png"), bbox_inches="tight", pad_inches=0.05, dpi=150)
    plt.close(fig)

def dimticks(ax):
    ax.tick_params(labelcolor=GREY, color=MID)

# ============ Figure 1 (file fig3): pipeline schematic ============
# Even 6-box grid: margins + equal boxes + equal gutters, boxes sized to fit their text.
fig, ax = plt.subplots(figsize=(7.6, 2.55)); ax.set_xlim(0,1); ax.set_ylim(0,1); ax.axis("off")
N=6; ML=0.012; g=0.020
boxW=(1-2*ML-(N-1)*g)/N; step=boxW+g
BY0, BH = 0.40, 0.33; BMID=BY0+BH/2
xs=[ML+i*step for i in range(N)]
labels=["Terrain\nobservations","DTM +\nevidence\n$z,\\,p,\\,S,\\,A,\\,\\ell$","Contour\nextraction",
        "Stitch +\nsmooth","EC-DP\nsimplification","Vector\nexport"]
for i,(x,lbl) in enumerate(zip(xs,labels)):
    fc="#EAF4F8" if i<2 else "#F7F7F7"; ec=BLUE if i<2 else BLACK
    ax.add_patch(FancyBboxPatch((x,BY0),boxW,BH,boxstyle="round,pad=0.006,rounding_size=.012",
                                facecolor=fc,edgecolor=ec,lw=1.05))
    ax.text(x+boxW/2,BMID,lbl,ha="center",va="center",color=BLACK,fontsize=8.0,
            fontweight="bold" if i in (1,4) else "normal")
    if i<N-1:
        ax.add_patch(FancyArrowPatch((x+boxW,BMID),(xs[i+1],BMID),arrowstyle="-|>",mutation_scale=9,lw=.9,color=GREY))
# stage labels centred over their box groups
c=lambda i: xs[i]+boxW/2
ax.text((c(0)+c(1))/2,.84,"terrain estimation",ha="center",va="center",fontweight="bold",color=BLACK)
ax.text((c(2)+c(5))/2,.84,"representation-only operators",ha="center",va="center",fontweight="bold",color=BLACK)
# divider sits in the gutter between box 2 and box 3, clear of both boxes
ax.plot([xs[2]-g/2, xs[2]-g/2],[0.36,0.78],ls="--",lw=.9,color=GREY)
ax.text(.5,.22,"Representation-only operators conserve provenance, absorb unsupported inputs,\n"
        "and never promote support within a declared semantic channel.",ha="center",va="center",fontsize=8.3,color=BLACK)
ax.text(.5,.07,"Declared inference may create a new support/uncertainty channel, "
        "but must expose its method, calibration semantics, and lineage.",ha="center",va="center",fontsize=7.8,color=GREY)
finish(fig,"fig3_emtrf_pipeline.pdf",despine=False)

# ============ Figure 2 (file fig1): source arc, two panels ============
x=np.arange(7); geom=np.array([0,0.018,0.009,0.014,0.006,0.015,0]); sup=np.array([.93,.97,.88,.18,.90,.95,.93])
fig=plt.figure(figsize=(7.2,4.15)); gs=fig.add_gridspec(2,1,height_ratios=[1,1.15],hspace=.18)
ax=fig.add_subplot(gs[0])
ax.plot(x,geom,"o-",lw=1.6,ms=4.5,label="Source polyline",color=BLUE)
ax.plot([0,6],[0,0],ls="--",lw=1.7,label="Simplified chord (both methods)",color=ORANGE)
ax.set_ylabel("Geometry\n(arb. units)"); ax.set_xticks(x); ax.set_xticklabels([]); ax.set_ylim(-.002,.025)
ax.legend(loc="upper center",ncol=2,**LEG)
ax.set_title("Identical geometry, two different inherited support values",fontweight="bold",color=BLACK)
dimticks(ax)
ax2=fig.add_subplot(gs[1])
bars=ax2.bar(x,sup,width=.52,edgecolor="white",lw=.6,color=BLUE)
bars[3].set_facecolor(VERM); bars[3].set_hatch("////")
for xi,yi in zip(x,sup):
    ax2.text(xi,yi+.025,f"{yi:.2f}",ha="center",va="bottom",fontsize=7.6,
             color=BLACK if xi==3 else GREY,fontweight="bold" if xi==3 else "normal")
ax2.axhline(.93,ls="--",lw=1.4,color=ORANGE); ax2.axhline(.18,ls="-",lw=1.4,color=GREEN)
ax2.text(6.28,.93,"endpoint-only\ninherits 0.93",va="center",fontsize=8,color=ORANGE,fontweight="bold")
ax2.text(6.28,.18,"complete-source\ninherits 0.18",va="center",fontsize=8,color=GREEN,fontweight="bold")
ax2.annotate("weak interior source\nremoved by DP",xy=(3,.18),xytext=(3.5,.58),
             arrowprops=dict(arrowstyle="->",lw=.8,color=GREY),ha="center",fontsize=7.8,color=GREY)
ax2.set_ylim(0,1.08); ax2.set_xlim(-.65,7.6); ax2.set_ylabel("Support value"); ax2.set_xlabel("Source-arc vertex")
ax2.set_xticks(x); dimticks(ax2)
finish(fig,"fig1_source_arc.pdf")

# ============ Figure 3 (file fig2): stress ============
xt=np.array([.02,.05,.10,.20,.40]); y=np.array([55.2,75.6,81.1,85.2,100])
fig,ax=plt.subplots(figsize=(7.1,3.6))
ax.plot(xt,y,"o-",lw=1.8,ms=5.5,label="Endpoint-only inheritance",color=VERM)
ax.plot(xt,np.zeros_like(xt),"s-",lw=1.6,ms=4.8,label="EC-DP (complete source arc)",color=BLUE)
for xi,yi in zip(xt,y): ax.text(xi,yi+3.4,f"{yi:.1f}",ha="center",fontsize=7.8,color=GREY)
# moved clear of the legend (was overlapping at lower-right)
ax.annotate("0 at every tolerance",xy=(.20,0),xytext=(.135,14),
            arrowprops=dict(arrowstyle="->",lw=.8,color=BLUE),color=BLUE,fontweight="bold",fontsize=8)
ax.set_xlabel("Douglas-Peucker tolerance (fixture units)"); ax.set_ylabel("Spans with support promotion (%)")
ax.set_xlim(0,.425); ax.set_ylim(-3,109); ax.legend(loc="center right",**LEG)
ax.set_title("Endpoint-only inheritance promotes support; EC-DP never does",fontweight="bold",color=BLACK)
ax.text(0,-.20,"10,000 deterministic polylines with deliberately weak interior support.\n"
        "Rates characterize this stress family, not real-world prevalence.",
        transform=ax.transAxes,fontsize=7.6,color=GREY,va="top")
dimticks(ax); finish(fig,"fig2_stress.pdf")

# ============ Figure 4: grade-provenance schematic ============
# Vertical baseline bands: title (0.86) | annotation (0.70) | box row (0.34-0.62) | caption (0.10)
fig,ax=plt.subplots(figsize=(7.2,2.8)); ax.set_xlim(0,1); ax.set_ylim(0,1); ax.axis("off")
BY0, BH = .30, .34                       # box row band (taller for comfortable 3-line padding)
BMID, ATOP = BY0+BH/2, BY0+BH            # box vertical centre and top edge
items=[(.025,"Measured-derived\nterrain cell",.185,BLUE,"#EEF7FB"),
       (.270,"Reference support\n$n=6,\\;n_t=10,\\;h=3$\n$C_M=0.40$",.205,BLUE,"#F7FAFC"),
       (.535,"Visual grade\n'dashed'\n(support $<66$)",.165,ORANGE,"#FFF9E8"),
       (.755,"Frozen export label\n'interpolatedBacked'",.220,VERM,"#FFF1EC")]
for x0,l,w,ec,fc in items:
    ax.add_patch(FancyBboxPatch((x0,BY0),w,BH,boxstyle="round,pad=.01,rounding_size=.014",facecolor=fc,edgecolor=ec,lw=1.0))
    ax.text(x0+w/2,BMID,l,ha="center",va="center",color=BLACK,fontsize=8.0)
gaps=[]
for a,b in zip(items[:-1],items[1:]):
    ar, bl = a[0]+a[2], b[0]
    gaps.append((ar+bl)/2)
    ax.add_patch(FancyArrowPatch((ar,BMID),(bl,BMID),arrowstyle="-|>",mutation_scale=10,lw=.9,color=GREY))
ax.text(.5,.90,"A support/style grade is not a provenance type",ha="center",fontweight="bold",fontsize=10.5,color=BLACK)
# annotation sits in its own band above the box row and points at the grade->label mapping arrow
ax.annotate("semantic relabeling\n(the defect)",xy=(gaps[2],ATOP+.005),xytext=(gaps[2],.70),
            ha="center",va="bottom",color=VERM,fontweight="bold",fontsize=8,
            arrowprops=dict(arrowstyle="->",lw=.9,color=VERM,shrinkA=3))
ax.text(.5,.10,"EMTRF preserves provenance = measured-derived; display grade may remain dashed.",ha="center",fontsize=8.2,color=GREY)
finish(fig,"fig4_grade_provenance_counterexample.pdf",despine=False)

# ============ Figure 5: ancestry composition ============
sites=["White Sands","StREAM","Estonia Tava","Marsh Island"]
M=np.array([79.7,36.7,47.1,1.9]); I=np.array([18.0,4.2,1.0,96.1]); X=np.array([2.3,59.1,51.9,2.0]); ns=[956,766,1315,1980]
fig,ax=plt.subplots(figsize=(7.0,4.0)); xx=np.arange(4); w=.58
ax.bar(xx,M,w,label="Measured-derived (M)",color=BLUE,edgecolor="white")
ax.bar(xx,I,w,bottom=M,label="Interpolated-derived (I)",color=ORANGE,edgecolor="white",hatch="....")
ax.bar(xx,X,w,bottom=M+I,label="Mixed-derived (X)",color=GREEN,edgecolor="white",hatch="////")
for i in range(4):
    for val,bot in [(M[i],0),(I[i],M[i]),(X[i],M[i]+I[i])]:
        if val>=7:
            ax.text(i,bot+val/2,f"{val:.1f}%",ha="center",va="center",fontsize=7.7,
                    color="white" if (bot==0 or bot==M[i]+I[i]) else BLACK,fontweight="bold")
ax.axhline(50,ls=":",lw=.9,color=GREY); ax.text(3.46,50,"50%",va="center",fontsize=7.5,color=GREY)
ax.text(1.5,108,"Mixed ancestry exceeds 50% at StREAM and Estonia Tava",ha="center",va="center",fontsize=7.7,color=GREY)
ax.set_xticks(xx); ax.set_xticklabels([f"{s}\nn={n:,}" for s,n in zip(sites,ns)]); ax.set_ylim(0,114)
ax.set_ylabel("Contour segments (%)")
ax.set_title("Ancestry composition of field-derived contour segments",fontweight="bold",color=BLACK)
ax.legend(loc="upper center",bbox_to_anchor=(.5,-.14),ncol=3,**LEG); dimticks(ax)
finish(fig,"fig5_real_ancestry.pdf")

# ============ Figure 6: one-cell promotion + intervals ============
sites6=["White Sands","Marsh Island","StREAM","Estonia Tava"]
vals=np.array([13.2,5.1,3.9,2.0]); lo=np.array([6.2,2.4,.8,.7]); hi=np.array([20.2,8.8,8.5,3.8]); yy=np.arange(4)[::-1]
fig,ax=plt.subplots(figsize=(7.0,3.45))
ax.errorbar(vals,yy,xerr=np.vstack([vals-lo,hi-vals]),fmt="o",ms=5.2,lw=1.5,capsize=3,color=VERM,label="Endpoint-only inheritance")
ax.plot(np.zeros(4),yy,"D",ms=4.5,color=BLUE,label="EC-DP (zero discrepancies)")
ax.axvline(0,ls="--",lw=1,color=BLUE)
for v,l,h,y0 in zip(vals,lo,hi,yy): ax.text(h+.45,y0,f"{v:.1f}% [{l:.1f}, {h:.1f}]",va="center",fontsize=7.7,color=GREY)
ax.set_yticks(yy); ax.set_yticklabels(sites6); ax.set_xlim(-.6,25.5)
ax.set_xlabel("Endpoint-only source-arc support promotion (%)")
ax.legend(loc="lower right",**LEG)
ax.set_title("Promotion at a one-cell tolerance, with EC-DP at zero throughout",fontweight="bold",color=BLACK)
ax.text(0,-.20,"Whiskers are deterministic 10,000-replicate polyline-cluster bootstrap sensitivity intervals\n"
        "for the audited crops, not population confidence intervals.",transform=ax.transAxes,fontsize=7.5,color=GREY,va="top")
dimticks(ax); finish(fig,"fig6_real_promotion.pdf")

# ============ Figure 7: four-pipeline ablation ============
sitesA=["White","Estonia","StREAM","Marsh"]; support=_ABL_PROM; grade=_ABL_GRADE; typed=_ABL_TYPED
pipes=[("P0  grade provenance\n+ endpoint support",support,grade),
       ("P1  typed provenance\n+ endpoint support",support,typed),
       ("P2  grade provenance\n+ complete source",[0,0,0,0],grade),
       ("P3  typed provenance\n+ complete source",[0,0,0,0],[0,0,0,0])]
fig,axs=plt.subplots(1,4,figsize=(7.25,3.7),sharey=True); barw=.34; x4=np.arange(4)
for idx,(ax,(ttl,sp,pr)) in enumerate(zip(axs,pipes)):
    b1=ax.bar(x4-barw/2,sp,barw,color=VERM,label="Support promotion")
    b2=ax.bar(x4+barw/2,pr,barw,color=BLUE,hatch="////",label="Provenance loss")
    ax.set_title(ttl,fontsize=8.1,fontweight="bold",color=BLACK); ax.set_xticks(x4)
    ax.set_xticklabels(sitesA,rotation=45,ha="right",fontsize=7.5); ax.set_ylim(0,108)
    for bars in (b1,b2):
        for b in bars:
            h=b.get_height(); ax.text(b.get_x()+b.get_width()/2,h+2.0,f"{h:g}",ha="center",fontsize=7.5,color=GREY)
    if idx==0: ax.set_ylabel("Rate (%)")
    if idx==3: ax.text(1.5,54,"both violation\nclasses eliminated",ha="center",color=GREEN,fontweight="bold",fontsize=7.4)
    dimticks(ax); sns.despine(ax=ax,left=True,bottom=True)
fig.suptitle("Four-pipeline ablation: each shortcut removed independently, identical retained geometry",fontweight="bold",y=1.01,color=BLACK)
handles=[Patch(facecolor=VERM,label="Support promotion"),Patch(facecolor=BLUE,hatch="////",label="Provenance loss")]
fig.legend(handles=handles,loc="lower center",ncol=2,bbox_to_anchor=(.5,-.02),**LEG)
fig.subplots_adjust(bottom=.28,wspace=.12,top=.78)
finish(fig,"fig7_ablation.pdf",despine=False)

# ============ Supplementary S1: descriptive scatter ============
red=np.array(_ABL_RED); prom=np.array(_ABL_PROM)
names=["White Sands","Estonia Tava","StREAM","Marsh Island"]; markers=["o","s","^","D"]
fig,ax=plt.subplots(figsize=(5.3,3.6))
for r,p,n,m in zip(red,prom,names,markers):
    ax.scatter([r],[p],s=55,marker=m,color=BLUE)
    ax.annotate(n,(r,p),xytext=(6,5),textcoords="offset points",fontsize=7.5,color=BLACK)
ax.set_xlabel("Vertex reduction (%)"); ax.set_ylabel("Endpoint-only support promotion (%)")
ax.set_xlim(58,92); ax.set_ylim(0,28)
ax.set_title("Descriptive promotion vs. reduction across four audited crops",fontweight="bold",color=BLACK)
ax.text(0,-.18,"Descriptive only: four heterogeneous crops do not support a fitted population relationship.",
        transform=ax.transAxes,fontsize=7.2,color=GREY,va="top")
dimticks(ax); finish(fig,"figS1_promotion_vs_reduction.pdf",SUP)

print("done")
