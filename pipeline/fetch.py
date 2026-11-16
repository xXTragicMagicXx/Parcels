"""Download raw parcel data for each active county into data/raw/<county>/."""

from __future__ import annotations

import json
import shutil
import time
from pathlib import Path
from urllib.parse import urlparse

import requests

from .config import RAW, USER_AGENT

session = requests.Session()
session.headers["User-Agent"] = USER_AGENT


def _get(url: str, params: dict | None = None, *, stream=False, tries=5, timeout=120):
    for attempt in range(1, tries + 1):
        try:
            r = session.get(url, params=params, stream=stream, timeout=timeout)
            r.raise_for_status()
            return r
        except requests.RequestException as e:
            if attempt == tries:
                raise
            wait = 2 ** attempt
            print(f"    retry {attempt}/{tries - 1} in {wait}s: {e}")
            time.sleep(wait)


def fetch_download(county: dict, dest: Path) -> None:
    url = county["url"]
    name = Path(urlparse(url).path).name or "data.zip"
    target = dest / name
    if url.startswith("file://"):
        shutil.copy(urlparse(url).path, target)
    else:
        with _get(url, stream=True, timeout=600) as r, open(target, "wb") as f:
            for chunk in r.iter_content(1 << 20):
                f.write(chunk)
    print(f"  saved {target.name} ({target.stat().st_size / 1e6:.1f} MB)")


def _arcgis_json(url: str, params: dict) -> dict:
    data = _get(url, {**params, "f": "json"}).json()
    if "error" in data:
        raise RuntimeError(f"{url}: {data['error']}")
    return data


def fetch_arcgis_layer(base: str, layer: int, dest: Path) -> int:
    """Page through one layer by object id and write a GeoJSON FeatureCollection."""
    layer_url = f"{base.rstrip('/')}/{layer}"
    info = _arcgis_json(layer_url, {})
    batch = min(int(info.get("maxRecordCount") or 1000), 1000)
    oid_field = next(
        (f["name"] for f in info.get("fields", []) if f["type"] == "esriFieldTypeOID"),
        "OBJECTID",
    )
    ids = _arcgis_json(f"{layer_url}/query", {"where": "1=1", "returnIdsOnly": "true"})
    oids = sorted(ids.get("objectIds") or [])
    print(f"  layer {layer} '{info.get('name')}': {len(oids)} features")

    features = []
    for i in range(0, len(oids), batch):
        chunk = oids[i : i + batch]
        params = {
            "where": f"{oid_field} >= {chunk[0]} AND {oid_field} <= {chunk[-1]}",
            "outFields": "*",
            "returnGeometry": "true",
            "outSR": "4326",
            "geometryPrecision": "7",
            "f": "geojson",
        }
        page = _get(f"{layer_url}/query", params).json()
        if "error" in page:
            raise RuntimeError(f"{layer_url}: {page['error']}")
        features.extend(page.get("features", []))
        print(f"    {min(i + batch, len(oids))}/{len(oids)}", end="\r")
    print()
    if len(features) != len(oids):
        raise RuntimeError(
            f"layer {layer}: expected {len(oids)} features, got {len(features)}"
        )
    with open(dest / f"layer_{layer}.geojson", "w") as f:
        json.dump({"type": "FeatureCollection", "features": features}, f)
    return len(features)


def fetch_county(county: dict) -> None:
    dest = RAW / county["key"]
    if dest.exists():
        shutil.rmtree(dest)
    dest.mkdir(parents=True)
    print(f"Fetching {county['name']} ({county['type']})")
    if county["type"] == "download":
        fetch_download(county, dest)
    elif county["type"] == "arcgis_rest":
        total = sum(fetch_arcgis_layer(county["url"], l, dest) for l in county["layers"])
        print(f"  {total} features total")
    else:
        raise SystemExit(f"{county['key']}: unknown type {county['type']!r}")
    (dest / "fetched_at.txt").write_text(time.strftime("%Y-%m-%d"))
