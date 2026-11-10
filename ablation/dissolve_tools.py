"""Default attribute handling when line segments are dissolved (rules: docs/RULES_ADDITIONAL_TESTS.md, D1).

Each source edge of the production contour runs is written as a two-vertex line feature carrying its
evidence (`prov`, `m_sup`, `i_sup`) and the index of its run (`line_id`). Standard GIS tools then join
the features of each run into one feature, with their default attribute behaviour. The record each
tool writes is compared with the complete record of the joined edges: the minimum support per channel
and the provenance union. The tool writes the record; this script only reads it back and scores it.

Tools: QGIS `native:dissolve`, GeoPandas `dissolve`, mapshaper `-dissolve ... copy-fields`, and
GDAL/OGR with an SQLite `GROUP BY`. Secondary: the mean of the support fields (GeoPandas, OGR `AVG`).
A tool that is absent is skipped and named in the output.

Usage: dissolve_tools.py results/feature_runs.json results/dissolve_tools_r1.json
"""
import json, os, shutil, subprocess, sys, tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ecwrap_tools import qgis_cmd, mapshaper_cmd  # noqa: E402

FIELDS = ("prov", "m_sup", "i_sup")
EPS = 1e-9


def write_edges(runs, path, reverse=False):
    feats = []
    for lid, run in enumerate(runs):
        V, E = run["vertices"], run["edges"]
        rows = [{"type": "Feature",
                 "properties": {"line_id": lid, "seq": k, "prov": e["provenance"], "m_sup": e.get("M"), "i_sup": e.get("I")},
                 "geometry": {"type": "LineString", "coordinates": [list(V[k]), list(V[k + 1])]}} for k, e in enumerate(E)]
        feats += rows[::-1] if reverse else rows
    Path(path).write_text(json.dumps({"type": "FeatureCollection", "name": "edges", "features": feats}))


def read_records(path):
    """line_id -> {prov, m_sup, i_sup} as the tool wrote them; None if a field is absent from the output."""
    out = {}
    for f in json.loads(Path(path).read_text())["features"]:
        p = f["properties"]
        out[int(p["line_id"])] = {k: p.get(k) for k in FIELDS} if all(k in p for k in FIELDS) else None
    return out


def qgis_dissolve(src, dst):
    env = dict(os.environ, QT_QPA_PLATFORM="offscreen")
    subprocess.run(qgis_cmd() + ["run", "native:dissolve", f"--INPUT={src}", "--FIELD=line_id", f"--OUTPUT={dst}"],
                   check=True, capture_output=True, env=env)
    return read_records(dst)


def mapshaper_dissolve(src, dst):
    subprocess.run(mapshaper_cmd() + [src, "-dissolve", "line_id", "copy-fields=prov,m_sup,i_sup", "-o", dst],
                   check=True, capture_output=True)
    return read_records(dst)


def ogr_sql(src, dst, mean=False):
    cols = "AVG(m_sup) AS m_sup, AVG(i_sup) AS i_sup" if mean else "prov, m_sup, i_sup"
    sql = f"SELECT ST_Union(geometry), line_id, {cols} FROM edges GROUP BY line_id"
    subprocess.run(["ogr2ogr", "-f", "GeoJSON", dst, src, "-dialect", "SQLite", "-sql", sql], check=True, capture_output=True)
    recs = {}
    for f in json.loads(Path(dst).read_text())["features"]:
        p = f["properties"]
        recs[int(p["line_id"])] = {"prov": p.get("prov"), "m_sup": p.get("m_sup"), "i_sup": p.get("i_sup")}
    return recs


def geopandas_dissolve(src, mean=False):
    import geopandas as gpd
    g = gpd.read_file(src)
    d = g.dissolve(by="line_id", aggfunc={"m_sup": "mean", "i_sup": "mean"}) if mean else g.dissolve(by="line_id")
    nn = lambda v: None if v is None or v != v else (v if isinstance(v, str) else float(v))
    return {int(i): {"prov": None if mean else nn(r["prov"]), "m_sup": nn(r["m_sup"]), "i_sup": nn(r["i_sup"])} for i, r in d.iterrows()}


def reference(run):
    E = run["edges"]
    mn = {ch: min((e[k] for e in E if e.get(k) is not None), default=None) for ch, k in (("m_sup", "M"), ("i_sup", "I"))}
    prov = {c for e in E for c in ({"M", "I"} if e["provenance"] == "X" else {e["provenance"]})}
    return mn, prov


