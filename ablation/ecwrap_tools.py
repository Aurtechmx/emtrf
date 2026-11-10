"""EC-wrap on further third-party simplifiers (rules: external-audit/PREREGISTRATION.md, part A).

QGIS (`native:simplifygeometries`: method 0 is Douglas-Peucker through GEOS, method 2 is QGIS's own
Visvalingam) and mapshaper (its own Douglas-Peucker and Visvalingam) simplify the production contour
runs of the four crops at a tolerance of one source cell. Each output line is matched to its source
vertices by EC-wrap and scored exactly as the Visvalingam-Whyatt test of ecwrap.py.

Tools are located through QGIS_PROCESS and MAPSHAPER (a command line), else PATH, the macOS QGIS
bundle, and `npx --yes mapshaper@0.6.102`. A tool that is absent is skipped and named in the output.
"""
import json, os, shlex, shutil, subprocess, sys, tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ecwrap import wrap, endpoint_records  # noqa: E402

MAPSHAPER_VERSION = "0.6.102"


def qgis_cmd():
    c = os.environ.get("QGIS_PROCESS") or shutil.which("qgis_process")
    for p in ("/Applications/QGIS-LTR.app/Contents/MacOS/bin/qgis_process", "/Applications/QGIS.app/Contents/MacOS/bin/qgis_process"):
        if not c and os.access(p, os.X_OK):
            c = p
    return [c] if c else None


def mapshaper_cmd():
    if os.environ.get("MAPSHAPER"):
        return shlex.split(os.environ["MAPSHAPER"])
    if shutil.which("mapshaper"):
        return ["mapshaper"]
    return ["npx", "--yes", f"mapshaper@{MAPSHAPER_VERSION}"] if shutil.which("npx") else None


def _write(lines, path):
    feats = [{"type": "Feature", "properties": {"id": i}, "geometry": {"type": "LineString", "coordinates": [list(p) for p in v]}}
             for i, v in enumerate(lines)]
    Path(path).write_text(json.dumps({"type": "FeatureCollection", "features": feats}))


def _read(path, n):
    out = [None] * n
    for f in json.loads(Path(path).read_text())["features"]:
        g = f.get("geometry")
        if g and g["type"] == "LineString":
            out[int(f["properties"]["id"])] = [list(p[:2]) for p in g["coordinates"]]
    return out


def run_qgis(lines, tol, method):
    with tempfile.TemporaryDirectory() as d:
        _write(lines, f"{d}/in.geojson")
        env = dict(os.environ, QT_QPA_PLATFORM="offscreen")
        subprocess.run(qgis_cmd() + ["run", "native:simplifygeometries", f"--INPUT={d}/in.geojson", f"--METHOD={method}",
                                     f"--TOLERANCE={tol!r}", f"--OUTPUT={d}/out.geojson"], check=True, capture_output=True, env=env)
        return _read(f"{d}/out.geojson", len(lines))


def run_mapshaper(lines, tol, method):
    with tempfile.TemporaryDirectory() as d:
        _write(lines, f"{d}/in.geojson")
        subprocess.run(mapshaper_cmd() + [f"{d}/in.geojson", "-simplify", method, "planar", f"interval={tol!r}", "-o", f"{d}/out.geojson"],
                       check=True, capture_output=True)
        return _read(f"{d}/out.geojson", len(lines))


def simplifiers():
    """Label -> (function(lines, tol) -> output lines) for the tools that are installed, and versions."""
    S, versions, missing = {}, [], []
    if qgis_cmd():
        S["QGIS DP"] = lambda L, t: run_qgis(L, t, 0)
        S["QGIS VW"] = lambda L, t: run_qgis(L, t, 2)
        r = subprocess.run(qgis_cmd() + ["--version"], capture_output=True, text=True, env=dict(os.environ, QT_QPA_PLATFORM="offscreen"))
        versions += [ln.strip() for ln in (r.stdout + r.stderr).splitlines() if ln.startswith(("QGIS 3", "QGIS 4", "GEOS version"))]
    else:
        missing.append("QGIS")
    if mapshaper_cmd():
        S["mapshaper DP"] = lambda L, t: run_mapshaper(L, t, "dp")
        S["mapshaper VW"] = lambda L, t: run_mapshaper(L, t, "visvalingam")
        r = subprocess.run(mapshaper_cmd() + ["-v"], capture_output=True, text=True)
        versions.append("mapshaper " + (r.stdout + r.stderr).strip().splitlines()[-1])
    else:
        missing.append("mapshaper")
    return S, versions, missing


