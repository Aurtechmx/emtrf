import json, math, os
from pathlib import Path
import numpy as np
import matplotlib as mpl
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch, Rectangle, Patch
from matplotlib.lines import Line2D

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
OUT = ROOT / "figures"
SUP = ROOT / "supplementary"
OUT.mkdir(parents=True,exist_ok=True); SUP.mkdir(parents=True,exist_ok=True)
mpl.rcParams.update({
    'font.size': 8.5, 'axes.titlesize': 10.5, 'axes.labelsize': 9,
    'xtick.labelsize': 8, 'ytick.labelsize': 8, 'legend.fontsize': 8,
    'figure.titlesize': 11, 'pdf.fonttype': 42, 'ps.fonttype': 42,
    'axes.linewidth': 0.8,
})
# Okabe-Ito-ish + neutrals, chosen to remain distinguishable in grayscale with markers/hatches.
BLUE='#0072B2'; ORANGE='#E69F00'; GREEN='#009E73'; SKY='#56B4E9'; VERM='#D55E00'; PURPLE='#CC79A7'; BLACK='#222222'; GRAY='#777777'; LIGHT='#F3F4F5'; MID='#D4D7DA'

def save(fig,name,folder=OUT):
    fig.savefig(folder/name, bbox_inches='tight', pad_inches=0.05)
    plt.close(fig)

# Figure 1: pipeline
fig,ax=plt.subplots(figsize=(7.6,2.6)); ax.set_xlim(0,1); ax.set_ylim(0,1); ax.axis('off')
_BFS=8.2
labels=['Terrain\nobservations','DTM + evidence\n$z,\\,p,\\,S,\\,A,\\,\\ell$','Contour\nextraction','Stitch +\nsmooth','EC-DP\nsimplification','Vector\nexport']
BOLD=[1,4]
# Box widths are measured from the rendered text, not guessed: 'simplification' is the
# longest word in the figure and previously sat in the narrowest box, so it overflowed.
fig.canvas.draw(); _r=fig.canvas.get_renderer(); _inv=ax.transData.inverted()
_tw=[]
for i,lbl in enumerate(labels):
    _t=ax.text(0,0,lbl,fontsize=_BFS,
               fontweight='semibold' if i in BOLD else 'normal')
    _bb=_t.get_window_extent(renderer=_r)
    _tw.append(abs(_inv.transform((_bb.width,0))[0]-_inv.transform((0,0))[0]))
    _t.remove()
ML=0.010; g=0.036; PADX=0.030
_raw=[w+2*PADX for w in _tw]
_scale=(1-2*ML-(len(labels)-1)*g)/sum(_raw)
ws=[r*_scale for r in _raw]
xs=[]; _x=ML
for w in ws: xs.append(_x); _x+=w+g
BY,BH=.44,.32; BMID=BY+BH/2
for i,(x,w,lbl) in enumerate(zip(xs,ws,labels)):
    fc='#EAF4F8' if i<2 else '#F7F7F7'
    ec=BLUE if i<2 else BLACK
    p=FancyBboxPatch((x,BY),w,BH,boxstyle='round,pad=0.010,rounding_size=.015',facecolor=fc,edgecolor=ec,lw=1.05)
    ax.add_patch(p); ax.text(x+w/2,BMID,lbl,ha='center',va='center',fontsize=_BFS,fontweight='semibold' if i in BOLD else 'normal')
    assert _tw[i] <= w + 1e-9, 'fig3 box %d too narrow for %r (%.4f > %.4f)' % (i, lbl.split(chr(10))[0], _tw[i], w)
    if i<len(xs)-1:
        ax.add_patch(FancyArrowPatch((x+w,BMID),(xs[i+1],BMID),arrowstyle='-|>',mutation_scale=11,lw=1.1,color=GRAY))
_c=lambda i: xs[i]+ws[i]/2
_div=(xs[1]+ws[1]+xs[2])/2
ax.text((_c(0)+_c(1))/2,.86,'terrain estimation',ha='center',va='center',fontweight='bold')
ax.text((_c(2)+_c(5))/2,.86,'representation-only operators',ha='center',va='center',fontweight='bold')
ax.plot([_div,_div],[.40,.90],ls='--',lw=.9,color=GRAY)
ax.text(.5,.26,'Representation-only operators conserve provenance, absorb unsupported inputs,\nand never promote support within a declared semantic channel.',ha='center',va='center',fontsize=8.3)
ax.text(.5,.08,'Declared inference may create a new support/uncertainty channel,\nbut must expose its method, calibration semantics, and lineage.',ha='center',va='center',fontsize=7.8,color=GRAY)
save(fig,'fig3_emtrf_pipeline.pdf')

