import json,sys
R='results/'
H=json.load(open(R+'heldout_check_r1.json'));O=json.load(open(R+'optimal_bound_r1.json'))
P=json.load(open(R+'positional_sensitivity_r1.json'));S=json.load(open(R+'scale_test_r1.json'))
f3=lambda x:f'{x:.3f}'
def rng(d,fmt=f3):return f"{fmt(d['median'])} [{fmt(d['min'])}--{fmt(d['max'])}]"
out=[]
A=out.append
# ---------- S15
A(r"""\vspace{4mm}
\noindent\textbf{S15. Held-out ground check.} Rules fixed before the run and kept in the driver's header. Each crop's ground returns were split at random into two halves, twenty times (seeds 1--20). Terrain, support, contours and one-cell DP were built from one half; the other half was held out. The terrain therefore has half the paper's return density, and its counts are not mixed with the main tables. For a cell holding held-out returns the error is $e=|\bar z_{\mathrm{held}}-z_{\mathrm{terrain}}|$; the error of a contour edge is the RMS of $e$ over the cells of its $2\times2$ block that hold held-out returns. Three questions were asked. (1) Does support order error? RMSE of $e$ by cell class (measured cells with support $\geq 66$, $33$--$66$ and $<33$; interpolated cells) and Spearman's $\rho$ between support and $e$. (2) On DP spans whose endpoint record is promoted, is the error larger on the replaced edges the record hides than on the two end edges it reads? (3) Among spans the endpoint record grades solid, is the largest edge error greater on those EC-DP downgrades than on those it keeps? Every value is the median over the 20 splits, with the range in brackets.

\begin{center}\scriptsize
\begin{tabular}{@{}llrl@{}}
\toprule
Site & Cell class & Cells & RMSE of $e$ (m) \\
\midrule""")
cls=[('Measured, $\\geq 66$','MeasuredSolid'),('Measured, 33--66','MeasuredDashed'),('Measured, $<33$','MeasuredGap'),('Interpolated','Interpolated')]
for s in H['sites']:
    first=True
    for lab,k in cls:
        n=s['n'+k]['median']
        if n==0: A(f"{s['site'] if first else ''} & {lab} & 0 & n/a \\\\")
        else: A(f"{s['site'] if first else ''} & {lab} & {n:g} & {rng(s['rmse'+k])} \\\\")
        first=False
A(r"""\bottomrule
\end{tabular}
\end{center}

\begin{center}\scriptsize
\begin{tabular}{@{}llrll@{}}
\toprule
 & & \multicolumn{3}{c}{Promoted spans with held-out data on hidden and end edges} \\
\cmidrule(l){3-5}
Site & Spearman $\rho$ (support, $e$) & Spans & Hidden error larger & Hidden/end error, median ratio \\
\midrule""")
f2=lambda x:f'{x:.2f}';f0=lambda x:f'{x:.0f}\\%'
for s in H['sites']:
    r_=s['spearmanSupportError'];mm=lambda x:('$-$' if round(x,2)<0 else '')+f'{abs(x):.2f}'
    A(f"{s['site']} & {mm(r_['median'])} [{mm(r_['min'])} to {mm(r_['max'])}] & {s['q2Spans']['median']:g} & {rng(s['q2ShareHiddenWorsePct'],f0)} & {rng(s['q2MedianRatio'],f2)} \\\\")
