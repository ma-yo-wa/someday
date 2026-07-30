#!/usr/bin/env node
/* =====================================================================
   Generate a VAPID key pair for Someday.

     node vapid-keygen.mjs

   Uses Web Crypto only — no `web-push` install, no OpenSSL invocation.
   Node 18+.

   The public key is a 65-byte uncompressed P-256 point (0x04 || x || y),
   base64url encoded. That exact string goes in three places: the app's
   VAPID_PUBLIC config field, the VAPID_PUBLIC_KEY secret, and the
   `applicationServerKey` the browser subscribes with. If they ever
   disagree, the push service rejects every send with a 403.
   ===================================================================== */

const subtle = globalThis.crypto.subtle;

const bytesToB64u = (b) => {
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const pair = await subtle.generateKey(
  { name: "ECDSA", namedCurve: "P-256" },
  true,
  ["sign", "verify"],
);

const rawPublic = new Uint8Array(await subtle.exportKey("raw", pair.publicKey));
const jwkPrivate = await subtle.exportKey("jwk", pair.privateKey);

const publicKey = bytesToB64u(rawPublic);
const privateKey = jwkPrivate.d;

console.log(`
  VAPID key pair
  ─────────────────────────────────────────────────────────────

  Public   ${publicKey}
  Private  ${privateKey}

  ─────────────────────────────────────────────────────────────
  1. Set the server secrets:

     supabase secrets set \\
       VAPID_PUBLIC_KEY="${publicKey}" \\
       VAPID_PRIVATE_KEY="${privateKey}" \\
       VAPID_SUBJECT="mailto:you@example.com"

  2. Paste the PUBLIC key (only) into the app:
     Settings → Notifications → VAPID public key

  The private key never leaves your server. Anyone holding it can send
  notifications that appear to come from you.
`);
