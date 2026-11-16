import type { Map as MLMap, StyleSpecification, FilterSpecification } from "maplibre-gl";
import { DATA_URL } from "./config";

export type Basemap = "streets" | "satellite";

const GLYPHS = "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf";

export function basemapStyle(kind: Basemap): string | StyleSpecification {
  if (kind === "streets") return "https://tiles.openfreemap.org/styles/liberty";
  return {
    version: 8,
    glyphs: GLYPHS,
    sources: {
      imagery: {
        type: "raster",
        tiles: [
          "https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}",
        ],
        tileSize: 256,
        maxzoom: 16,
        attribution: "Imagery: USGS The National Map",
      },
    },
    layers: [
      { id: "bg", type: "background", paint: { "background-color": "#1f2a1f" } },
      { id: "imagery", type: "raster", source: "imagery" },
    ],
  };
}

const LINE = { streets: "#b45309", satellite: "#fde047" } as const;
const LABEL_FONT = ["Noto Sans Regular"];

/** Add the parcel source and layers on top of whatever basemap is loaded. */
export function addParcelLayers(
  map: MLMap,
  kind: Basemap,
  selectedUid: string | null,
  starredUids: string[],
): void {
  if (!map.getSource("parcels")) {
    map.addSource("parcels", {
      type: "vector",
      url: `pmtiles://${DATA_URL}/parcels.pmtiles`,
      attribution: "Parcels: Idaho county assessors",
    });
  }
  const layers = map.getStyle().layers ?? [];
  if (layers.some((l) => l.id === "parcels-fill")) return;

  map.addLayer({
    id: "parcels-fill",
    type: "fill",
    source: "parcels",
    "source-layer": "parcels",
    // Nearly invisible, but makes the whole parcel tappable.
    paint: { "fill-color": "#ffffff", "fill-opacity": 0.01 },
  });
  map.addLayer({
    id: "parcels-starred",
    type: "fill",
    source: "parcels",
    "source-layer": "parcels",
    filter: starredFilter(starredUids),
    paint: { "fill-color": "#f59e0b", "fill-opacity": 0.35 },
  });
  map.addLayer({
    id: "parcels-line",
    type: "line",
    source: "parcels",
    "source-layer": "parcels",
    paint: {
      "line-color": LINE[kind],
      "line-width": ["interpolate", ["linear"], ["zoom"], 11, 0.3, 14, 0.8, 17, 1.6],
      "line-opacity": ["interpolate", ["linear"], ["zoom"], 11, 0.5, 14, 0.9],
    },
  });
  map.addLayer({
    id: "parcels-selected",
    type: "line",
    source: "parcels",
    "source-layer": "parcels",
    filter: selectedFilter(selectedUid),
    paint: { "line-color": "#22d3ee", "line-width": 3.5 },
  });
  map.addLayer({
    id: "parcels-label",
    type: "symbol",
    source: "parcels",
    "source-layer": "labels",
    minzoom: 17,
    layout: {
      "text-field": ["coalesce", ["get", "situs_addr"], ""],
      "text-font": LABEL_FONT,
      "text-size": 11,
      "text-max-width": 8,
      "symbol-placement": "point",
    },
    paint: {
      "text-color": kind === "satellite" ? "#ffffff" : "#3f2d16",
      "text-halo-color": kind === "satellite" ? "#000000" : "#ffffff",
      "text-halo-width": 1.4,
    },
  });
}

export function selectedFilter(uid: string | null): FilterSpecification {
  return ["==", ["get", "uid"], uid ?? "__none__"];
}

export function starredFilter(uids: string[]): FilterSpecification {
  return ["in", ["get", "uid"], ["literal", uids]];
}