ws=H['sites'][0];mi=H['sites'][3]
assert ws['site']=='White Sands' and mi['site']=='Marsh Island'
A(r"""\bottomrule
\end{tabular}
\end{center}

\noindent (1) Median RMSE rose from the highest to the lowest support class of measured cells at every site, and interpolated cells had the largest error at three sites; at Estonia Tava, which has no cell at or above 66, they fell between the two measured classes. Cell by cell the relation is weak: $\rho$ was clearly negative only at Marsh Island and within 0.1 of zero elsewhere. (2) Inconclusive. A split left 6--26 promoted spans per site with data on both kinds of edge; the hidden edges had the larger error in 50--63\% of them, and every range of the ratio includes 1. (3) Inconclusive. Only White Sands had spans in both groups on every split ("""+f"{ws['q3SolidKept']['median']:g} kept, {ws['q3SolidDowngraded']['median']:g} downgraded): median error was {ws['q3MedianErrDowngradedM']['median']:.3f} m on the downgraded spans against {ws['q3MedianErrKeptM']['median']:.3f} m on the kept ones, a ratio of {ws['q3Ratio']['median']:.2f} [{ws['q3Ratio']['min']:.2f}--{ws['q3Ratio']['max']:.2f}]"+r""". Marsh Island had a downgraded span on two splits; Estonia Tava and StREAM had no span graded solid. The check supports the ordering of support by cell class. At span level it neither confirms nor refutes a difference in ground error: 100 m crops at half density hold too few promoted spans. Driver: \texttt{ablation/heldout\_check.cjs}.
""")
# ---------- S16
A(r"""\vspace{4mm}
\noindent\textbf{S16. Fewest vertices for a geometry-only fix.} Rules fixed before the run. A geometry-only fix keeps endpoint records and changes only which vertices are retained. On the feature lines used for every baseline (Methods S7), a span between two source vertices is allowed if every source vertex between them lies within one cell of the line through its ends, the distance rule of the production DP. The fewest vertices that can be retained under a condition on spans is the shortest path from a line's first vertex to its last over allowed spans that meet the condition, found exactly by dynamic programming. Three conditions were used: none (the fewest vertices any selection within tolerance can keep); no promotion in any channel and no provenance class lost by the endpoint record; and exact records, where every replaced edge has the provenance and support of the span's record, which is what homogeneous splitting enforces by cutting.

\begin{center}\scriptsize
\begin{tabular}{@{}lrrrrrrr@{}}
\toprule
 & & & & \multicolumn{3}{c}{Fewest vertices within tolerance} & \\
\cmidrule(lr){5-7}
Site & Lines & Source & DP & No condition & No promotion or loss & Exact records & Homogeneous splitting \\
\midrule""")
mult=lambda a,b:f'{a} ({a/b:.2f})'
for s in O['sites']:
    r=s['retained'];d=r['DP']
    for k in ['OPT','OPT-SAFE','OPT-EXACT','SPLIT-0']: assert abs(round(r[k]/d,2)-s['multipleOfDP'][k])<1e-9,(s['site'],k)
    A(f"{s['site']} & {s['runs']} & {s['sourceVertices']} & {d} & {mult(r['OPT'],d)} & {mult(r['OPT-SAFE'],d)} & {mult(r['OPT-EXACT'],d)} & {mult(r['SPLIT-0'],d)} \\\\")
m=lambda k:(min(s['multipleOfDP'][k] for s in O['sites']),max(s['multipleOfDP'][k] for s in O['sites']))
dpo=[s['retained']['DP']/s['retained']['OPT']-1 for s in O['sites']]
diff=[(s['site'],s['retained']['SPLIT-0']-s['retained']['OPT-EXACT']) for s in O['sites']]
print('split-opt diffs',diff,'DP over OPT %',[round(100*x,1) for x in dpo],file=sys.stderr)
A(r"""\bottomrule
\end{tabular}
\end{center}

\noindent Retained vertices, with the multiple of DP in parentheses. DP kept """+f"{100*min(dpo):.0f}--{100*max(dpo):.0f}"+r"""\% more vertices than the fewest possible. Homogeneous splitting equalled the exact-record minimum at three sites and kept four more vertices at Marsh Island, so its cost ("""+f"{m('OPT-EXACT')[0]:.2f}--{m('OPT-EXACT')[1]:.2f}"+r""" times DP) belongs to the requirement of exact endpoint records, not to the splitting procedure. Avoiding only promotion and provenance loss needs """+f"{m('OPT-SAFE')[0]:.2f}--{m('OPT-SAFE')[1]:.2f}"+r""" times the DP vertices. Such a selection is a different simplification: its lines differ from DP's wherever DP's endpoint records were promoted, it must read the evidence while it simplifies, and its endpoint records then equal the complete-source records for that geometry. EC-DP reaches complete-source records on the unchanged DP geometry. Driver: \texttt{ablation/optimal\_bound.cjs}.
""")
# ---------- S17
A(r"""\vspace{4mm}
\noindent\textbf{S17. Sensitivity of the position-uncertainty result.} Methods S13 fixes two constants, an instrument precision of 0.05 m and a slope floor of 0.05 m/m. Rule fixed before the run: repeat S13 with each constant at 0.02, 0.05 and 0.10, nine combinations per site.

\begin{center}\scriptsize
\begin{tabular}{@{}lrrr@{}}
\toprule
Site & Length understated, S13 values & Range over nine combinations & Median factor, range \\
\midrule""")
sites=[];
for r in P['rows']:
    if r['site'] not in sites: sites.append(r['site'])
allp=[]
for st in sites:
    rows=[r for r in P['rows'] if r['site']==st];assert len(rows)==9
    b=[r for r in rows if r['instrumentM']==0.05 and r['slopeFloor']==0.05][0]
    ps=[r['understatedLengthPct'] for r in rows];fs=[r['medianFactor'] for r in rows];allp+=ps
    A(f"{st} & {b['understatedLengthPct']:.1f}\\% & {min(ps):.1f}--{max(ps):.1f}\\% & {min(fs):.2f}--{max(fs):.2f} \\\\")
