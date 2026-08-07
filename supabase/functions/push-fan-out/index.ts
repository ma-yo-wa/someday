/* =====================================================================
   Someday — push-fan-out
   Supabase Edge Function (Deno).

   Zero dependencies. VAPID signing (RFC 8292) and payload encryption
   (RFC 8291 / aes128gcm per RFC 8188) are done directly against Web
   Crypto — no notification SDK, no vendor sitting between our database
   and the user's push service.

   Invoked by the push triggers in push.sql with:
     { recipient_id, space_id, activity_id?, kind, title, body }

   kind is one of: idea | scheduled | notes | joined | suggested | suggestion_accepted

   Secrets required (supabase secrets set ...):
     VAPID_PUBLIC_KEY    base64url, uncompressed P-256 point (65 bytes)
     VAPID_PRIVATE_KEY   base64url, raw d scalar (32 bytes)
     VAPID_SUBJECT       mailto:you@example.com  (or an https:// URL)
     SUPABASE_URL                (injected automatically)
     SUPABASE_SERVICE_ROLE_KEY   (injected automatically)
   ===================================================================== */

const VAPID_PUBLIC  = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY")!;
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:hello@example.com";
const SB_URL        = Deno.env.get("SUPABASE_URL")!;
const SB_KEY        = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

/* The trigger's bearer has to satisfy two checks with one value: the
   platform gateway, which only accepts a JWT, and the caller check below.
   On projects issuing sb_secret_… keys those two can't be the same string,
   so the trigger's key is configured separately. */
const CALLER_KEYS = new Set(
  [SB_KEY, Deno.env.get("PUSH_HOOK_KEY")].filter(Boolean) as string[],
);

/* ------------------------------------------------------------------ */
/* base64url helpers                                                   */
/* ------------------------------------------------------------------ */
function b64uToBytes(s: string): Uint8Array {
  const pad = s.length % 4 ? "=".repeat(4 - (s.length % 4)) : "";
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function bytesToB64u(b: Uint8Array): string {
  let s = "";
  for (const byte of b) s += String.fromCharCode(byte);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function concat(...parts: Uint8Array[]): Uint8Array {
  const len = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
const utf8 = (s: string) => new TextEncoder().encode(s);

/* ------------------------------------------------------------------ */
/* VAPID — an ES256 JWT proving we own the key the client subscribed to */
/* ------------------------------------------------------------------ */
async function importVapidKey(): Promise<CryptoKey> {
  // Web Crypto wants a JWK. The private key is the raw d scalar; x and y
  // come out of the uncompressed public point (0x04 || x[32] || y[32]).
  const pub = b64uToBytes(VAPID_PUBLIC);
  if (pub.length !== 65 || pub[0] !== 0x04) {
    throw new Error("VAPID_PUBLIC_KEY must be a 65-byte uncompressed P-256 point");
  }
  const jwk: JsonWebKey = {
    kty: "EC",
    crv: "P-256",
    x: bytesToB64u(pub.slice(1, 33)),
    y: bytesToB64u(pub.slice(33, 65)),
    d: VAPID_PRIVATE,
    ext: true,
  };
  return crypto.subtle.importKey(
    "jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"],
  );
}

async function vapidHeader(endpoint: string): Promise<string> {
  const aud = new URL(endpoint).origin;
  const header  = { typ: "JWT", alg: "ES256" };
  const payload = {
    aud,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60, // spec caps this at 24h
    sub: VAPID_SUBJECT,
  };
  const signingInput =
    bytesToB64u(utf8(JSON.stringify(header))) + "." +
    bytesToB64u(utf8(JSON.stringify(payload)));

  const key = await importVapidKey();
  const sig = new Uint8Array(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" }, key, utf8(signingInput),
    ),
  );
  // Web Crypto already returns the raw r||s form that JWS wants.
  const jwt = `${signingInput}.${bytesToB64u(sig)}`;
  return `vapid t=${jwt}, k=${VAPID_PUBLIC}`;
}

/* ------------------------------------------------------------------ */
/* RFC 8291 payload encryption (aes128gcm)                             */
/* ------------------------------------------------------------------ */
async function hkdf(
  salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt, info }, key, length * 8,
  );
  return new Uint8Array(bits);
}

