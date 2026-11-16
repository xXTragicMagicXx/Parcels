"""Command line: python -m pipeline <step> [--county KEY ...]

Steps:
  fetch      download raw data for active counties
  normalize  map raw data to the common schema
  build      make parcels.pmtiles, search indexes and counties.json
  run        fetch + normalize + build
  status     print the coverage table from data/sources.yaml
"""

from __future__ import annotations

import argparse
from collections import Counter

from .config import active_counties, load_sources


def status() -> None:
    counties = load_sources()
    counts = Counter(c.get("status", "unknown") for c in counties.values())
    print(f"{len(counties)} counties: " + ", ".join(f"{n} {s}" for s, n in sorted(counts.items())))
    for c in counties.values():
        if c.get("status") != "unknown":
            owner = "owners" if c.get("has_owner") else "no owners"
            print(f"  {c['name']:<11} {c['status']:<8} {owner:<9} {c.get('notes', '')[:70]}")


def main() -> None:
    ap = argparse.ArgumentParser(prog="pipeline", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("step", choices=["fetch", "normalize", "build", "run", "status"])
    ap.add_argument("--county", action="append", help="county key from sources.yaml (repeatable)")
    args = ap.parse_args()

    if args.step == "status":
        return status()

    from . import build, fetch, normalize  # heavy imports only when needed

    counties = active_counties(args.county)
    if args.step in ("fetch", "run"):
        for c in counties:
            fetch.fetch_county(c)
    if args.step in ("normalize", "run"):
        for c in counties:
            normalize.normalize_county(c)
    if args.step in ("build", "run"):
        build.build_all()


if __name__ == "__main__":
    main()