A(r"""\bottomrule
\end{tabular}
\end{center}

\noindent Endpoint records understated the worst horizontal uncertainty on """+f"{min(allp):.1f}--{max(allp):.1f}"+r"""\% of contour length over all sites and combinations; no combination removed the effect. Driver: \texttt{ablation/positional\_sensitivity.cjs}.
""")
# ---------- S18
a=S['all'];w=S['withoutParentTiles']
A(r"""\vspace{4mm}
\noindent\textbf{S18. Scale test on public-agency tiles.} Rules written on 9 November 2026 before any crop was cut (\texttt{scale/README.md}). \emph{Tiles}: every airborne LiDAR tile from a public-agency programme on the author's disk on that date, 18 in all: 8 USGS 3DEP tiles (Arizona, Coconino 2019), 4 USGS tiles (Wisconsin, Racine and Kenosha 2017), 4 NOAA/USGS tiles (Hawaii 2020--2023), and the USGS White Sands and Estonian Land Board tiles from which two of the paper's crops were cut. They had been downloaded for other work and are a convenience sample, not a random one. \emph{Crops}: nine per tile, 100 m by 100 m, centred at 1/4, 1/2 and 3/4 of the tile's extent in each axis; ground returns only. \emph{Processing}: as for the White Sands and Estonia crops (1 m grid, 1 m contour interval, one-cell DP), on the feature lines of Methods S7. \emph{Exclusions}: a crop with fewer than 1,000 ground returns is skipped and counted; per-crop rates are given for crops with at least 20 DP spans, and pooled counts include every scored crop.

One amendment was written after the crops were cut and before any was scored. Two Hawaii tiles are small, so some of their nine crops overlap; within a tile, a crop that overlaps one already kept is dropped and counted. Cutting also showed that both Kenosha tiles hold ground returns in one corner only, which no crop reaches, and that two White Sands crops lie outside the data; these fall under the 1,000-return rule, and no crop was moved to find data. Quartiles use linear interpolation between order statistics.

\begin{center}\scriptsize
\begin{tabular}{@{}lrrrrrrlr@{}}
\toprule
 & & \multicolumn{2}{c}{Crops} & \multicolumn{3}{c}{Pooled DP spans, endpoint records} & Promotion per crop & Splitting \\
\cmidrule(lr){3-4}\cmidrule(lr){5-7}
Survey & Tiles & Scored & Dropped & Spans & Promoted & Provenance loss & median [quartiles] (range), \% & vertices \\
\midrule""")
names={'coconino':'Arizona, Coconino','wisconsin':'Wisconsin','hawaii':'Hawaii','white-sands-parent':'White Sands tile','estonia-parent':'Estonia Tava tile'}
def row(lab,g):
    p=g['pooled'];q=g['perCropPromotionPct']
    assert p['ecPromoted']==0 and p['ecProvLoss']==0 and p['split0Promoted']==0
    assert g['crops']==g['scored']+g['overlap']+g['tooFewReturns']
    return f"{lab} & {g['tiles']} & {g['scored']} & {g['overlap']+g['tooFewReturns']} & {p['spans']:,} & {p['promoted']:,} ({p['promotionPct']:.1f}\\%) & {p['provLoss']:,} ({p['provLossPct']:.1f}\\%) & {q['median']:.1f} [{q['q1']:.1f}--{q['q3']:.1f}] ({q['min']:.1f}--{q['max']:.1f}) & $\\times${p['split0VertexMultiple']:.2f} \\\\"
print(list(S['bySurvey'].keys()),file=sys.stderr)
for k,g in S['bySurvey'].items(): A(row(names[k],g))
A(r"\midrule");A(row('All',a));A(row('Without paper tiles',w))
A(r"""\bottomrule
\end{tabular}
\end{center}

\noindent Of """+f"{a['crops']} crops, {a['overlap']} were dropped for overlap and {a['tooFewReturns']} for too few returns; {a['scored']} were scored, {a['scoredWithAtLeast20Spans']} of them with at least 20 spans. Endpoint attribution promoted support in {a['cropsWithPromotion']} of the {a['scored']} crops and lost provenance in {a['cropsWithProvenanceLoss']}. Per-crop provenance loss had a median of {a['perCropProvLossPct']['median']:.1f}\\% (quartiles {a['perCropProvLossPct']['q1']:.1f}--{a['perCropProvLossPct']['q3']:.1f}\\%, range {a['perCropProvLossPct']['min']:.1f}--{a['perCropProvLossPct']['max']:.1f}\\%). EC-DP showed no promotion and no provenance loss in any crop. Homogeneous splitting showed no promotion and kept {a['pooled']['split0VertexMultiple']:.2f} times the DP vertices (per crop: median {a['perCropSplit0VertexMultiple']['median']:.2f}, range {a['perCropSplit0VertexMultiple']['min']:.2f}--{a['perCropSplit0VertexMultiple']['max']:.2f})."+r""" All Wisconsin crops that were scored come from the two Racine tiles. The rates describe these tiles; they are not an estimate of prevalence in any national product. The crops are not in the repository because of their size; the SHA-256 digest of each is in the result file. Drivers: \texttt{scale/extract\_crops.py}, \texttt{scale/scale\_test.cjs}.
""")
open(sys.argv[1],'w').write('\n'.join(out)+'\n')
