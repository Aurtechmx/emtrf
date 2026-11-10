"""Evidence attribution on third-party contour geometry.

Contours and their simplification come from GDAL or GRASS. This script only reads the tool's own
outputs: the per-cell return count, the distance to the nearest measured cell, the source contour
lines and the simplified lines. For every simplified span it compares two records:
  endpoint  the evidence of the span's first and last source edge (what ordinary DP carries);
  complete  the evidence of every source edge the span replaces (EC-DP).
Evidence of a source edge is read from the 2x2 block of cell centres the edge crosses:
  provenance  M (all four cells have returns), I (none has), X (mixed);
  measured channel      the smallest return count among the block's measured cells;
  interpolated channel  the largest distance to data among the block's empty cells.
Promotion uses only the ORDER of these values, so the counts hold for every support function that
increases with return count and decreases with distance to data.
"""
import json, math, sys
from pathlib import Path
import numpy as np

def read_asc(p):
    lines = Path(p).read_text().splitlines()
    hdr = {}
    i = 0
    while lines[i].split()[0].lower() in ("ncols", "nrows", "xllcorner", "yllcorner", "cellsize", "nodata_value", "dx", "dy", "xllcenter", "yllcenter"):
        k, v = lines[i].split()[:2]; hdr[k.lower()] = float(v); i += 1
    a = np.array([[float(x) for x in ln.split()] for ln in lines[i:i + int(hdr["nrows"])]])
    return a[::-1], hdr  # row 0 = south

def lines_of(p):
    out = []
    for f in json.loads(Path(p).read_text())["features"]:
        g = f["geometry"]; lvl = f["properties"].get("elev", f["properties"].get("level"))
        parts = [g["coordinates"]] if g["type"] == "LineString" else g["coordinates"]
        for c in parts:
            out.append((float(lvl), [(x[0], x[1]) for x in c]))
    return out

def subsequence(v, sv):
    """Indices of v at which the simplified vertices sv occur in order, first and last pinned to the
    line ends. Backtracks, because a contour can pass through the same point twice (a saddle)."""
    pos = {}
    for j, p in enumerate(v): pos.setdefault(p, []).append(j)
    sys.setrecursionlimit(max(10000, 4 * len(sv)))
    def go(k, lo):
        if k == len(sv): return []
        for j in pos.get(sv[k], []):
            if j < lo or (k == 0 and j != 0) or (k == len(sv) - 1 and j != len(v) - 1): continue
            rest = go(k + 1, j + 1)
            if rest is not None: return [j] + rest
        return None
    return go(0, 0)


# How each tool assigns a return to a cell. Every difference between the tools' cell counts is a
# difference between these rules; rebin() reproduces each tool's counts exactly.
RULES = {
    "floor": dict(y="floor"),                          # production and NumPy: half-open cells, row from the south
    "north-up": dict(y="ceil"),                        # a return on a horizontal cell edge goes to the cell above
    # lidR quantises LAS coordinates to its 0.001 scale and keeps returns on the outer grid boundary
    "north-up, 1 mm coordinates, outer boundary kept": dict(y="ceil", quant=0.001, clamp=True),
    "floor, centre extent": dict(y="floor", band=True),  # SAGA: the grid extent runs between outer cell centres
}
BINNING = {"gdal": "north-up", "grass": "north-up", "whitebox": "north-up", "lidr": "north-up, 1 mm coordinates, outer boundary kept",
           "saga": "floor, centre extent", "scipy": "floor"}


def rebin(P, s, y, band=False, quant=None, clamp=False):
    cs, R, C = s["cellSizeM"], s["rows"], s["cols"]; x, yy = P[:, 0], P[:, 1]
    if quant: x, yy = np.round(x / quant) * quant, np.round(yy / quant) * quant
    fx, fy = (x - s["originH1"]) / cs, (yy - s["originH2"]) / cs
    c = np.floor(fx).astype(int); r = (np.floor(fy) if y == "floor" else np.ceil(fy) - 1).astype(int)
    if clamp:
        inside = (fx >= 0) & (fx <= C) & (fy >= 0) & (fy <= R)
        c = np.where(inside, np.clip(c, 0, C - 1), c); r = np.where(inside, np.clip(r, 0, R - 1), r)
    ok = (c >= 0) & (c < C) & (r >= 0) & (r < R)
    if band: ok &= (fx >= 0.5) & (fx <= C - 0.5) & (fy >= 0.5) & (fy <= R - 0.5)
    A = np.zeros((R, C), dtype=int); np.add.at(A, (r[ok], c[ok]), 1); return A