# Figure 2: source arc, two panels
x=np.arange(7); geom=np.array([0,0.018,0.009,0.014,0.006,0.015,0]); sup=np.array([.93,.97,.88,.18,.90,.95,.93])
fig=plt.figure(figsize=(7.2,4.15)); gs=fig.add_gridspec(2,1,height_ratios=[1,1.15],hspace=.16)
ax=fig.add_subplot(gs[0]); ax.plot(x,geom,'o-',lw=1.6,ms=4.5,label='Source polyline',color=BLUE); ax.plot([0,6],[0,0],ls='--',lw=1.7,label='Simplified chord (both methods)',color=ORANGE)
ax.set_ylabel('Geometry\n(arbitrary units)'); ax.set_xticks(x); ax.set_xticklabels([]); ax.set_ylim(-.002,.025); ax.grid(axis='both',alpha=.22); ax.legend(loc='upper center',ncol=2,frameon=False); ax.set_title('Identical geometry, two different inherited support values',fontweight='bold')
ax2=fig.add_subplot(gs[1]); bars=ax2.bar(x,sup,width=.52,edgecolor='white',lw=.6,color=BLUE)
bars[3].set_facecolor(VERM); bars[3].set_hatch('////');
for xi,yi in zip(x,sup): ax2.text(xi,yi+.045,f'{yi:.2f}',ha='center',va='bottom',fontsize=7.6,color=GRAY if xi!=3 else BLACK,fontweight='bold' if xi==3 else 'normal')
ax2.axhline(.93,ls='--',lw=1.4,color=ORANGE); ax2.axhline(.18,ls='-',lw=1.4,color=GREEN)
ax2.text(6.25,.93,'endpoint-only\ninherits 0.93',va='center',fontsize=8,color=ORANGE,fontweight='bold')
ax2.text(6.25,.18,'complete-source\ninherits 0.18',va='center',fontsize=8,color=GREEN,fontweight='bold')
ax2.annotate('weak interior source\nremoved by DP',xy=(3,.20),xytext=(3,.62),arrowprops=dict(arrowstyle='->',lw=.8,color=GRAY),ha='center',va='center',fontsize=7.8,color=GRAY)
ax2.set_ylim(0,1.06); ax2.set_xlim(-.65,7.25); ax2.set_ylabel('Support value'); ax2.set_xlabel('Source-arc vertex'); ax2.set_xticks(x); ax2.grid(axis='y',alpha=.22)
save(fig,'fig1_source_arc.pdf')

# Figure 3: stress
xt=np.array([.02,.05,.10,.20,.40]); y=np.array([55.2,75.6,81.1,85.2,100])
fig,ax=plt.subplots(figsize=(7.1,3.6)); ax.plot(xt,y,'o-',lw=1.8,ms=5.5,label='Endpoint-only inheritance',color=VERM); ax.plot(xt,np.zeros_like(xt),'s-',lw=1.6,ms=4.8,label='EC-DP (complete source arc)',color=BLUE)
for xi,yi in zip(xt,y): ax.text(xi,yi+3.2,f'{yi:.1f}',ha='center',fontsize=7.8,color=GRAY)
ax.text(.085,4.5,'0 at every tolerance',color=BLUE,fontweight='bold',fontsize=8)
ax.set_xlabel('Douglas-Peucker tolerance (fixture units)'); ax.set_ylabel('Spans with support promotion (%)'); ax.set_xlim(0,.425); ax.set_ylim(-3,109); ax.grid(alpha=.22); ax.legend(loc='lower right',frameon=False)
ax.set_title('Endpoint-only inheritance promotes support; EC-DP never does',fontweight='bold')
ax.text(0,-.22,'10,000 deterministic polylines with deliberately weak interior support.\nRates characterize this stress family, not real-world prevalence.',transform=ax.transAxes,fontsize=7.6,color=GRAY,va='top')
save(fig,'fig2_stress.pdf')

# Figure 4: grade-provenance schematic
fig,ax=plt.subplots(figsize=(7.4,2.6)); ax.set_xlim(0,1); ax.set_ylim(0,1); ax.axis('off')
_lbl=['Measured-derived\nterrain cell','Reference support\n$n=6,\\;n_t=10,\\;h=3$\n$C_M=0.40$',"Visual grade\n'dashed'\n($33\\leq c<66$)","Frozen OpenLiDARViewer\nexport label\n'interpolatedBacked'"]
_BFS4=8.2
_ec=[BLUE,BLUE,ORANGE,VERM]; _fc=['#EEF7FB','#F7FAFC','#FFF9E8','#FFF1EC']
# Widths measured from the rendered text: 'Frozen OpenLiDARViewer' is the longest line and
# previously overflowed a hardcoded box.
fig.canvas.draw(); _r=fig.canvas.get_renderer(); _iv=ax.transData.inverted()
_w=[]
for _l in _lbl:
    _t=ax.text(0,0,_l,fontsize=_BFS4); _bb=_t.get_window_extent(renderer=_r)
    _w.append(abs(_iv.transform((_bb.width,0))[0]-_iv.transform((0,0))[0])); _t.remove()
