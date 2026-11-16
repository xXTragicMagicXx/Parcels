import * as maplibregl from "maplibre-gl";
import type { LngLatLike, MapGeoJSONFeature } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import { Protocol } from "pmtiles";
import "./app.css";
import { DETAIL_ZOOM, IDAHO_BOUNDS, loadCounties } from "./config";
import { allNotes, exportNotes, importNotes, onNotesChange, starredUids } from "./notes";
import { hidePanel, setPanelCloseHandler, showParcel, type ParcelProps } from "./parcelPanel";
import { loadIndexes, search } from "./search";
import { addParcelLayers, basemapStyle, selectedFilter, starredFilter, type Basemap } from "./style";
import { store, toast } from "./ui";

// Give MapLibre its worker file explicitly so it survives bundling.
maplibregl.setWorkerUrl(workerUrl);

const protocol = new Protocol();
maplibregl.addProtocol("pmtiles", protocol.tile);

let basemap: Basemap = store.get("basemap") === "satellite" ? "satellite" : "streets";
let selectedUid: string | null = null;
let starred: string[] = [];

const map = new maplibregl.Map({
  container: "map",
  style: basemapStyle(basemap),
  bounds: IDAHO_BOUNDS,
  hash: true, // #zoom/lat/lon keeps your place on reload and in bookmarks
  maxZoom: 20,
  attributionControl: { compact: true },
});
(window as any).__map = map; // handy for debugging and tests

map.addControl(new maplibregl.NavigationControl({ showCompass: true }), "bottom-right");
const geolocate = new maplibregl.GeolocateControl({
  positionOptions: { enableHighAccuracy: true },
  trackUserLocation: true,
  showAccuracyCircle: true,
});
map.addControl(geolocate, "bottom-right");
map.addControl(new maplibregl.ScaleControl({ unit: "imperial" }), "bottom-left");

// ---- layers survive basemap switches ----
map.on("style.load", () => addParcelLayers(map, basemap, selectedUid, starred));

const basemapBtn = document.getElementById("btn-basemap")!;
function updateBasemapButton() {
  basemapBtn.title = basemap === "streets" ? "Switch to satellite" : "Switch to street map";
  basemapBtn.classList.toggle("on", basemap === "satellite");
}
updateBasemapButton();
basemapBtn.addEventListener("click", () => {
  basemap = basemap === "streets" ? "satellite" : "streets";
  store.set("basemap", basemap);
  updateBasemapButton();
  map.setStyle(basemapStyle(basemap));
});

// ---- selection ----
function setSelected(uid: string | null) {
  selectedUid = uid;
  if (map.getLayer("parcels-selected")) map.setFilter("parcels-selected", selectedFilter(uid));
}
setPanelCloseHandler(() => setSelected(null));

async function refreshStarred() {
  starred = await starredUids();
  if (map.getLayer("parcels-starred")) map.setFilter("parcels-starred", starredFilter(starred));
}
onNotesChange(() => {
  refreshStarred();
  if (!savedEl.hidden) renderSaved();
});
refreshStarred();

async function selectFeature(f: MapGeoJSONFeature) {
  const p = f.properties as ParcelProps;
  setSelected(String(p.uid));
  closeSheets();
  await showParcel(p);
  keepVisible([Number(p.lon), Number(p.lat)]);
}

/** Pan so the parcel isn't hidden under the details sheet / side panel. */
function keepVisible(at: [number, number]) {
  const panel = document.getElementById("panel")!;
  if (panel.hidden || !Number.isFinite(at[0])) return;
  const wide = innerWidth >= 768;
  const pt = map.project(at);
  const rect = map.getCanvas().getBoundingClientRect();
  const visibleBottom = wide ? rect.height : rect.height - panel.offsetHeight;
  const visibleRight = wide ? rect.width - panel.offsetWidth - 20 : rect.width;
  if (pt.y < 70 || pt.y > visibleBottom - 30 || pt.x > visibleRight - 30) {
    // Centre the parcel in the part of the map that is still visible.
    const dx = pt.x - visibleRight / 2;
    const dy = pt.y - (70 + visibleBottom) / 2;
    map.panBy([dx, dy], { duration: 350 });
  }
}

