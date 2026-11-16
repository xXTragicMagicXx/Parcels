import { DATA_URL, loadCounties } from "./config";

export interface SearchHit {
  uid: string;
  county: string;
  pid: string;
  owner: string | null;
  address: string | null;
  city: string | null;
  lon: number;
  lat: number;
}

interface Index {
  county: string;
  rows: SearchHit[];
  hay: string[]; // upper-cased text per row
}

let indexes: Promise<Index[]> | null = null;

async function gunzipJson(res: Response): Promise<any> {
  const bytes = new Uint8Array(await res.arrayBuffer());
  // Some hosts decompress .gz for us (Content-Encoding); check the gzip magic bytes.
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    return JSON.parse(await new Response(stream).text());
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

async function loadIndex(county: string): Promise<Index> {
  const res = await fetch(`${DATA_URL}/search/${county}.json.gz`);
  if (!res.ok) throw new Error(`search index ${county}: HTTP ${res.status}`);
  const { fields, rows } = await gunzipJson(res);
  const at = (name: string) => fields.indexOf(name);
  const [iu, ip, io, ia, ic, ix, iy] = ["uid", "pid", "owner", "situs_addr", "situs_city", "lon", "lat"].map(at);
  const hits: SearchHit[] = rows.map((r: any[]) => ({
    uid: r[iu], county, pid: r[ip], owner: r[io], address: r[ia], city: r[ic], lon: r[ix], lat: r[iy],
  }));
  const hay = hits.map((h) => `${h.pid} ${h.owner ?? ""} ${h.address ?? ""} ${h.city ?? ""}`.toUpperCase());
  return { county, rows: hits, hay };
}

export function loadIndexes(): Promise<Index[]> {
  indexes ??= loadCounties()
    .then((cs) => Promise.all(cs.filter((c) => c.status === "active").map((c) => loadIndex(c.key))))
    .catch((e) => {
      indexes = null;
      throw e;
    });
  return indexes;
}

/** Every word in the query must appear in the parcel's text. */
export async function search(query: string, limit = 50): Promise<SearchHit[]> {
  const words = query.toUpperCase().split(/[\s,]+/).filter(Boolean);
  if (!words.length) return [];
  const out: SearchHit[] = [];
  for (const idx of await loadIndexes()) {
    for (let i = 0; i < idx.hay.length && out.length < limit; i++) {
      const h = idx.hay[i];
      if (words.every((w) => h.includes(w))) out.push(idx.rows[i]);
    }
  }
  return out;
}