async function encryptPayload(
  plaintext: string, uaPublicB64: string, authSecretB64: string,
): Promise<Uint8Array> {
  const uaPublic   = b64uToBytes(uaPublicB64);    // 65 bytes
  const authSecret = b64uToBytes(authSecretB64);  // 16 bytes

  // Ephemeral application-server keypair, fresh for every message.
  const asKeys = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"],
  ) as CryptoKeyPair;
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", asKeys.publicKey));

  const uaKey = await crypto.subtle.importKey(
    "raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, [],
  );
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, asKeys.privateKey, 256),
  );

  // PRK = HKDF(salt=auth_secret, ikm=ecdh, info="WebPush: info\0"|ua_pub|as_pub)
  const prkInfo = concat(utf8("WebPush: info\0"), uaPublic, asPublic);
  const prk = await hkdf(authSecret, ecdhSecret, prkInfo, 32);

  const salt  = crypto.getRandomValues(new Uint8Array(16));
  const cek   = await hkdf(salt, prk, utf8("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, prk, utf8("Content-Encoding: nonce\0"), 12);

  // Single record: plaintext followed by the 0x02 last-record delimiter.
  const padded = concat(utf8(plaintext), new Uint8Array([0x02]));
  const aesKey = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, tagLength: 128 }, aesKey, padded),
  );

  // aes128gcm header: salt(16) | rs(4, big-endian) | idlen(1) | keyid(65)
  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096, false);
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, ct);
}

/* ------------------------------------------------------------------ */
/* One device                                                          */
/* ------------------------------------------------------------------ */
type Sub = { endpoint: string; p256dh: string; auth: string };

async function sendTo(sub: Sub, payload: unknown): Promise<"ok" | "gone" | "failed"> {
  const body = await encryptPayload(JSON.stringify(payload), sub.p256dh, sub.auth);
  const auth = await vapidHeader(sub.endpoint);

  const res = await fetch(sub.endpoint, {
    method: "POST",
    headers: {
      "Authorization": auth,
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      "TTL": "86400",
      "Urgency": "normal",
    },
    body,
  });

  if (res.status === 404 || res.status === 410) return "gone"; // unsubscribed / expired
  if (!res.ok) {
    console.error("push failed", res.status, await res.text().catch(() => ""));
    return "failed";
  }
  return "ok";
}

/* ------------------------------------------------------------------ */
/* PostgREST helpers (service role — bypasses RLS by design)           */
/* ------------------------------------------------------------------ */
const sbHeaders = {
  "apikey": SB_KEY,
  "Authorization": `Bearer ${SB_KEY}`,
  "Content-Type": "application/json",
};

async function loadSubs(userId: string, spaceId: string): Promise<Sub[]> {
  const url = `${SB_URL}/rest/v1/push_subscriptions` +
    `?select=endpoint,p256dh,auth&user_id=eq.${userId}&space_id=eq.${spaceId}`;
  const r = await fetch(url, { headers: sbHeaders });
  if (!r.ok) { console.error("loadSubs", await r.text()); return []; }
  return await r.json();
}

async function pruneSub(endpoint: string): Promise<void> {
  await fetch(`${SB_URL}/rest/v1/rpc/prune_subscription`, {
    method: "POST",
    headers: sbHeaders,
    body: JSON.stringify({ dead_endpoint: endpoint }),
  });
}

/* ------------------------------------------------------------------ */
/* Entrypoint                                                          */
/* ------------------------------------------------------------------ */
Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  // Only the database trigger may invoke this — the anon key is public.
  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!CALLER_KEYS.has(bearer)) {
    return new Response("Forbidden", { status: 403 });
  }

  let job: {
    recipient_id: string;
    space_id: string;
    activity_id?: string | null;
    kind: string;
    title: string;
    body: string;
  };
  try {
    job = await req.json();
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }

  if (!job.recipient_id || !job.space_id || !job.title) {
    return new Response("Missing fields", { status: 400 });
  }

  const subs = await loadSubs(job.recipient_id, job.space_id);
  if (!subs.length) {
    return Response.json({ sent: 0, reason: "no registered devices" });
  }

  const activityId = job.activity_id ?? null;
  const payload = {
    title: job.title,
    body: job.body,
    // Collapse repeats: one activity, or one "joined" per space.
    tag: activityId ? `activity-${activityId}` : `space-${job.kind}-${job.space_id}`,
    kind: job.kind,
    activityId,
    url: activityId ? `/?a=${activityId}` : "/",
  };

  const results = await Promise.all(subs.map(async (s) => {
    try {
      const outcome = await sendTo(s, payload);
      if (outcome === "gone") await pruneSub(s.endpoint);
      return outcome;
    } catch (err) {
      console.error("send error", err);
      return "failed" as const;
    }
  }));

  return Response.json({
    sent:   results.filter((r) => r === "ok").length,
    pruned: results.filter((r) => r === "gone").length,
    failed: results.filter((r) => r === "failed").length,
  });
});
