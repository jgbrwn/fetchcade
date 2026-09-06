const MAX_TARGET_LENGTH = 2_048;
const MAX_REDIRECTS = 6;
const ARCHIVE_HOST = /(^|\.)archive\.org$/i;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function isArchiveHost(hostname) {
  return ARCHIVE_HOST.test(hostname);
}

function hasSafeOrigin(url) {
  return url.protocol === "https:" && isArchiveHost(url.hostname) && !url.username && !url.password && !url.port;
}

function decodeSegment(segment) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

function hasSafeArchivePath(url, initial) {
  const raw = url.pathname.split("/");
  if (raw[0] === "") raw.shift();
  while (raw.at(-1) === "") raw.pop();
  const route = raw.shift();
  if (!route || raw.some((part) => !part)) return false;

  // Only these initial endpoints are useful to Fetchcade. Redirect hops are
  // allowed to have storage-specific paths, but remain archive.org hosts.
  if (initial && route !== "download" && route !== "metadata") return false;
  if (initial && route === "metadata" && raw.length !== 1) return false;
  if (initial && route === "download" && raw.length < 2) return false;

  const decodedParts = raw.map(decodeSegment);
  if (decodedParts.some((part) => !part)) return false;
  if (initial && route === "download" && decodedParts[0].includes("/")) return false;
  if (initial && route === "metadata" && decodedParts[0].includes("/")) return false;

  return decodedParts.join("/").split("/").every((part) => part && part !== "." && part !== ".." && !part.includes("\0"));
}

function corsHeaders(source = new Headers()) {
  const headers = new Headers();
  for (const name of ["Accept-Ranges", "Content-Length", "Content-Range", "Content-Type", "ETag", "Last-Modified"]) {
    const value = source.get(name);
    if (value) headers.set(name, value);
  }
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET,HEAD,OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Range,Content-Type");
  headers.set("Access-Control-Expose-Headers", "Accept-Ranges,Content-Length,Content-Range,Content-Type,ETag,Last-Modified");
  headers.set("Cross-Origin-Resource-Policy", "cross-origin");
  headers.set("Cache-Control", "no-store, max-age=0");
  headers.set("X-Content-Type-Options", "nosniff");
  return headers;
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: corsHeaders(new Headers({ "Content-Type": "application/json; charset=utf-8" })),
  });
}

function validRange(value) {
  return !value || /^bytes=\d+(?:-\d*)?$/.test(value);
}

async function fetchArchive(target, request) {
  let current = new URL(target);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    if (!hasSafeOrigin(current)) throw new Error("Archive redirect target rejected.");

    const upstreamHeaders = new Headers();
    const range = request.headers.get("Range");
    if (range) upstreamHeaders.set("Range", range);
    upstreamHeaders.set("Accept-Encoding", "identity");

    const response = await fetch(current, {
      method: request.method,
      headers: upstreamHeaders,
      redirect: "manual",
      cache: "no-store",
    });

    if (!REDIRECT_STATUSES.has(response.status)) return response;
    const location = response.headers.get("Location");
    if (!location) return response;
    if (hop === MAX_REDIRECTS) throw new Error("Too many Archive redirects.");
    current = new URL(location, current);
  }
  throw new Error("Too many Archive redirects.");
}

async function relay(request) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders() });
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders() });
  }

  const requestUrl = new URL(request.url);
  const rawTarget = requestUrl.searchParams.get("url");
  if (!rawTarget) return new Response("Missing url parameter", { status: 400, headers: corsHeaders() });
  if (rawTarget.length > MAX_TARGET_LENGTH) return new Response("URL is too long", { status: 413, headers: corsHeaders() });

  let target;
  try {
    target = new URL(rawTarget);
  } catch {
    return new Response("Invalid URL", { status: 400, headers: corsHeaders() });
  }
  if (!hasSafeOrigin(target) || !hasSafeArchivePath(target, true)) {
    return new Response("Only valid https://archive.org download or metadata URLs are allowed", {
      status: 403,
      headers: corsHeaders(),
    });
  }

  const range = request.headers.get("Range");
  if (!validRange(range)) return new Response("Only a single byte range is allowed", { status: 416, headers: corsHeaders() });

  try {
    const upstream = await fetchArchive(target, request);
    return new Response(request.method === "HEAD" ? null : upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: corsHeaders(upstream.headers),
    });
  } catch (error) {
    return new Response(`Relay error: ${error?.message || error}`, {
      status: 502,
      headers: corsHeaders(new Headers({ "Content-Type": "text/plain; charset=utf-8" })),
    });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/fetch") return relay(request);
    if (url.pathname === "/health") return jsonResponse({ ok: true, app: "fetchcade", relay: true });
    return env.ASSETS.fetch(request);
  },
};
