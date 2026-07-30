/* =====================================================================
   Someday — giphy
   Supabase Edge Function (Deno).

   A thin proxy in front of the Giphy API, for one reason: an API key
   shipped to a browser is not a secret. Anyone can open devtools and
   read it. Putting the key here means it lives in `supabase secrets`
   and never reaches the client.

   Routes (the action is a query param, so one function covers both):
     GET /functions/v1/giphy?action=trending&limit=15
     GET /functions/v1/giphy?action=search&q=kayak&limit=15

   Secret required:
     supabase secrets set GIPHY_API_KEY="..."
   ===================================================================== */

const GIPHY_KEY = Deno.env.get("GIPHY_API_KEY") ?? "";
const RATING    = "pg-13";
const MAX_LIMIT = 25;

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json", ...extra },
  });
}

/* Trim Giphy's very large objects down to what the picker actually
   renders. Less to parse on the client, and nothing extra to leak. */
function slim(items: any[]) {
  return (items ?? []).map((g) => ({
    id: g.id,
    title: g.title ?? "",
    // fixed_height_small keeps the strip light; downsized is the fallback.
    preview:
      g.images?.fixed_height_small?.url ??
      g.images?.preview_gif?.url ??
      g.images?.downsized?.url ??
      g.images?.fixed_height?.url,
    full:
      g.images?.downsized?.url ??
      g.images?.fixed_height?.url ??
      g.images?.original?.url,
    width:  Number(g.images?.fixed_height_small?.width  ?? 0),
    height: Number(g.images?.fixed_height_small?.height ?? 0),
  })).filter((g) => g.preview && g.full);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "GET")     return json({ error: "Method not allowed" }, 405);

  if (!GIPHY_KEY) {
    return json({ error: "not_configured", message: "GIPHY_API_KEY is not set" }, 501);
  }

  const url    = new URL(req.url);
  const action = url.searchParams.get("action") ?? "trending";
  const q      = (url.searchParams.get("q") ?? "").trim();
  const limit  = Math.min(Number(url.searchParams.get("limit") ?? 15) || 15, MAX_LIMIT);

  // An empty search is a trending request wearing the wrong hat.
  const wantsSearch = action === "search" && q.length > 0;

  const upstream = new URL(
    wantsSearch
      ? "https://api.giphy.com/v1/gifs/search"
      : "https://api.giphy.com/v1/gifs/trending",
  );
  upstream.searchParams.set("api_key", GIPHY_KEY);
  upstream.searchParams.set("limit", String(limit));
  upstream.searchParams.set("rating", RATING);
  if (wantsSearch) {
    upstream.searchParams.set("q", q);
    upstream.searchParams.set("lang", "en");
  }

  try {
    // Don't let a slow upstream hold the connection open indefinitely.
    const res = await fetch(upstream, { signal: AbortSignal.timeout(6000) });

    if (res.status === 429) {
      return json(
        { error: "rate_limited", message: "Giphy rate limit reached" },
        429,
        { "Retry-After": res.headers.get("Retry-After") ?? "60" },
      );
    }
    if (!res.ok) {
      console.error("giphy upstream", res.status, await res.text().catch(() => ""));
      return json({ error: "upstream", status: res.status }, 502);
    }

    const body = await res.json();
    return json(
      { source: wantsSearch ? "search" : "trending", items: slim(body.data) },
      200,
      // Trending changes slowly; searches are worth a short cache too.
      { "Cache-Control": wantsSearch ? "public, max-age=300" : "public, max-age=900" },
    );
  } catch (err) {
    const timedOut = err instanceof DOMException && err.name === "TimeoutError";
    console.error("giphy fetch failed", err);
    return json(
      { error: timedOut ? "timeout" : "network", message: "Couldn't reach Giphy" },
      504,
    );
  }
});
