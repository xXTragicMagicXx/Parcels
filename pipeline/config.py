"""Paths and source-list loading shared by the pipeline steps."""

from __future__ import annotations

import os
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
RAW = DATA / "raw"            # untouched downloads, one folder per county
WORK = DATA / "work"          # normalized newline-delimited GeoJSON per county
OUT = Path(os.environ.get("PARCELS_OUT", ROOT / "web" / "public" / "data"))
SOURCES = DATA / "sources.yaml"

# Common schema every county is mapped to. Order is the order shown in the app.
SCHEMA = [
    "pid",          # parcel number as the county prints it
    "alt_id",       # second county id, if any
    "owner",
    "mail_addr",
    "situs_addr",
    "situs_city",
    "acres",        # county-reported acres, else computed from the shape
    "land_val",
    "impr_val",
    "total_val",
    "net_val",      # value after exemptions
    "prop_class",
    "zoning",
    "subdivision",
    "legal",
]
NUMERIC = {"acres", "land_val", "impr_val", "total_val", "net_val"}

USER_AGENT = "idaho-parcels-pipeline/1.0 (personal, non-commercial)"


def load_sources() -> dict[str, dict]:
    with open(SOURCES) as f:
        counties = yaml.safe_load(f)["counties"]
    for key, c in counties.items():
        c["key"] = key
    return counties


def active_counties(only: list[str] | None = None) -> list[dict]:
    counties = load_sources()
    if only:
        missing = [k for k in only if k not in counties]
        if missing:
            raise SystemExit(f"Unknown county key(s): {', '.join(missing)}")
        picked = [counties[k] for k in only]
        inactive = [c["key"] for c in picked if c.get("status") != "active"]
        if inactive:
            raise SystemExit(f"County not active in sources.yaml: {', '.join(inactive)}")
        return picked
    return [c for c in counties.values() if c.get("status") == "active"]