def score(runs, recs, has_prov):
    a = dict(lines=0, singleEdgeLines=0, missing=0, promotion=0, provenanceLoss=0)
    for lid, run in enumerate(runs):
        if len(run["edges"]) < 2:
            a["singleEdgeLines"] += 1; continue
        r = recs.get(lid)
        if r is None:
            a["missing"] += 1; continue
        mn, prov = reference(run)
        a["lines"] += 1
        a["promotion"] += any(r[ch] is not None and mn[ch] is not None and float(r[ch]) > mn[ch] + EPS for ch in ("m_sup", "i_sup"))
        if has_prov:
            got = {"M", "I"} if r["prov"] == "X" else ({r["prov"]} if r["prov"] else set())
            a["provenanceLoss"] += not prov <= got
    pct = lambda n: round(100 * n / a["lines"], 1) if a["lines"] else 0.0
    out = {"linesScored": a["lines"], "singleEdgeLines": a["singleEdgeLines"], "linesMissingOrRecordDropped": a["missing"],
           "supportPromotion": a["promotion"], "supportPromotionPct": pct(a["promotion"])}
    if has_prov:
        out.update(provenanceLoss=a["provenanceLoss"], provenanceLossPct=pct(a["provenanceLoss"]))
    return out


def tools():
    T, versions, missing = [], [], []
    q = qgis_cmd()
    if q:
        v = subprocess.run(q + ["--version"], capture_output=True, text=True, env=dict(os.environ, QT_QPA_PLATFORM="offscreen")).stdout
        versions += [l.strip() for l in v.splitlines() if l.startswith(("QGIS 3", "QGIS 4", "GEOS version"))]
        T.append(("QGIS dissolve", "default", True, lambda s, d: qgis_dissolve(s, f"{d}/q.geojson")))
    else:
        missing.append("QGIS")
    try:
        import geopandas, shapely
        versions.append(f"GeoPandas {geopandas.__version__} (Shapely {shapely.__version__})")
        T.append(("GeoPandas dissolve", "default", True, lambda s, d: geopandas_dissolve(s)))
        T.append(("GeoPandas dissolve, mean", "mean", False, lambda s, d: geopandas_dissolve(s, mean=True)))
    except ImportError:
        missing.append("GeoPandas")
    m = mapshaper_cmd()
    if m:
        versions.append("mapshaper " + (subprocess.run(m + ["--version"], capture_output=True, text=True).stdout.strip() or "?"))
        T.append(("mapshaper dissolve", "default", True, lambda s, d: mapshaper_dissolve(s, f"{d}/m.geojson")))
    else:
        missing.append("mapshaper")
    if shutil.which("ogr2ogr"):
        versions.append(subprocess.run(["ogr2ogr", "--version"], capture_output=True, text=True).stdout.strip())
        T.append(("GDAL/OGR SQL", "default", True, lambda s, d: ogr_sql(s, f"{d}/o.geojson")))
        T.append(("GDAL/OGR SQL, mean", "mean", False, lambda s, d: ogr_sql(s, f"{d}/oa.geojson", mean=True)))
    else:
        missing.append("GDAL/OGR")
    return T, versions, missing


if __name__ == "__main__":
    sites = json.loads(Path(sys.argv[1]).read_text()); out_json = Path(sys.argv[2])
    T, versions, missing = tools()
    rows = []
    for order in ("source", "reversed"):
        for s in sites:
            with tempfile.TemporaryDirectory() as d:
                src = f"{d}/edges.geojson"
                write_edges(s["runs"], src, reverse=(order == "reversed"))
                for label, kind, has_prov, fn in T:
                    r = {"site": s["label"], "tool": label, "aggregation": kind, "featureOrder": order}
                    r.update(score(s["runs"], fn(src, d), has_prov))
                    rows.append(r)
                    print(f"{order:8s} {s['label']:13s} {label:26s} lines {r['linesScored']:3d} promotion {r['supportPromotion']:3d} ({r['supportPromotionPct']}%)"
                          + (f" provenance loss {r['provenanceLoss']} ({r['provenanceLossPct']}%)" if has_prov else "")
                          + (f" missing {r['linesMissingOrRecordDropped']}" if r['linesMissingOrRecordDropped'] else ""))
    out_json.write_text(json.dumps({"driver": "default attribute handling when line segments are dissolved",
                                    "rules": "docs/RULES_ADDITIONAL_TESTS.md, D1", "versions": versions,
                                    "toolsNotInstalled": missing, "rows": rows}, indent=1) + "\n")
