// End-to-end check of the app against real pipeline data.
// Needs: dev server running (npm run dev) and data for Ada + Kootenai built.
//   BASE_URL=http://localhost:5173 SHOTS=./shots node tests/e2e.mjs
import { createRequire } from "node:module";
const { chromium, devices } = createRequire(import.meta.url)("playwright");
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:5173";
const SHOTS = process.env.SHOTS ?? "./shots";
const SCALE = Number(process.env.SCALE ?? 1);
mkdirSync(SHOTS, { recursive: true });

// Known parcels (from the county data)
const KOOTENAI = { lat: 47.607481, lon: -116.76227, addr: "7441 S BUCKRAIL RD", owner: "BMS HOLDINGS LLC" };
const ADA = { lat: 43.719532, lon: -116.366065, addr: "2741 N ANACORTES LN", pid: "R0389160100" };

let failed = 0;
function check(ok, msg) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`);
  if (!ok) failed++;
}
const idle = (page) =>
  page.evaluate(() => new Promise((r) => {
    const m = window.__map;
    if (m.loaded() && m.areTilesLoaded()) setTimeout(r, 300);
    else m.once("idle", () => setTimeout(r, 300));
  }));
const panelText = (page) => page.locator("#panel").innerText();

const browser = await chromium.launch();
const errors = [];

// ---------- desktop ----------
{
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: SCALE,
    acceptDownloads: true,
    geolocation: { latitude: ADA.lat, longitude: ADA.lon, accuracy: 8 },
    permissions: ["geolocation", "clipboard-read", "clipboard-write"],
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

  // 1. Tap a Kootenai parcel -> owner panel
  await page.goto(`${BASE}/#17/${KOOTENAI.lat}/${KOOTENAI.lon}`);
  await page.waitForFunction(() => window.__map?.getLayer("parcels-fill"));
  await idle(page);
  const box = await page.locator("#map").boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.locator("#panel:not([hidden])").waitFor();
  let t = await panelText(page);
  check(t.includes(KOOTENAI.addr), "Kootenai parcel click shows address");
  check(t.includes(KOOTENAI.owner), "Kootenai parcel shows owner");
  check(/Total value|Net taxable/.test(t), "Kootenai parcel shows values");
  await page.screenshot({ path: `${SHOTS}/1-kootenai-owner-streets.png` });

  // 2. Star + note, persists across reload
  await page.click('[data-act="star"]');
  await page.fill("#note-text", "Talk to owner about the north fence line");
  await page.waitForFunction(() => document.querySelector("#note-status")?.textContent === "Saved");
  await page.reload();
  await page.waitForFunction(() => window.__map?.getLayer("parcels-fill"));
  await idle(page);
  await page.click("#btn-saved");
  await page.locator("#saved:not([hidden])").waitFor();
  t = await page.locator("#saved").innerText();
  check(t.includes(KOOTENAI.addr) && t.includes("north fence"), "Note and star persist after reload");
  const starredCount = await page.evaluate(() =>
    window.__map.queryRenderedFeatures({ layers: ["parcels-starred"] }).length);
  check(starredCount > 0, "Starred parcel is highlighted on the map");

  // 3. Export, wipe, import
  await page.click("#btn-info");
  await page.locator("#info:not([hidden])").waitFor();
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#btn-export")]);
  const backup = `${SHOTS}/notes-backup.json`;
  await dl.saveAs(backup);
  await page.evaluate(() => new Promise((r) => {
    const req = indexedDB.deleteDatabase("idaho-parcels");
    req.onsuccess = req.onerror = req.onblocked = () => r();
  }));
  await page.reload();
  await page.waitForFunction(() => window.__map?.getLayer("parcels-fill"));
  await page.click("#btn-saved");
  await page.locator("#saved:not([hidden])").waitFor();
  t = await page.locator("#saved").innerText();
  check(t.includes("Nothing saved yet"), "Notes cleared");
  await page.click("#btn-info");
  await page.locator("#info:not([hidden])").waitFor();
  await page.setInputFiles("#file-import", backup);
  await page.locator("#toast").filter({ hasText: "Imported 1 note" }).waitFor();
  await page.click("#btn-saved");
  await page.locator("#saved:not([hidden])").waitFor();
  t = await page.locator("#saved").innerText();
  check(t.includes("north fence"), "Import restores notes");
  await page.click('[data-close="saved"]');

  // 4. Search an Ada address -> no-owner panel with county lookup
  await page.fill("#search", "2741 anacortes");
  await page.locator("#results li[data-i]").first().waitFor({ timeout: 20000 });
  await page.locator("#results li[data-i]").first().click();
  await page.locator("#panel:not([hidden])").waitFor();
  await page.waitForFunction((a) => document.querySelector("#panel")?.innerText.includes(a), ADA.addr);
  t = await panelText(page);
  check(t.includes(ADA.pid), "Search result opens the right Ada parcel");
  check(t.includes("Look up owner on county site"), "Ada parcel offers county owner lookup");
  await page.fill("#search", "BMS HOLDINGS");
  await page.locator("#results li[data-i]").first().waitFor();
  check((await page.locator("#results").innerText()).includes("BUCKRAIL"), "Owner-name search finds Kootenai parcel");
  await page.keyboard.press("Escape");

  // 5. Satellite basemap
  await page.click("#btn-basemap");
  await page.waitForFunction(() => window.__map.getSource("imagery") && window.__map.getLayer("parcels-line"));
  await idle(page);
  check(true, "Satellite basemap loads with parcel layers re-added");
  await page.screenshot({ path: `${SHOTS}/2-ada-satellite.png` });

  // 6. GPS "Parcel here"
  await page.click('[data-close]', { trial: true }).catch(() => {});
  await page.evaluate(() => window.__map.jumpTo({ center: [-114, 44], zoom: 7 }));
  await page.click("#btn-here");
  await page.waitForFunction((a) => document.querySelector("#panel")?.innerText.includes(a), ADA.addr, { timeout: 30000 });
  check(true, "GPS 'Parcel here' selects the parcel at the device location");

  // 7. Low zoom tap zooms in
  await page.evaluate(() => window.__map.jumpTo({ center: [-116.37, 43.72], zoom: 12.5 }));
  await idle(page);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForFunction(() => window.__map.getZoom() >= 15.9, null, { timeout: 15000 });
  check(true, "Tapping at low zoom zooms in to the parcel");
  await ctx.close();
}