def prov_set(e):
    return {"M", "I"} if e["provenance"] == "X" else {e["provenance"]}


def score(runs, outputs):
    """Endpoint attribution and EC-wrap's own records, scored against the replaced source edges."""
    a = dict(lines=0, unmatched=0, dropped=0, src=0, ret=0, spans=0, prom=0, loss=0, wprom=0, wloss=0)
    for (V, E), out in zip(runs, outputs):
        if out is None:  # the tool removed the line (mapshaper deletes closed lines that collapse)
            a["dropped"] += 1
            continue
        try:
            idx, recs = wrap(V, E, out)
        except ValueError:
            a["unmatched"] += 1
            continue
        ep = endpoint_records(E, idx)
        a["lines"] += 1; a["src"] += len(V); a["ret"] += len(idx); a["spans"] += len(recs)
        for r, e in zip(recs, ep):
            i, j = r["interval"]
            tmin = {ch: min((E[k].get(ch) for k in range(i, j) if E[k].get(ch) is not None), default=None) for ch in ("M", "I")}
            tprov = set().union(*(prov_set(E[k]) for k in range(i, j)))
            a["prom"] += any(e[ch] is not None and tmin[ch] is not None and e[ch] > tmin[ch] + 1e-12 for ch in ("M", "I"))
            a["loss"] += not tprov <= (prov_set(E[i]) | prov_set(E[j - 1]))
            a["wprom"] += any(r["min"][ch] is not None and r["min"][ch] > tmin[ch] + 1e-12 for ch in ("M", "I"))
            a["wloss"] += not tprov <= set(r["provenance"])
    pct = lambda n, d: round(100 * n / d, 1) if d else 0.0
    return {"lines": a["lines"], "linesRemovedByTool": a["dropped"], "linesNotSubsequence": a["unmatched"], "sourceVertices": a["src"], "retainedVertices": a["ret"],
            "vertexReductionPct": pct(a["src"] - a["ret"], a["src"]), "spans": a["spans"],
            "endpointPromotion": a["prom"], "endpointPromotionPct": pct(a["prom"], a["spans"]),
            "endpointProvenanceLoss": a["loss"], "endpointProvenanceLossPct": pct(a["loss"], a["spans"]),
            "ecwrapPromotion": a["wprom"], "ecwrapProvenanceLoss": a["wloss"]}


if __name__ == "__main__":
    sites = json.loads(Path(sys.argv[1]).read_text()); out_json = Path(sys.argv[2])
    S, versions, missing = simplifiers()
    rows = []
    for s in sites:
        runs = [(r["vertices"], r["edges"]) for r in s["runs"]]
        for label, f in S.items():
            row = {"site": s["label"], "simplifier": label, "toleranceM": s["cellSizeM"], **score(runs, f([V for V, _ in runs], s["cellSizeM"]))}
            rows.append(row)
            print(f"{row['site']:13s} {label:13s} lines {row['lines']:3d} red {row['vertexReductionPct']:5.1f}% spans {row['spans']:4d} "
                  f"endpoint prom {row['endpointPromotion']} ({row['endpointPromotionPct']}%) loss {row['endpointProvenanceLoss']} "
                  f"({row['endpointProvenanceLossPct']}%) ecwrap {row['ecwrapPromotion']}/{row['ecwrapProvenanceLoss']} removed {row['linesRemovedByTool']} unmatched {row['linesNotSubsequence']}")
    out_json.write_text(json.dumps({"driver": "EC-wrap on QGIS and mapshaper simplifiers", "rules": "external-audit/PREREGISTRATION.md, part A",
                                    "versions": versions, "toolsNotInstalled": missing, "rows": rows}, indent=1) + "\n")
