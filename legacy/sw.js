/* =====================================================================
   Our Space — service worker
   Deliberately small. This file exists to do three things:
     1. stay alive and current without ceremony
     2. unpack a W3C Web Push payload and show it
     3. put the user on the right screen when they tap the banner
   No caching layer, no framework, no notification SDK.
   ===================================================================== */

const SW_VERSION = "ourspace-sw-v1";

/* ---------------------------------------------------------------------
   Lifecycle — self-healing.
   skipWaiting + clients.claim means a new sw.js takes over on the next
   page load instead of waiting for every tab to close. Without this a
   stale worker can sit there swallowing pushes after a deploy.
   --------------------------------------------------------------------- */
self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

/* ---------------------------------------------------------------------
   PUSH
   Payload contract (sent by the edge function):
     { title, body, tag, url, activityId, kind }
   Everything is defensive: a push with no payload, or with a payload
   that isn't JSON, must still surface *something*. A push event that
   resolves without calling showNotification gets the origin's push
   permission revoked by some browsers, so there is always a fallback.
   --------------------------------------------------------------------- */
self.addEventListener("push", (event) => {
  let data = {};

  if (event.data) {
    try {
      data = event.data.json();
    } catch (err) {
      data = { body: event.data.text() };
    }
  }

  const title = data.title || "Our Space";
  const options = {
    body: data.body || "Something changed in your space.",
    icon: data.icon || "./icon-192.png",
    badge: data.badge || "./badge-96.png",
    // Same tag + renotify: a second update about the same activity
    // replaces the first banner instead of stacking a pile of them.
    tag: data.tag || "ourspace",
    renotify: true,
    timestamp: Date.now(),
    data: {
      url: data.url || "./",
      activityId: data.activityId || null,
      kind: data.kind || null
    },
    actions: data.activityId
      ? [{ action: "open", title: "Open" }]
      : []
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

/* ---------------------------------------------------------------------
   NOTIFICATION CLICK
   Focus an existing tab if we already have one, rather than spawning a
   duplicate. Deep-link to the activity when we know which one it was.
   --------------------------------------------------------------------- */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const target = new URL(
    event.notification.data && event.notification.data.url
      ? event.notification.data.url
      : "./",
    self.location.origin
  ).href;

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if ("focus" in client) {
            // Hand the open tab the activity id so it can pop the sheet.
            client.postMessage({
              type: "notification-click",
              activityId: event.notification.data?.activityId || null
            });
            return client.focus();
          }
        }
        if (self.clients.openWindow) return self.clients.openWindow(target);
      })
  );
});

/* ---------------------------------------------------------------------
   SUBSCRIPTION CHANGE — the self-healing bit that actually matters.
   Push services rotate endpoints. When that happens the browser fires
   this event instead of telling the user, and if nobody re-subscribes
   the device silently stops receiving anything. We resubscribe with the
   same VAPID key and tell the page to persist the new endpoint.
   --------------------------------------------------------------------- */
self.addEventListener("pushsubscriptionchange", (event) => {
  const oldSub = event.oldSubscription;
  const appServerKey =
    (event.oldSubscription && event.oldSubscription.options
      ? event.oldSubscription.options.applicationServerKey
      : null) ||
    (event.newSubscription && event.newSubscription.options
      ? event.newSubscription.options.applicationServerKey
      : null);

  event.waitUntil(
    (async () => {
      let fresh = event.newSubscription;

      if (!fresh && appServerKey) {
        fresh = await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: appServerKey
        });
      }
      if (!fresh) return;

      // Any open tab persists it. If none are open, the next page load
      // re-subscribes anyway during syncSubscription().
      const clientList = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true
      });
      for (const client of clientList) {
        client.postMessage({
          type: "subscription-change",
          oldEndpoint: oldSub ? oldSub.endpoint : null,
          subscription: fresh.toJSON()
        });
      }
    })()
  );
});

/* ---------------------------------------------------------------------
   Lets the page trigger a local banner so the design can be judged
   without standing up VAPID keys and an edge function first.
   --------------------------------------------------------------------- */
self.addEventListener("message", (event) => {
  const msg = event.data || {};
  if (msg.type === "preview-notification") {
    self.registration.showNotification(msg.title || "Our Space", {
      body: msg.body || "This is how a banner will look.",
      icon: "./icon-192.png",
      badge: "./badge-96.png",
      tag: "ourspace-preview",
      renotify: true,
      data: { url: "./" }
    });
  }
});
