"""Build the files the web app reads, into web/public/data/ (or $PARCELS_OUT):

  parcels.pmtiles          all active counties' parcel shapes + attributes
  search/<county>.json.gz  compact search index per county
  counties.json            coverage list and per-county info for the app
"""

from __future__ import annotations

import gzip
import json
import os
import shutil
import subprocess
import time

from .config import OUT, RAW, WORK, load_sources

SEARCH_FIELDS = ["uid", "pid", "owner", "situs_addr", "situs_city", "lon", "lat"]


def _tippecanoe() -> str:
    exe = os.environ.get("TIPPECANOE") or shutil.which("tippecanoe")
    if not exe:
        raise SystemExit(
            "tippecanoe not found. Install it (brew install tippecanoe, or build "
            "https://github.com/felt/tippecanoe) or set TIPPECANOE=/path/to/tippecanoe."
        )
    return exe


DETAIL_ZOOM = 14  # full attributes from this zoom up; outlines only below


def build_tiles(keys: list[str]) -> None:
    inputs = [str(WORK / f"{k}.geojsonl") for k in keys]
    missing = [p for p in inputs if not os.path.exists(p)]
    if missing:
        raise SystemExit(f"Missing normalized data: {missing}. Run normalize first.")
    OUT.mkdir(parents=True, exist_ok=True)
    tmp = WORK / "tiles"
    tmp.mkdir(exist_ok=True)
    tippecanoe = _tippecanoe()
    common = [
        "--force", "--quiet", "--read-parallel", "-P",
        # Keep every parcel at every zoom; parcels are small and must not vanish.
        "--no-feature-limit", "--no-tile-size-limit",
        "--detect-shared-borders", "--simplification=4",
    ]
    # One label point per parcel, so addresses don't repeat where a parcel
    # is cut by a tile edge.
    labels = tmp / "labels.geojsonl"
    with open(labels, "w") as out:
        for path in inputs:
            with open(path) as f:
                for line in f:
                    p = json.loads(line)["properties"]
                    if p.get("situs_addr"):
                        out.write(json.dumps({
                            "type": "Feature",
                            "properties": {"uid": p["uid"], "situs_addr": p["situs_addr"]},
                            "geometry": {"type": "Point", "coordinates": [p["lon"], p["lat"]]},
                        }) + "\n")
    print("Building parcel tiles")
    # Low zooms: shapes + uid only (tapping zooms in). High zooms: everything.
    subprocess.run([tippecanoe, "-o", str(tmp / "low.pmtiles"), *common, "--layer=parcels",
                    "-Z11", f"-z{DETAIL_ZOOM - 1}", "-y", "uid", "-y", "county",
                    *inputs], check=True)
    subprocess.run([tippecanoe, "-o", str(tmp / "high.pmtiles"), *common,
                    f"-Z{DETAIL_ZOOM}", "-z15",
                    *[f"-Lparcels:{p}" for p in inputs], f"-Llabels:{labels}"], check=True)
    target = OUT / "parcels.pmtiles"
    join = os.path.join(os.path.dirname(tippecanoe), "tile-join")
    if not os.path.exists(join):
        join = shutil.which("tile-join") or "tile-join"
    subprocess.run([join, "-o", str(target), "--force", "--quiet",
                    "--no-tile-size-limit", str(tmp / "low.pmtiles"), str(tmp / "high.pmtiles")],
                   check=True)
    shutil.rmtree(tmp)
    print(f"  parcels.pmtiles: {target.stat().st_size / 1e6:.1f} MB")


def build_search(key: str) -> None:
    folder = OUT / "search"
    folder.mkdir(parents=True, exist_ok=True)
    rows = []
    with open(WORK / f"{key}.geojsonl") as f:
        for line in f:
            p = json.loads(line)["properties"]
            rows.append([p.get(k) for k in SEARCH_FIELDS])
    body = json.dumps({"fields": SEARCH_FIELDS, "rows": rows}, separators=(",", ":"))
    target = folder / f"{key}.json.gz"
    # mtime=0 keeps output byte-identical when data has not changed
    with gzip.GzipFile(target, "wb", mtime=0) as gz:
        gz.write(body.encode())
    print(f"  search/{key}.json.gz: {len(rows)} rows, {target.stat().st_size / 1e6:.1f} MB")


def build_counties_json(built: list[str]) -> None:
    out = []
    for key, c in load_sources().items():
        fetched = RAW / key / "fetched_at.txt"
        out.append({
            "key": key,
            "name": c["name"],
            "status": "active" if key in built else c.get("status", "unknown"),
            "has_owner": bool(c.get("has_owner")),
            "lookup_url": c.get("lookup_url"),
            "source_page": c.get("source_page"),
            "notes": " ".join((c.get("notes") or "").split()) or None,
            "updated": fetched.read_text().strip() if fetched.exists() else None,
        })
    (OUT / "counties.json").write_text(json.dumps(
        {"built": time.strftime("%Y-%m-%d"), "counties": out}, indent=1))
    print(f"  counties.json: {len(built)} of {len(out)} counties built")


def build_all() -> None:
    # Always build from every county that has normalized data, so running one
    # county never drops the others from the map.
    keys = sorted(p.stem for p in WORK.glob("*.geojsonl"))
    if not keys:
        raise SystemExit("Nothing to build; run fetch and normalize first.")
    build_tiles(keys)
    print("Building search indexes")
    for k in keys:
        build_search(k)
    build_counties_json(keys)
