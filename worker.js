// Cloudflare Worker: reverse-proxy for /v1/messages -> https://agentrouter.org
//
// Any request to YOUR worker URL at /v1/messages gets forwarded to the
// plain root https://agentrouter.org (no path appended). Whatever
// agentrouter.org replies with (status, headers, body — including
// streamed responses) is sent straight back to whoever called your
// worker, so it looks like the response came from you.

const UPSTREAM_URL = "https://agentrouter.org";

export default {
  async fetch(request) {
    const incoming = new URL(request.url);

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }

    // Only proxy requests that hit /v1/messages on your worker.
    // Extend this if you want more of your own paths routed too.
    const allowedPrefixes = ["/v1/messages"];
    const isAllowed = allowedPrefixes.some((p) => incoming.pathname.startsWith(p));

    if (!isAllowed) {
      return new Response("Not found", { status: 404 });
    }

    // Always hit the plain upstream root — query string (if any) is kept,
    // but your own path is NOT appended to it.
    const upstreamUrl = new URL(UPSTREAM_URL);
    upstreamUrl.search = incoming.search;

    // Copy headers through as-is. If the caller sends their own
    // Authorization/x-api-key header, it passes through to agentrouter.org
    // untouched — this worker does not need to store a secret key.
    const headers = new Headers(request.headers);
    headers.delete("host");
    headers.delete("cf-connecting-ip");
    headers.delete("cf-ray");
    headers.delete("cf-visitor");

    try {
      const upstreamRequest = new Request(upstreamUrl.toString(), {
        method: request.method,
        headers,
        body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
      });

      const upstreamResponse = await fetch(upstreamRequest);

      const responseHeaders = new Headers(upstreamResponse.headers);
      const cors = corsHeaders();
      for (const [k, v] of Object.entries(cors)) responseHeaders.set(k, v);

      return new Response(upstreamResponse.body, {
        status: upstreamResponse.status,
        statusText: upstreamResponse.statusText,
        headers: responseHeaders,
      });
    } catch (err) {
      return new Response(
        JSON.stringify({ error: "Proxy failed", detail: String(err) }),
        {
          status: 502,
          headers: { "content-type": "application/json", ...corsHeaders() },
        }
      );
    }
  },
};

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*", // tighten this to your app's domain in production
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, authorization, x-api-key, anthropic-version",
  };
}
