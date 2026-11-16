"""Map each county's raw files to the common schema.

Output: data/work/<county>.geojsonl (one Feature per line, EPSG:4326),
ready for tippecanoe.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import geopandas as gpd
import pandas as pd
from shapely import force_2d, make_valid
from shapely.geometry import mapping

from .config import NUMERIC, RAW, SCHEMA, WORK

EQUAL_AREA = "EPSG:5070"  # CONUS Albers, for acreage
SQM_PER_ACRE = 4046.8564224


def _read_raw(county: dict) -> gpd.GeoDataFrame:
    folder = RAW / county["key"]
    if not folder.exists():
        raise SystemExit(f"No raw data for {county['key']}; run fetch first.")
    files = [p for p in folder.iterdir() if p.suffix.lower() in {".zip", ".geojson", ".gpkg", ".shp"}]
    frames = []
    for p in sorted(files):
        g = gpd.read_file(p)
        if g.crs is None:
            g = g.set_crs("EPSG:4326")
        frames.append(g.to_crs("EPSG:4326"))
    if not frames:
        raise SystemExit(f"No readable files in {folder}")
    return gpd.GeoDataFrame(pd.concat(frames, ignore_index=True), crs="EPSG:4326")


def _clean(v):
    if v is None:
        return None
    if isinstance(v, float) and math.isnan(v):
        return None
    if isinstance(v, str):
        v = " ".join(v.split())
        return v or None
    return v


def _field(row, spec):
    if spec is None:
        return None
    if isinstance(spec, list):
        parts = [_clean(row.get(s)) for s in spec]
        parts = [str(p) for p in parts if p not in (None, "")]
        return " ".join(parts) or None
    return _clean(row.get(spec))


def _number(v):
    if v in (None, ""):
        return None
    try:
        n = float(v)
    except (TypeError, ValueError):
        return None
    if math.isnan(n):
        return None
    return int(n) if n.is_integer() else round(n, 2)


def normalize_county(county: dict) -> Path:
    print(f"Normalizing {county['name']}")
    g = _read_raw(county)
    n_raw = len(g)

    g = g[g.geometry.notna() & ~g.geometry.is_empty].copy()
    bad = ~g.geometry.is_valid
    if bad.any():
        g.loc[bad, "geometry"] = g.loc[bad, "geometry"].apply(make_valid)
    g = g[g.geometry.geom_type.isin(["Polygon", "MultiPolygon", "GeometryCollection"])]
    # make_valid can return collections; keep only polygon parts
    g["geometry"] = g.geometry.apply(
        lambda geom: geom if geom.geom_type != "GeometryCollection"
        else gpd.GeoSeries([p for p in geom.geoms if p.geom_type in ("Polygon", "MultiPolygon")]).union_all()
    )
    g = g[~g.geometry.is_empty]
    g["geometry"] = force_2d(g.geometry.values)

    calc_acres = g.geometry.to_crs(EQUAL_AREA).area / SQM_PER_ACRE
    centroids = g.geometry.representative_point()

    fields = county.get("fields", {})
    WORK.mkdir(parents=True, exist_ok=True)
    out = WORK / f"{county['key']}.geojsonl"
    seen: dict[str, int] = {}
    written = 0
    with open(out, "w") as f:
        for (idx, row), acres_calc, pt in zip(g.iterrows(), calc_acres, centroids):
            props = {"county": county["key"]}
            for key in SCHEMA:
                v = _field(row, fields.get(key))
                if key in NUMERIC:
                    v = _number(v)
                if v is not None:
                    props[key] = v
            if not props.get("pid"):
                continue
            if "UNKNOWN" in str(props.get("situs_addr", "")).upper():
                del props["situs_addr"]
            if props.get("total_val") is None and (props.get("land_val") or props.get("impr_val")):
                props["total_val"] = (props.get("land_val") or 0) + (props.get("impr_val") or 0)
            if not props.get("acres"):
                props["acres"] = round(float(acres_calc), 3)
                props["acres_calc"] = 1
            props["uid"] = f"{county['key']}:{props['pid']}"
            # Same parcel can appear in more than one source layer (e.g. a
            # district layer and the commercial layer). Keep the first, but
            # number true duplicates (condos, split shapes) so ids stay unique.
            n = seen.get(props["uid"], 0)
            seen[props["uid"]] = n + 1
            if n:
                props["uid"] += f"#{n}"
            props["lon"], props["lat"] = round(pt.x, 6), round(pt.y, 6)
            f.write(json.dumps({"type": "Feature", "properties": props,
                                "geometry": mapping(row.geometry)}) + "\n")
            written += 1
    dupes = sum(v - 1 for v in seen.values() if v > 1)
    print(f"  {n_raw} raw -> {written} parcels written ({dupes} shapes share a parcel number)")
    return out
