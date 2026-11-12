#!/usr/bin/env python3
"""Attach complete-source evidence records to lines simplified by any tool.

Python 3 standard library only. GeoJSON in, GeoJSON out.

  1. Write the source lines for your simplifier:
       ecwrap_cli.py lines  SOURCE_EDGES.geojson  LINES.geojson
  2. Simplify LINES.geojson with any tool that keeps a subset of the vertices and both ends
     (QGIS "Simplify", GDAL/OGR -simplify, mapshaper -simplify, GRASS v.generalize, ...),
     keeping the `line_id` field.
  3. Attach the records:
       ecwrap_cli.py wrap  SOURCE_EDGES.geojson  SIMPLIFIED.geojson  OUT.geojson  [--null-code -1]

SOURCE_EDGES.geojson holds one two-vertex LineString per source segment with the fields
  line_id  line the segment belongs to
  seq      position of the segment along its line (0, 1, 2, ...)
  prov     M (measured), I (interpolated) or X (both)
  m_sup    measured support 0-100; applies to M and X segments, null elsewhere
  i_sup    interpolation support 0-100; applies to I and X segments, null elsewhere
A null value on a segment to which the channel applies is a missing value: every simplified
segment that replaces it reports that channel as unavailable, never a minimum of the rest.

OUT.geojson holds one two-vertex LineString per simplified segment with the fields
  line_id, span        line and position of the simplified segment
  src_from, src_to     source vertex interval it replaces (lineage)
  prov                 provenance union of the replaced segments (M, I or X)
  m_state, i_state     value, unavailable (a replaced segment lacks a value) or not_applicable
  m_min, i_min         minimum support over the replaced segments, per channel
  m_ge66, m_ge33       share of the replaced length with measured support at or above 66 / 33
  i_ge66, i_ge33       the same for interpolation support
Export preserves the computed complete-source records without rounding, so threshold decisions on
the exported values match those on the in-memory records (a minimum of 65.96 is not written as 66).
Span-level rejection is unchanged: a span fails a query when any replaced source edge fails it.
Field names fit the
10-character limit of Shapefile. Where the state is not "value" the numbers are null, or the
value of --null-code for formats without null (Shapefile).
"""
import json, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "ablation"))
from ecwrap import wrap, AmbiguousMatch  # noqa: E402


def load_edges(path):
    lines = {}
    for f in json.loads(Path(path).read_text())["features"]:
        p, c = f["properties"], f["geometry"]["coordinates"]
        lines.setdefault(p["line_id"], []).append((int(p["seq"]), [c[0][:2], c[-1][:2]], p))
    out = {}
    for lid, segs in lines.items():
        segs.sort(key=lambda s: s[0])
        V = [segs[0][1][0]] + [s[1][1] for s in segs]
        for a, b in zip(segs[:-1], segs[1:]):
            if a[1][1] != b[1][0]:
                raise SystemExit(f"line {lid}: segment {b[0]} does not start where segment {a[0]} ends")
        E = [{"provenance": s[2]["prov"], "M": s[2].get("m_sup"), "I": s[2].get("i_sup")} for s in segs]
        out[lid] = (V, E)
    return out


def cmd_lines(src, dst):
    feats = [{"type": "Feature", "properties": {"line_id": lid}, "geometry": {"type": "LineString", "coordinates": V}}
             for lid, (V, _) in load_edges(src).items()]
    Path(dst).write_text(json.dumps({"type": "FeatureCollection", "name": "lines", "features": feats}))
    print(f"{len(feats)} lines written to {dst}")


def cmd_wrap(src, simplified, dst, null_code=None):
    source = load_edges(src)
    nz = lambda v: null_code if v is None else v
    feats, skipped, ambiguous = [], [], []
    for f in json.loads(Path(simplified).read_text())["features"]:
        g, lid = f.get("geometry"), f["properties"]["line_id"]
        if not g or g["type"] != "LineString" or lid not in source:
            skipped.append(lid); continue
        V, E = source[lid]
        out = [p[:2] for p in g["coordinates"]]
        try:
            idx, recs = wrap(V, E, out)
        except AmbiguousMatch:
            ambiguous.append(lid); continue
        except ValueError:
            skipped.append(lid); continue
        for j, r in enumerate(recs):
            a, b = r["interval"]
            pm, pi = r["profile"]["M"], r["profile"]["I"]
            feats.append({"type": "Feature", "geometry": {"type": "LineString", "coordinates": [V[a], V[b]]}, "properties": {
                "line_id": lid, "span": j, "src_from": a, "src_to": b,
                "prov": "X" if len(r["provenance"]) == 2 else r["provenance"][0],
                "m_state": r["state"]["M"], "i_state": r["state"]["I"],
                "m_min": nz(r["min"]["M"]), "i_min": nz(r["min"]["I"]),
                "m_ge66": nz(pm and pm[66]), "m_ge33": nz(pm and pm[33]),
                "i_ge66": nz(pi and pi[66]), "i_ge33": nz(pi and pi[33])}})
    Path(dst).write_text(json.dumps({"type": "FeatureCollection", "name": "spans", "features": feats}))
    print(f"{len(feats)} simplified segments written to {dst}")
    if skipped:
        print(f"{len(skipped)} lines skipped (missing, not a single LineString, or not a vertex subset of the source): {skipped[:10]}")
    if ambiguous:
        print(f"{len(ambiguous)} lines skipped because the source vertices they keep cannot be identified uniquely "
              f"(a coordinate occurs more than once); supply retained source indices instead: {ambiguous[:10]}")


if __name__ == "__main__":
    a = sys.argv[1:]
    if len(a) == 3 and a[0] == "lines":
        cmd_lines(a[1], a[2])
    elif len(a) in (4, 6) and a[0] == "wrap" and (len(a) == 4 or a[4] == "--null-code"):
        cmd_wrap(a[1], a[2], a[3], float(a[5]) if len(a) == 6 else None)
    else:
        raise SystemExit(__doc__)