_ML=.010; _g=.055; _PX=.030
_raw=[q+2*_PX for q in _w]; _sc=(1-2*_ML-3*_g)/sum(_raw); _ws=[q*_sc for q in _raw]
_xs=[]; _cx=_ML
for q in _ws: _xs.append(_cx); _cx+=q+_g
for _i,(x0,w,l) in enumerate(zip(_xs,_ws,_lbl)):
    p=FancyBboxPatch((x0,.45),w,.31,boxstyle='round,pad=.01,rounding_size=.014',facecolor=_fc[_i],edgecolor=_ec[_i],lw=1.0); ax.add_patch(p); ax.text(x0+w/2,.605,l,ha='center',va='center',fontsize=_BFS4,linespacing=1.5)
    assert _w[_i] <= w + 1e-9, 'fig4 box %d too narrow for %r (%.4f > %.4f)' % (_i, l.split(chr(10))[0], _w[_i], w)
    if _i<3: ax.add_patch(FancyArrowPatch((x0+w,.605),(_xs[_i+1],.605),arrowstyle='-|>',mutation_scale=10,lw=.9,color=GRAY))
ax.text(.5,.965,'A support/style grade is not a provenance type',ha='center',fontweight='bold',fontsize=10.5)
ax.text((_xs[3]+_ws[3]/2),.845,'semantic relabeling\n(the defect)',ha='center',va='center',color=VERM,fontweight='bold',fontsize=8)
ax.text(.5,.23,'EMTRF preserves provenance = measured-derived; display grade may remain dashed.',ha='center',fontsize=8.2,color=GRAY)
save(fig,'fig4_grade_provenance_counterexample.pdf')

# Figure 5: ancestry
sites=['White Sands','StREAM','Estonia Tava','Marsh Island']; M=np.array([79.7,36.7,47.1,1.9]); I=np.array([18.0,4.2,1.0,96.1]); X=np.array([2.3,59.1,51.9,2.0]); ns=[956,766,1315,1980]
fig,ax=plt.subplots(figsize=(7.0,4.0)); xx=np.arange(4); w=.58
b1=ax.bar(xx,M,w,label='Measured-derived (M)',color=BLUE,edgecolor='white'); b2=ax.bar(xx,I,w,bottom=M,label='Interpolated-derived (I)',color=ORANGE,edgecolor='white',hatch='....'); b3=ax.bar(xx,X,w,bottom=M+I,label='Mixed-derived (X)',color=GREEN,edgecolor='white',hatch='////')
for i in range(4):
 for val,bot in [(M[i],0),(I[i],M[i]),(X[i],M[i]+I[i])]:
  if val>=7: ax.text(i,bot+val/2,f'{val:.1f}%',ha='center',va='center',fontsize=7.7,color='white' if (bot==0 or bot==M[i]+I[i]) else BLACK,fontweight='bold')
ax.set_xlim(-.62,3.60); ax.axhline(50,ls=':',lw=.9,color=GRAY); ax.text(3.57,52.5,'50%',ha='right',va='bottom',fontsize=7.5,color=GRAY)
ax.text(1.5,108,'Mixed ancestry exceeds 50% at StREAM and Estonia Tava',ha='center',va='center',fontsize=7.7,color=GRAY)
ax.set_xticks(xx); ax.set_xticklabels([f'{s}\nn={n:,}' for s,n in zip(sites,ns)]); ax.set_ylim(0,114); ax.set_ylabel('Contour segments (%)'); ax.set_title('Ancestry composition of field-derived contour segments',fontweight='bold'); ax.grid(axis='y',alpha=.15); ax.legend(loc='upper center',bbox_to_anchor=(.5,-.15),ncol=3,frameon=False)
save(fig,'fig5_real_ancestry.pdf')

