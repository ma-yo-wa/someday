/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';

declare const self: ServiceWorkerGlobalScope & typeof globalThis;

/* =====================================================================
   Someday — service worker

   Three jobs, and deliberately nothing else:
     1. stay current without ceremony
     2. unpack a W3C Web Push payload and show it
     3. put the user on the right screen when they tap the banner

   The old hand-written worker had no caching at all, on the grounds that
   a half-done invalidation strategy is worse than none. That reasoning
   was right then and is obsolete now: Vite emits content-hashed
   filenames, so a precache entry can never go stale — a changed file is
   a different URL. Offline launch is free, which matters for something
   that lives on a home screen.
   ===================================================================== */

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

/* skipWaiting + claim so a new worker takes over on the next load rather
   than waiting for every tab to close. A stale worker sitting there
   swallowing pushes is a silent failure nobody notices for weeks. */
self.addEventListener('install', () => {
  void self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

interface PushPayload {
  title?: string;
  body?: string;
  tag?: string;
  url?: string;
  activityId?: string | null;
  kind?: string | null;
  icon?: string;
  badge?: string;
}

/* Everything here is defensive: a push with no payload, or one that
   isn't JSON, must still surface something. A push event that resolves
   without calling showNotification gets the origin's push permission
   revoked by some browsers, so there is always a fallback. */
self.addEventListener('push', (event) => {
  let data: PushPayload = {};
  if (event.data) {
    try {
      data = event.data.json() as PushPayload;
    } catch {
      data = { body: event.data.text() };
    }
  }

  const title = data.title || 'Someday';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || 'Something changed in your space.',
      icon: data.icon || '/icon-192.png',
      badge: data.badge || '/badge-96.png',
      // Same tag: a second update about the same activity replaces the
      // first banner instead of stacking a pile of them.
      tag: data.tag || 'someday',
      data: {
        url: data.url || '/',
        activityId: data.activityId ?? null,
        kind: data.kind ?? null,
      },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const info = (event.notification.data ?? {}) as { url?: string; activityId?: string | null };
  const target = new URL(info.url || '/', self.location.origin).href;

  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });
      for (const client of clientList) {
        if ('focus' in client) {
          // Hand the open tab the activity id so it can pop the sheet.
          client.postMessage({
            type: 'notification-click',
            activityId: info.activityId ?? null,
          });
          return client.focus();
        }
      }
      await self.clients.openWindow(target);
    })(),
  );
});

/* Push services rotate endpoints without telling anyone. When that
   happens the browser fires this instead, and if nobody re-subscribes
   the device silently stops receiving anything. */
self.addEventListener('pushsubscriptionchange', (event) => {
  const e = event as PushSubscriptionChangeEvent;
  const oldSub = e.oldSubscription ?? null;
  const appServerKey =
    oldSub?.options?.applicationServerKey ?? e.newSubscription?.options?.applicationServerKey ?? null;

  event.waitUntil(
    (async () => {
      let fresh = e.newSubscription ?? null;
      if (!fresh && appServerKey) {
        fresh = await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: appServerKey,
        });
      }
      if (!fresh) return;

      const clientList = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });
      for (const client of clientList) {
        client.postMessage({
          type: 'subscription-change',
          oldEndpoint: oldSub?.endpoint ?? null,
          subscription: fresh.toJSON(),
        });
      }
    })(),
  );
});

/* Lets the page fire a local banner so the copy and icon can be judged
   before VAPID keys and an edge function exist. */
self.addEventListener('message', (event) => {
  const msg = (event.data ?? {}) as { type?: string; title?: string; body?: string };
  if (msg.type === 'preview-notification') {
    void self.registration.showNotification(msg.title || 'Someday', {
      body: msg.body || 'This is how a banner will look.',
      icon: '/icon-192.png',
      badge: '/badge-96.png',
      tag: 'someday-preview',
      data: { url: '/' },
    });
  }
  if (msg.type === 'skip-waiting') void self.skipWaiting();
});

interface PushSubscriptionChangeEvent extends ExtendableEvent {
  readonly oldSubscription: PushSubscription | null;
  readonly newSubscription: PushSubscription | null;
}
