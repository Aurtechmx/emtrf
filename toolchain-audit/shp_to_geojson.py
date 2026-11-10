"""Shapefile lines -> GeoJSON (format conversion only; pure-Python pyshp, no GDAL)."""
import json, sys
import shapefile


def convert(src, dst):
    r = shapefile.Reader(str(src)); names = [f[0] for f in r.fields[1:]]; feats = []
    for sr in r.iterShapeRecords():
        pts, parts = sr.shape.points, list(sr.shape.parts) + [len(sr.shape.points)]
        props = dict(zip(names, sr.record))
        lvl = next((props[k] for k in ("Z", "z", "HEIGHT", "ELEV", "elev", "LEVEL", "level", "VALUE", "value") if k in props), None)
        for a, b in zip(parts[:-1], parts[1:]):
            feats.append({"type": "Feature", "properties": {"level": float(lvl)}, "geometry": {"type": "LineString", "coordinates": [list(p[:2]) for p in pts[a:b]]}})
    json.dump({"type": "FeatureCollection", "features": feats}, open(dst, "w"))


if __name__ == "__main__":
    convert(sys.argv[1], sys.argv[2])