# Figure 6: one-cell promotion + intervals
sites6=['White Sands','Marsh Island','StREAM','Estonia Tava']; vals=np.array([13.2,5.1,3.9,2.0]); lo=np.array([6.2,2.4,.8,.7]); hi=np.array([20.2,8.8,8.5,3.8]); yy=np.arange(4)[::-1]
fig,ax=plt.subplots(figsize=(7.0,3.45)); ax.errorbar(vals,yy,xerr=np.vstack([vals-lo,hi-vals]),fmt='o',ms=5.2,lw=1.5,capsize=0,color=VERM,label='Endpoint-only inheritance')
ax.plot(np.zeros(4),yy,'D',ms=4.5,color=BLUE,label='EC-DP (zero discrepancies)'); ax.axvline(0,ls='--',lw=1,color=BLUE)
for v,l,h,y0 in zip(vals,lo,hi,yy): ax.text(h+.45,y0,f'{v:.1f}% [{l:.1f}, {h:.1f}]',va='center',fontsize=7.7,color=GRAY)
ax.set_yticks(yy); ax.set_yticklabels(sites6); ax.set_xlim(-.6,25.5); ax.set_xlabel('Endpoint-only source-arc support promotion (%)'); ax.grid(axis='x',alpha=.22); ax.legend(loc='lower right',frameon=False); ax.set_title('Promotion at a one-cell tolerance, with EC-DP at zero throughout',fontweight='bold')
ax.text(0,-.22,'Whiskers are deterministic 10,000-replicate polyline-cluster bootstrap sensitivity intervals\nfor the audited crops, not population confidence intervals.',transform=ax.transAxes,fontsize=7.5,color=GRAY,va='top')
save(fig,'fig6_real_promotion.pdf')

# Figure 7: four pipeline ablation chart
sitesA=['White','Estonia','StREAM','Marsh']; support=_ABL_PROM; grade=_ABL_GRADE; typed=_ABL_TYPED
pipes=[('P0  grade provenance\n+ endpoint support',support,grade),('P1  typed provenance\n+ endpoint support',support,typed),('P2  grade provenance\n+ complete source',[0,0,0,0],grade),('P3  typed provenance\n+ complete source',[0,0,0,0],[0,0,0,0])]
fig,axs=plt.subplots(1,4,figsize=(7.5,3.8),sharey=True); barw=.34; x4=np.arange(4)
for idx,(ax,(ttl,sp,pr)) in enumerate(zip(axs,pipes)):
 b1=ax.bar(x4-barw/2,sp,barw,color=VERM,label='Support promotion'); b2=ax.bar(x4+barw/2,pr,barw,color=BLUE,hatch='////',label='Provenance loss')
 ax.set_title(ttl,fontsize=7.7,fontweight='bold',pad=7); ax.set_xticks(x4); ax.set_xticklabels(sitesA,rotation=45,ha='right',fontsize=7.5); ax.grid(axis='y',alpha=.18); ax.set_ylim(0,108)
 for _bi,bars in enumerate([b1,b2]):
  for _k,b in enumerate(bars):
   h=b.get_height()
   # lift the right-hand label when its neighbour is close and both bars are short,
   # otherwise the two numbers print on top of each other
   _o=3.4
   if _bi==1 and h<30 and abs(h-b1[_k].get_height())<16: _o=10.0
   ax.text(b.get_x()+b.get_width()/2,h+_o,f'{h:g}',ha='center',fontsize=7.5,color=GRAY)
 if idx==0: ax.set_ylabel('Rate (%)')
 if idx==3: ax.text(1.5,54,'both violation\nclasses eliminated',ha='center',color=GREEN,fontweight='bold',fontsize=7.4)
fig.suptitle('Four-pipeline ablation: each shortcut removed\nindependently, identical retained geometry',fontweight='bold',fontsize=10,y=1.03)
handles=[Patch(facecolor=VERM,label='Support promotion'),Patch(facecolor=BLUE,hatch='////',label='Provenance loss')]; fig.legend(handles=handles,loc='lower center',ncol=2,frameon=False,bbox_to_anchor=(.5,-.02))
fig.subplots_adjust(bottom=.28,wspace=.20,top=.76)
save(fig,'fig7_ablation.pdf')

# Figure 8: StREAM real cartographic map with DTM ancestry background and same simplified contours
# StREAM DTM coverage grid; regenerate from the redistributed crop with data/make_stream_features.cjs
j=json.load(open(ROOT / 'data' / 'stream_features.json'))
d=j['dtm']; cov=np.array(d['coverage']).reshape(d['rows'],d['cols']); ox=d['originH1']; oy=d['originH2']; cs=d['cellSizeM']
# code 2 = measured (66.9%), code 1 = interpolated (33.1%)
fig,axs=plt.subplots(1,2,figsize=(7.35,3.65),sharex=True,sharey=True)
from matplotlib.colors import ListedColormap
cmap=ListedColormap(['#FFF5D8','#DCEEF7']) # I, M
bg=np.where(cov==2,1,0)
ext=[ox,ox+d['cols']*cs,oy,oy+d['rows']*cs]
for ax in axs:
 ax.imshow(bg,origin='lower',extent=ext,cmap=cmap,interpolation='nearest',alpha=.72,aspect='equal')
 ax.set_xlabel('Easting (m)'); ax.ticklabel_format(style='plain',axis='both',useOffset=False); ax.grid(False)
