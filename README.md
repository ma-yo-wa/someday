# Someday

A private shared planning app for exactly two people. Install it as a PWA on
your phones. One space, two equal partners, and one question: *does this have
a date yet?*

| | |
|---|---|
| **Plan** | Has a date (and optional end date). Lives on the calendar. |
| **Bucket List** | No date yet. Lives on the board until you put it on the calendar. |

Imported Google Calendar events stay read-only overlays — they never become
plans. Create always asks which of the two you’re making; nothing is inferred.

---

## Stack

| Layer | What |
|---|---|
| Frontend | React + Vite + TypeScript, installable PWA |
| Backend | Supabase (Auth OTP, Postgres, Realtime, Edge Functions) |
| Hosting | Cloudflare Pages (free) + Supabase free tier |

The old single-file `legacy/index.html` is kept for reference only. The app
you run and deploy is under `src/`.

---

## Run locally

```bash
npm install
npm run dev
```

Open the URL Vite prints (usually `http://localhost:5173`). With no Supabase
credentials it runs in **local demo mode** — seeded data, synced across tabs
via `BroadcastChannel`.

```bash
npm run build    # production build → dist/
npm run preview  # serve dist locally
```

Optional: copy `.env.example` → `.env` and fill `VITE_SUPABASE_URL` /
`VITE_SUPABASE_ANON_KEY` so local matches production.

---

## Deploy (free) — do this next

Two free services: **Supabase** for the backend, **Cloudflare Pages** for the
frontend. Get the frontend live first even if Auth isn’t fully wired — the
demo mode still works for you both to poke at the UI.

### 1. Backend (Supabase)

1. Create a project at [supabase.com](https://supabase.com) (free tier).
2. SQL editor → run, in order:
   - `schema.sql`
   - `migrations/001_spans_and_invites.sql`
   - `push.sql` (only when you’re ready for notifications)
3. **Authentication → Providers → Email**
   - Enable Email
   - Prefer **OTP / magic code** (six-digit). Turn off “Confirm email” link-only
     flows if you want the in-app code path only.
4. Copy **Project URL** and the **anon public** key  
   (Settings → API).

Spaces are created automatically on signup (`handle_new_user`). Partner 2
joins with an invite link or code from the empty seat in the nav bar.

### 2. Frontend (Cloudflare Pages)

1. Put this repo on GitHub as **`someday`** (private is fine).
2. [Cloudflare Dashboard](https://dash.cloudflare.com) → **Workers & Pages** →
   **Create** → **Pages** → **Connect to Git** → pick the repo.
3. Build settings:

   | Setting | Value |
   |---|---|
   | Framework preset | Vite |
   | Build command | `npm run build` |
   | Deploy command | `npx wrangler deploy` *(default — leave it)* |
   | Root directory | `/` (repo root) |

   `wrangler.toml` tells Wrangler to upload `dist` as a static SPA (no Worker
   script). You do **not** leave Deploy command blank in the current dashboard.

4. **Settings → Environment variables** (Production):

   | Name | Value |
   |---|---|
   | `VITE_SUPABASE_URL` | your project URL |
   | `VITE_SUPABASE_ANON_KEY` | your anon public key |

5. Deploy. You’ll get a `*.pages.dev` URL (e.g. `someday.pages.dev`).

6. Back in Supabase → **Authentication → URL configuration**:
   - Site URL = your Pages URL
   - Redirect URLs = that URL and `http://localhost:5173/**` for local

### 3. Install on iPhone

Safari → open the Pages URL → Share → **Add to Home Screen**.  
Push notifications only work from the installed icon (iOS 16.4+).

---

## What comes after deploy

Do these when the basic app is live and you both have accounts — not before.

| Feature | What’s needed |
|---|---|
| Giphy covers | `supabase secrets set GIPHY_API_KEY=…` then `supabase functions deploy giphy` |
| Web Push | `node vapid-keygen.mjs`, secrets + `push-fan-out` function, fill `private.app_config` in `push.sql` comments, paste public key in Settings (or `VITE_VAPID_PUBLIC_KEY`) |
| Google Calendar | Google Cloud OAuth client (Web), add Pages origin, paste client ID / set `VITE_GOOGLE_CLIENT_ID` |

---

## Project layout

```
src/                 React app (screens, components, store, backends)
public/              Icons, splash screens
supabase/functions/  giphy, push-fan-out
schema.sql           Core tables, RLS, realtime
migrations/          Spans, invite peek/join heal, policy fixes
push.sql             Push subscriptions + fan-out trigger
legacy/              Previous single-file app (reference only)
wrangler.toml        Cloudflare static-asset deploy (dist → SPA)
```

---

## Data model (short)

```
profiles       id · display_name · color
spaces         id · name · partner_1_id · partner_2_id · invite_code
activities     id · space_id · title · description · image_url
               created_by · date_time · ends_at · all_day
audit_logs     id · activity_id · space_id · user_id · action_type · details
```

`date_time` null ⇒ bucket-list item. Set ⇒ plan. `ends_at` is for multi-day
plans. History is written by database triggers, not the client.

The anon key is safe here: RLS is on for every table, and policies only allow
rows for a space where `auth.uid()` is one of the two partners.