// ---------- phone ----------
{
  const ctx = await browser.newContext({
    ...devices["iPhone 15"],
    ...(process.env.SCALE ? { deviceScaleFactor: SCALE } : {}),
    geolocation: { latitude: KOOTENAI.lat, longitude: KOOTENAI.lon, accuracy: 6 },
    permissions: ["geolocation"],
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${BASE}/`);
  await page.waitForFunction(() => window.__map?.getLayer("parcels-fill"));
  await page.screenshot({ path: `${SHOTS}/3-phone-start.png` });
  await page.tap("#btn-here");
  await page.waitForFunction((o) => document.querySelector("#panel")?.innerText.includes(o), KOOTENAI.owner, { timeout: 30000 });
  await idle(page);
  check(true, "Phone: 'Parcel here' shows owner sheet");
  const vw = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
  check(vw[0] <= vw[1], "Phone: no horizontal scroll");
  const small = await page.evaluate(() =>
    [...document.querySelectorAll("button, .btn")]
      .filter((b) => b.offsetParent && !b.closest(".maplibregl-ctrl-attrib"))
      .map((b) => b.getBoundingClientRect())
      .filter((r) => r.height < 36 && r.width < 36).length);
  check(small === 0, "Phone: touch targets at least 36px");
  await page.screenshot({ path: `${SHOTS}/4-phone-parcel.png` });
  await ctx.close();
}

await browser.close();
const relevant = errors.filter((e) => !/Failed to load resource.*(404|favicon)/i.test(e));
check(relevant.length === 0, `No page errors${relevant.length ? ": " + relevant.slice(0, 3).join(" | ") : ""}`);
writeFileSync(`${SHOTS}/errors.txt`, errors.join("\n"));
console.log(failed ? `\n${failed} check(s) failed` : "\nAll checks passed");
process.exit(failed ? 1 : 0);