axs[0].set_ylabel('Northing (m)')
# Draw same simplified geometry. Left grade at feature-level; right segmentEvidence typed when alignment exists.
grade_style={'solid':dict(color=BLUE,ls='-',lw=1.25),'dashed':dict(color=ORANGE,ls='--',lw=1.15),'gap':dict(color=VERM,ls=':',lw=1.15)}
for f in j.get('simplified',[]):
 coords=np.asarray(f['coordinates']); st=grade_style[f['grade']]; axs[0].plot(coords[:,0],coords[:,1],**st)
 # segment evidence corresponds one per output segment between consecutive coordinates
 segs=f.get('segmentEvidence',[])
 for i in range(min(len(coords)-1,len(segs))):
  p=set(segs[i]['provenance']); typ='X' if len(p)>1 else ('M' if 'measured-derived' in p else 'I')
  style={'M':dict(color=BLUE,ls='-',lw=1.25),'I':dict(color=ORANGE,ls='--',lw=1.25),'X':dict(color=GREEN,ls='-.',lw=1.6)}[typ]
  axs[1].plot(coords[i:i+2,0],coords[i:i+2,1],**style)
axs[0].set_title('(a) Frozen display grade',fontweight='bold'); axs[1].set_title('(b) Typed complete-source ancestry',fontweight='bold')
# zoom to crop without margins
for ax in axs: ax.set_xlim(ext[0],ext[1]); ax.set_ylim(ext[2],ext[3])
# compact legends, double encoding with line style
bg_handles=[Patch(facecolor='#DCEEF7',edgecolor=MID,label='Measured-derived DTM cell'),Patch(facecolor='#FFF5D8',edgecolor=MID,label='Interpolated-derived DTM cell')]
left_handles=[Line2D([0],[0],color=BLUE,lw=1.3,ls='-',label='solid'),Line2D([0],[0],color=ORANGE,lw=1.3,ls='--',label='dashed'),Line2D([0],[0],color=VERM,lw=1.3,ls=':',label='gap')]
right_handles=[Line2D([0],[0],color=BLUE,lw=1.4,ls='-',label='M'),Line2D([0],[0],color=ORANGE,lw=1.4,ls='--',label='I'),Line2D([0],[0],color=GREEN,lw=1.8,ls='-.',label='X (mixed)')]
axs[0].legend(handles=left_handles,loc='lower left',frameon=True,framealpha=.94,ncol=3,fontsize=7)
axs[1].legend(handles=right_handles,loc='lower left',frameon=True,framealpha=.94,ncol=3,fontsize=7)
fig.legend(handles=bg_handles,loc='lower center',ncol=2,frameon=False,bbox_to_anchor=(.5,-.045),fontsize=7.4)
fig.suptitle('Same simplified StREAM contours, different evidence semantics',fontweight='bold',y=.99)
fig.subplots_adjust(bottom=.20,wspace=.10,top=.88)
save(fig,'fig8_stream_map.pdf')

# Supplementary S1: descriptive reduction vs support-promotion scatter
red=np.array(_ABL_RED); prom=np.array(_ABL_PROM); names=['White Sands','Estonia Tava','StREAM','Marsh Island']
fig,ax=plt.subplots(figsize=(5.3,3.6)); markers=['o','s','^','D']
for r,p,n,m in zip(red,prom,names,markers): ax.scatter([r],[p],s=45,marker=m,color=BLUE); ax.annotate(n,(r,p),xytext=(5,5),textcoords='offset points',fontsize=7.5)
ax.set_xlabel('Vertex reduction (%)'); ax.set_ylabel('Endpoint-only support promotion (%)'); ax.set_xlim(58,92); ax.set_ylim(0,28); ax.grid(alpha=.22); ax.set_title('Descriptive promotion vs. reduction across four audited crops',fontweight='bold'); ax.text(0,-.20,'Descriptive only: four heterogeneous crops do not support a fitted population relationship.',transform=ax.transAxes,fontsize=7.2,color=GRAY,va='top')
save(fig,'figS1_promotion_vs_reduction.pdf',SUP)
