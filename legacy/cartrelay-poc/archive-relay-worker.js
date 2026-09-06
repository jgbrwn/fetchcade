/**
 * CartRelay Archive relay — Cloudflare Worker
 *
 * Purpose:
 *   Work around Internet Archive download redirects whose final storage node
 *   may omit CORS headers. This Worker stores nothing: it follows Archive-only
 *   redirects and streams the response with Cache-Control: no-store.
 *
 * Route:
 *   GET /fetch?url=https%3A%2F%2Farchive.org%2Fdownload%2F...
 */

function allowedArchiveHost(hostname) {
  const h = hostname.toLowerCase();
  return h === "archive.org" || h.endsWith(".archive.org");
}

function corsHeaders(headers = new Headers()) {
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET,HEAD,OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Range,Content-Type");
  headers.set("Access-Control-Expose-Headers", "Content-Length,Content-Range,Accept-Ranges,Content-Type");
  headers.set("Cross-Origin-Resource-Policy", "cross-origin");
  headers.set("Cache-Control", "no-store, max-age=0");
  return headers;
}

async function fetchFollowingArchiveRedirects(target, request) {
  let current = new URL(target);
  for (let i = 0; i < 6; i++) {
    if (current.protocol !== "https:" || !allowedArchiveHost(current.hostname)) {
      throw new Error("Archive-only relay: redirect target rejected");
    }

    const upstreamHeaders = new Headers();
    const range = request.headers.get("Range");
    if (range) upstreamHeaders.set("Range", range);
    upstreamHeaders.set("Accept-Encoding", "identity");

    const res = await fetch(current.toString(), {
      method: request.method === "HEAD" ? "HEAD" : "GET",
      headers: upstreamHeaders,
      redirect: "manual",
      cf: { cacheEverything: false, cacheTtl: 0 }
    });

    if ([301,302,303,307,308].includes(res.status)) {
      const loc = res.headers.get("Location");
      if (!loc) return res;
      current = new URL(loc, current);
      continue;
    }
    return res;
  }
  throw new Error("Too many Archive redirects");
}

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }
    if (!["GET","HEAD"].includes(request.method)) {
      return new Response("Method not allowed", { status: 405, headers: corsHeaders() });
    }

    const u = new URL(request.url);
    if (u.pathname !== "/fetch") {
      return new Response(
        "CartRelay Archive relay\n\nUse /fetch?url=https://archive.org/...",
        { status: 200, headers: corsHeaders(new Headers({ "Content-Type":"text/plain; charset=utf-8" })) }
      );
    }

    const raw = u.searchParams.get("url");
    if (!raw) return new Response("Missing url parameter", { status: 400, headers: corsHeaders() });

    let target;
    try { target = new URL(raw); }
    catch { return new Response("Invalid URL", { status: 400, headers: corsHeaders() }); }

    if (target.protocol !== "https:" || !allowedArchiveHost(target.hostname)) {
      return new Response("Only https://archive.org and its subdomains are allowed", {
        status: 403, headers: corsHeaders()
      });
    }

    try {
      const upstream = await fetchFollowingArchiveRedirects(target, request);
      const headers = corsHeaders(new Headers(upstream.headers));
      // Avoid forwarding cookies/security headers that are irrelevant to the streamed file.
      headers.delete("Set-Cookie");
      headers.delete("Content-Security-Policy");
      return new Response(request.method === "HEAD" ? null : upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers
      });
    } catch (e) {
      return new Response(`Relay error: ${e.message || e}`, {
        status: 502,
        headers: corsHeaders(new Headers({ "Content-Type":"text/plain; charset=utf-8" }))
      });
    }
  }
};
