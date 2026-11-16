// Where the pipeline output lives. In dev it is web/public/data; in production
// set VITE_DATA_URL (e.g. "/data" served by the Pages Function, or an R2 URL).
const base = (import.meta.env.VITE_DATA_URL as string | undefined) ?? "/data";
export const DATA_URL = new URL(base.replace(/\/$/, ""), location.href).href;

/** Below this zoom tiles hold outlines only; tapping zooms in. Matches pipeline DETAIL_ZOOM. */
export const DETAIL_ZOOM = 14;

export const IDAHO_BOUNDS: [number, number, number, number] = [-117.25, 41.98, -111.04, 49.0];

export interface CountyInfo {
  key: string;
  name: string;
  status: "active" | "request" | "unknown" | "none";
  has_owner: boolean;
  lookup_url: string | null;
  source_page: string | null;
  notes: string | null;
  updated: string | null;
}

let countiesPromise: Promise<CountyInfo[]> | null = null;

export function loadCounties(): Promise<CountyInfo[]> {
  countiesPromise ??= fetch(`${DATA_URL}/counties.json`)
    .then((r) => {
      if (!r.ok) throw new Error(`counties.json: HTTP ${r.status}`);
      return r.json();
    })
    .then((d) => d.counties as CountyInfo[])
    .catch((e) => {
      countiesPromise = null;
      throw e;
    });
  return countiesPromise;
}

export async function countyInfo(key: string): Promise<CountyInfo | undefined> {
  return (await loadCounties()).find((c) => c.key === key);
}
