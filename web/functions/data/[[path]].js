// Cloudflare Pages Function: serves /data/* from an R2 bucket bound as PARCELS.
// Keeps the map data on the same (Access-protected) domain as the app, and
// supports the HTTP Range requests that PMTiles needs.

/** Parse a single "bytes=a-b" / "bytes=a-" / "bytes=-n" range. */
function parseRange(header) {
  const m = /^bytes=(\d*)-(\d*)$/.exec((header ?? "").trim());
  if (!m || (m[1] === "" && m[2] === "")) return null;
  if (m[1] === "") return { suffix: Number(m[2]) };
  const offset = Number(m[1]);
  return m[2] === "" ? { offset } : { offset, length: Number(m[2]) - offset + 1 };
}

export async function onRequestGet({ request, env, params }) {
  const key = [].concat(params.path ?? []).join("/");
  if (!key || key.split("/").includes("..")) return new Response("Not found", { status: 404 });

  const range = parseRange(request.headers.get("range"));
  if (range && (range.length ?? 1) <= 0) return new Response("Bad range", { status: 416 });

  let obj;
  try {
    obj = await env.PARCELS.get(key, { range: range ?? undefined, onlyIf: request.headers });
  } catch (e) {
    // R2 rejects ranges that start past the end of the object.
    if (range) return new Response("Range not satisfiable", { status: 416 });
    throw e;
  }
  if (obj === null) return new Response("Not found", { status: 404 });

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("etag", obj.httpEtag);
  headers.set("accept-ranges", "bytes");
  headers.set("cache-control", "private, max-age=3600");

  // A failed precondition returns metadata without a body.
  if (!("body" in obj)) {
    const status = request.headers.has("if-none-match") || request.headers.has("if-modified-since") ? 304 : 412;
    return new Response(null, { status, headers });
  }

  if (range) {
    const size = obj.size;
    let start, length;
    if ("suffix" in range) {
      length = Math.min(range.suffix, size);
      start = size - length;
    } else {
      start = range.offset;
      length = Math.min(range.length ?? size - start, size - start);
    }
    if (start >= size || length <= 0) {
      return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
    }
    headers.set("content-range", `bytes ${start}-${start + length - 1}/${size}`);
    headers.set("content-length", String(length));
    return new Response(obj.body, { status: 206, headers });
  }

  headers.set("content-length", String(obj.size));
  return new Response(obj.body, { headers });
}