/** Wait for tiles at the current view, then pick the parcel under a point. */
function selectAt(lngLat: LngLatLike, { silent = false } = {}): Promise<boolean> {
  return new Promise((resolve) => {
    map.once("idle", () => {
      const hits = map
        .queryRenderedFeatures(map.project(lngLat), { layers: ["parcels-fill"] })
        .filter((f) => f.properties?.pid != null);
      if (hits.length) {
        selectFeature(hits[0]);
        resolve(true);
      } else {
        if (!silent) toast("No parcel data here yet");
        resolve(false);
      }
    });
    map.triggerRepaint();
  });
}

map.on("click", (e) => {
  const hit = map.queryRenderedFeatures(e.point, { layers: ["parcels-fill"] })[0];
  if (!hit) {
    hidePanel();
    setSelected(null);
    return;
  }
  if (map.getZoom() < DETAIL_ZOOM || hit.properties?.pid == null) {
    map.flyTo({ center: e.lngLat, zoom: Math.max(16, map.getZoom()) });
    selectAt(e.lngLat);
  } else {
    selectFeature(hit);
  }
});
map.on("mousemove", "parcels-fill", () => (map.getCanvas().style.cursor = "pointer"));
map.on("mouseleave", "parcels-fill", () => (map.getCanvas().style.cursor = ""));

const zoomHint = document.getElementById("zoom-hint")!;
const updateHint = () => (zoomHint.hidden = map.getZoom() >= 11);
map.on("zoomend", updateHint);
map.on("load", updateHint);

// ---- "Parcel here": GPS -> parcel under you ----
const hereBtn = document.getElementById("btn-here") as HTMLButtonElement;
hereBtn.addEventListener("click", () => {
  if (!("geolocation" in navigator)) return toast("This device has no GPS");
  hereBtn.disabled = true;
  hereBtn.classList.add("busy");
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const at: [number, number] = [pos.coords.longitude, pos.coords.latitude];
      map.jumpTo({ center: at, zoom: Math.max(17, map.getZoom()) });
      const found = await selectAt(at, { silent: true });
      if (!found) toast("You're not inside a parcel we have data for");
      else if (pos.coords.accuracy > 30) toast(`GPS accuracy ±${Math.round(pos.coords.accuracy * 3.28)} ft, so check the lines`);
      hereBtn.disabled = false;
      hereBtn.classList.remove("busy");
    },
    (err) => {
      toast(err.code === err.PERMISSION_DENIED ? "Location permission is off" : "Couldn't get your location");
      hereBtn.disabled = false;
      hereBtn.classList.remove("busy");
    },
    { enableHighAccuracy: true, timeout: 20000, maximumAge: 5000 },
  );
});

// ---- search ----
const input = document.getElementById("search") as HTMLInputElement;
const results = document.getElementById("results") as HTMLUListElement;
let searchTimer: number | undefined;
let searchSeq = 0;

input.addEventListener("focus", () => loadIndexes().catch(() => {}), { once: true });
input.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = window.setTimeout(runSearch, 200);
});
input.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    results.hidden = true;
    input.blur();
  }
  if (e.key === "Enter") (results.querySelector("li[data-i]") as HTMLElement | null)?.click();
});
document.addEventListener("click", (e) => {
  if (!(e.target as HTMLElement).closest(".search-wrap")) results.hidden = true;
});

async function runSearch() {
  const q = input.value.trim();
  const seq = ++searchSeq;
  if (q.length < 2) {
    results.hidden = true;
    return;
  }
  results.hidden = false;
  results.innerHTML = `<li class="muted">Searching…</li>`;
  let hits;
  try {
    hits = await search(q);
  } catch {
    results.innerHTML = `<li class="muted">Search data failed to load</li>`;
    return;
  }
  if (seq !== searchSeq) return;
  if (!hits.length) {
    results.innerHTML = `<li class="muted">No matches</li>`;
    return;
  }
  const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  results.innerHTML = hits
    .map(
      (h, i) => `<li data-i="${i}" role="option">
        <div>${esc(h.address || h.owner || h.pid)}</div>
        <div class="muted small">${esc([h.address && h.owner, h.city, h.pid].filter(Boolean).join(" · "))}</div>
      </li>`,
    )
    .join("");
  results.querySelectorAll<HTMLElement>("li[data-i]").forEach((li) =>
    li.addEventListener("click", () => {
      const h = hits[Number(li.dataset.i)];
      results.hidden = true;
      input.blur();
      goTo([h.lon, h.lat]);
    }),
  );
}