def analyse(chain_dir):
    n, h = read_asc(chain_dir / "count.asc"); dist, _ = read_asc(chain_dir / "dist.asc")
    n = np.where(n > 0, n, 0); dtm, _ = read_asc(chain_dir / "dtm.asc")
    cs = h["cellsize"]
    x0 = h["xllcorner"] if "xllcorner" in h else h["xllcenter"] - cs / 2
    y0 = h["yllcorner"] if "yllcorner" in h else h["yllcenter"] - cs / 2; R, C = n.shape
    src = lines_of(chain_dir / "contours.geojson"); simp = lines_of(chain_dir / "simplified.geojson")
    key = lambda p: (round(p[0], 6), round(p[1], 6))

    def edge_ev(p, q):
        mx, my = (p[0] + q[0]) / 2, (p[1] + q[1]) / 2
        c0 = min(max(int(math.floor((mx - x0) / cs - 0.5)), 0), C - 2); r0 = min(max(int(math.floor((my - y0) / cs - 0.5)), 0), R - 2)
        cells = [(r0, c0), (r0, c0 + 1), (r0 + 1, c0 + 1), (r0 + 1, c0)]
        zb = [dtm[r, c] for r, c in cells]
        bad = not (min(zb) - 1e-6 <= lvl_now[0] <= max(zb) + 1e-6)
        m = [n[r, c] for r, c in cells if n[r, c] > 0]; i = [dist[r, c] for r, c in cells if n[r, c] == 0]
        prov = {"M"} if m and not i else {"I"} if i and not m else {"M", "I"}
        return {"M": min(m) if m else None, "I": -max(i) if i else None, "prov": prov, "bad": bad}

    pool = {}
    for idx, (lvl, v) in enumerate(src):
        pool.setdefault((lvl, key(v[0]), key(v[-1])), []).append(idx)
    used = set(); acc = dict(spans=0, prom=0, loss=0, src_v=0, ret_v=0, unmatched=0, edges=0, unbracketed=0); lvl_now = [None]
    for lvl, sv in simp:
        cand = [i for i in pool.get((lvl, key(sv[0]), key(sv[-1])), []) if i not in used]
        match = None
        for i in cand:
            keep = subsequence([key(p) for p in src[i][1]], [key(p) for p in sv])
            if keep is not None:
                match = (i, keep); break
        if match is None:
            acc["unmatched"] += 1; continue
        i, keep = match; used.add(i); v = src[i][1]; lvl_now[0] = lvl
        edges = [edge_ev(v[k], v[k + 1]) for k in range(len(v) - 1)]
        acc["edges"] += len(edges); acc["unbracketed"] += sum(e["bad"] for e in edges)
        acc["src_v"] += len(v); acc["ret_v"] += len(keep)
        for a, b in zip(keep[:-1], keep[1:]):
            arc = edges[a:b]; ends = [edges[a], edges[b - 1]]; acc["spans"] += 1
            def carried(es, ch):
                vals = [e[ch] for e in es if e[ch] is not None]; return min(vals) if vals else None
            prom = False
            for ch in ("M", "I"):
                t, ce = carried(arc, ch), carried(ends, ch)
                if t is not None and ce is not None and ce > t: prom = True
            truth = set().union(*[e["prov"] for e in arc])
            loss = not truth <= set().union(*[e["prov"] for e in ends])
            acc["prom"] += prom; acc["loss"] += loss
    unused = len(src) - len(used)
    pct = lambda x: round(100 * x / acc["spans"], 1) if acc["spans"] else 0.0
    return {"lines": len(src), "simplifiedLines": len(simp), "unmatchedSimplifiedLines": acc["unmatched"], "sourceLinesWithoutMatch": unused,
            "sourceEdges": acc["edges"], "edgesWhoseBlockDoesNotBracketLevel": acc["unbracketed"], "sourceVertices": acc["src_v"], "retainedVertices": acc["ret_v"],
            "vertexReductionPct": round(100 * (acc["src_v"] - acc["ret_v"]) / acc["src_v"], 1) if acc["src_v"] else 0.0,
            "spans": acc["spans"], "endpointPromotion": acc["prom"], "endpointPromotionPct": pct(acc["prom"]),
            "endpointProvenanceLoss": acc["loss"], "endpointProvenanceLossPct": pct(acc["loss"]),
            }, n

if __name__ == "__main__":
    W = Path(sys.argv[1]); out = Path(sys.argv[2])
    CHAINS = [c for c in ("gdal", "grass", "saga", "whitebox", "lidr", "scipy") if (W / c).is_dir()]
    sites = json.loads((W / "sites.json").read_text()); res = []
    for s in sites:
        olv = np.array(s["olvCounts"]).reshape(s["rows"], s["cols"])
        P = np.loadtxt(W / f"{s['id']}.csv", delimiter=",", skiprows=1, ndmin=2)
        row = {"site": s["label"], "returns": len(P), "returnsOnHorizontalCellEdge": int((np.mod(P[:, 1] - s["originH2"], s["cellSizeM"]) == 0).sum())}
        counts = {}
        for chain in CHAINS:
            r, n = analyse(W / chain / s["id"]); counts[chain] = n.astype(int)
            r["binningRule"] = BINNING[chain]
            r["cellsWithCountDifferentFromProduction"] = int((counts[chain] != olv).sum())
            r["cellsDifferentFromStatedBinningRule"] = int((counts[chain] != rebin(P, s, **RULES[BINNING[chain]])).sum())
            row[chain] = r
        row["cellsWithCountDifferentFromGdal"] = {ch: int((counts[ch] != counts["gdal"]).sum()) for ch in CHAINS if "gdal" in counts}
        res.append(row)
    out.write_text(json.dumps({"driver": "third-party toolchain audit", "sites": res}, indent=1) + "\n")
    for r in res:
        for ch in CHAINS:
            x = r[ch]
            print(f"{r['site']:13s} {ch:8s} lines {x['lines']:4d} spans {x['spans']:4d} red {x['vertexReductionPct']:5.1f}% prom {x['endpointPromotion']:3d} ({x['endpointPromotionPct']}%) loss {x['endpointProvenanceLoss']:3d} ({x['endpointProvenanceLossPct']}%) unmatched {x['unmatchedSimplifiedLines']}/{x['sourceLinesWithoutMatch']} countDiff {x['cellsWithCountDifferentFromProduction']} vsRule {x['cellsDifferentFromStatedBinningRule']} bracketFail {x['edgesWhoseBlockDoesNotBracketLevel']}")
