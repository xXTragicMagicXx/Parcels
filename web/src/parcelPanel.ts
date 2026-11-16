import { countyInfo, type CountyInfo } from "./config";
import { getNote, saveNote, type ParcelNote } from "./notes";
import { toast } from "./ui";

export type ParcelProps = Record<string, string | number | undefined>;

const panel = document.getElementById("panel")!;
let onClose: () => void = () => {};

export function setPanelCloseHandler(fn: () => void) {
  onClose = fn;
}

const esc = (v: unknown) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const money = (v: unknown) =>
  typeof v === "number" ? v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }) : null;
const acres = (p: ParcelProps) =>
  typeof p.acres === "number"
    ? `${p.acres.toLocaleString("en-US", { maximumFractionDigits: 2 })} ac${p.acres_calc ? " (calculated)" : ""}`
    : null;

function row(label: string, value: string | null | undefined) {
  return value ? `<tr><th>${esc(label)}</th><td>${esc(value)}</td></tr>` : "";
}

function ownerBlock(p: ParcelProps, county: CountyInfo | undefined) {
  if (p.owner) {
    return `<section class="owner">
      <div class="label">Owner</div>
      <div class="owner-name">${esc(p.owner)}</div>
      ${p.mail_addr ? `<div class="muted">Mail: ${esc(p.mail_addr)}</div>` : ""}
    </section>`;
  }
  const name = county?.name ?? String(p.county);
  return `<section class="owner missing">
    <div class="label">Owner</div>
    <p class="muted">${esc(name)} County doesn't include owner names in its free data.</p>
    ${county?.lookup_url
      ? `<button class="btn" data-act="lookup">Look up owner on county site</button>
         <div class="muted small">Copies the parcel number so you can paste it into the county search.</div>`
      : ""}
  </section>`;
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export async function showParcel(p: ParcelProps): Promise<void> {
  const county = await countyInfo(String(p.county)).catch(() => undefined);
  const uid = String(p.uid);
  const existing = await getNote(uid);
  const note: ParcelNote = existing ?? {
    uid,
    county: String(p.county),
    pid: String(p.pid),
    label: String(p.situs_addr || p.owner || p.pid),
    lon: Number(p.lon),
    lat: Number(p.lat),
    starred: false,
    note: "",
    updated: "",
  };

  const title = p.situs_addr ? String(p.situs_addr) : "No street address";
  panel.innerHTML = `
    <div class="sheet-head">
      <div>
        <h2>${esc(title)}</h2>
        <div class="muted">${esc(p.situs_city ? `${p.situs_city} · ` : "")}${esc(county?.name ?? p.county)} County</div>
      </div>
      <button class="close" data-act="close" aria-label="Close">×</button>
    </div>
    <div class="actions">
      <button class="btn star ${note.starred ? "on" : ""}" data-act="star" aria-pressed="${note.starred}">
        ${note.starred ? "★ Saved" : "☆ Save"}</button>
      <a class="btn" target="_blank" rel="noopener"
         href="https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lon}">Directions</a>
      <button class="btn" data-act="share">Share</button>
    </div>
    ${ownerBlock(p, county)}
    <table class="facts">
      <tr><th>Parcel #</th><td><button class="linkish" data-act="copy-pid" title="Copy">${esc(p.pid)} ⧉</button></td></tr>
      ${row("Other ID", p.alt_id as string)}
      ${row("Acres", acres(p))}
      ${row("Land value", money(p.land_val))}
      ${row("Improvements", money(p.impr_val))}
      ${row("Total value", money(p.total_val))}
      ${row("Net taxable", money(p.net_val))}
      ${row("Class", p.prop_class as string)}
      ${row("Zoning", p.zoning as string)}
      ${row("Subdivision", p.subdivision as string)}
      ${row("Legal", p.legal as string)}
    </table>
    <label class="note-label" for="note-text">My notes <span id="note-status" class="muted small"></span></label>
    <textarea id="note-text" rows="4" placeholder="Private note, saved on this device">${esc(note.note)}</textarea>
    ${county?.updated ? `<p class="muted small">Data from ${esc(county.name)} County, downloaded ${esc(county.updated)}.</p>` : ""}
  `;
  panel.hidden = false;
  panel.scrollTop = 0;

  const status = panel.querySelector<HTMLElement>("#note-status")!;
  const text = panel.querySelector<HTMLTextAreaElement>("#note-text")!;
  let timer: number | undefined;
  text.addEventListener("input", () => {
    status.textContent = "…";
    clearTimeout(timer);
    timer = window.setTimeout(async () => {
      note.note = text.value;
      await saveNote(note);
      status.textContent = "Saved";
    }, 400);
  });

  panel.onclick = async (e) => {
    const act = (e.target as HTMLElement).closest<HTMLElement>("[data-act]")?.dataset.act;
    switch (act) {
      case "close":
        hidePanel();
        onClose();
        break;
      case "star": {
        note.starred = !note.starred;
        note.note = text.value;
        await saveNote(note);
        const b = panel.querySelector<HTMLElement>('[data-act="star"]')!;
        b.classList.toggle("on", note.starred);
        b.setAttribute("aria-pressed", String(note.starred));
        b.textContent = note.starred ? "★ Saved" : "☆ Save";
        break;
      }
      case "copy-pid":
        toast((await copy(String(p.pid))) ? "Parcel number copied" : String(p.pid));
        break;
      case "lookup":
        await copy(String(p.pid));
        window.open(county!.lookup_url!, "_blank", "noopener");
        toast(`Parcel number ${p.pid} copied`);
        break;
      case "share": {
        const url = `${location.origin}${location.pathname}?at=${p.lat},${p.lon}#17/${p.lat}/${p.lon}`;
        const msg = `${title} — parcel ${p.pid} (${county?.name ?? p.county} County)`;
        if (navigator.share) navigator.share({ title: msg, url }).catch(() => {});
        else toast((await copy(`${msg}\n${url}`)) ? "Link copied" : url);
        break;
      }
    }
  };
}

export function hidePanel(): void {
  panel.hidden = true;
  panel.innerHTML = "";
}