function goTo(at: [number, number]) {
  map.jumpTo({ center: at, zoom: 17 });
  selectAt(at);
}

// ---- sheets: My parcels, Coverage ----
const savedEl = document.getElementById("saved")!;
const infoEl = document.getElementById("info")!;
function closeSheets() {
  savedEl.hidden = true;
  infoEl.hidden = true;
}
document.querySelectorAll<HTMLElement>("[data-close]").forEach((b) =>
  b.addEventListener("click", () => (document.getElementById(b.dataset.close!)!.hidden = true)),
);

document.getElementById("btn-saved")!.addEventListener("click", async () => {
  const open = savedEl.hidden;
  closeSheets();
  if (open) {
    hidePanel();
    setSelected(null);
    await renderSaved();
    savedEl.hidden = false;
  }
});

async function renderSaved() {
  const list = document.getElementById("saved-list")!;
  const notes = await allNotes();
  const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  list.innerHTML = notes.length
    ? `<ul class="saved">${notes
        .map(
          (n, i) => `<li data-i="${i}">
            <div><span class="star-mark">${n.starred ? "★" : "✎"}</span> ${esc(n.label)}</div>
            <div class="muted small">${esc(n.pid)} · ${esc(n.county)}</div>
            ${n.note ? `<div class="snippet">${esc(n.note.slice(0, 140))}</div>` : ""}
          </li>`,
        )
        .join("")}</ul>`
    : `<p class="muted">Nothing saved yet. Tap a parcel and press ☆ Save or write a note.</p>`;
  list.querySelectorAll<HTMLElement>("li[data-i]").forEach((li) =>
    li.addEventListener("click", () => {
      const n = notes[Number(li.dataset.i)];
      savedEl.hidden = true;
      goTo([n.lon, n.lat]);
    }),
  );
}

document.getElementById("btn-info")!.addEventListener("click", async () => {
  const open = infoEl.hidden;
  closeSheets();
  if (!open) return;
  hidePanel();
  setSelected(null);
  infoEl.hidden = false;
  const el = document.getElementById("coverage")!;
  try {
    const cs = await loadCounties();
    const label = { active: "On the map", request: "Data on request", unknown: "Not added yet", none: "Not published" };
    const order = { active: 0, request: 1, unknown: 2, none: 3 };
    el.innerHTML = `<ul class="coverage">${[...cs]
      .sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name))
      .map(
        (c) => `<li class="${c.status}"><b>${c.name}</b>
          <span class="tag">${label[c.status]}</span>
          ${c.status === "active" ? `<span class="tag ${c.has_owner ? "ok" : "warn"}">${c.has_owner ? "owners" : "no owners"}</span>` : ""}
          ${c.updated ? `<span class="muted small">updated ${c.updated}</span>` : ""}
          ${c.notes && c.status !== "unknown" ? `<div class="muted small">${c.notes}</div>` : ""}</li>`,
      )
      .join("")}</ul>`;
  } catch {
    el.innerHTML = `<p class="muted">Couldn't load county list.</p>`;
  }
});

document.getElementById("btn-export")!.addEventListener("click", async () => {
  const blob = await exportNotes();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `parcel-notes-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
document.getElementById("file-import")!.addEventListener("change", async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  try {
    const n = await importNotes(file);
    toast(`Imported ${n} note${n === 1 ? "" : "s"}`);
  } catch (err) {
    toast((err as Error).message);
  }
  (e.target as HTMLInputElement).value = "";
});

// ---- shared links: ?at=lat,lon selects that parcel ----
const at = new URLSearchParams(location.search).get("at");
if (at) {
  const [lat, lon] = at.split(",").map(Number);
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    map.once("load", () => goTo([lon, lat]));
  }
}
