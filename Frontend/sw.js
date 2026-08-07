const NEXORA_CACHE_VERSION = "nexora-project-game-v33";
const STATIC_CACHE = `${NEXORA_CACHE_VERSION}:static`;
const PAGE_CACHE = `${NEXORA_CACHE_VERSION}:pages`;

const STATIC_ASSETS = [
  "/",
  "/offline.html",
  "/manifest.webmanifest",
  "/Css/styles.css?v=20260804-worklog-range",
  "/Js/config.js?v=20260723-user-classes",
  "/Js/app.js?v=20260808-monthly-report",
  "/Js/dino-game.js?v=20260728-arcade-layout",
  "/Js/project-game.js?v=20260808-project-game-v8",
  "/Js/reset-password.js?v=20260723-user-classes",
  "/icons/icon-72.png?v=20260723-user-classes",
  "/icons/icon-96.png?v=20260723-user-classes",
  "/icons/icon-144.png?v=20260723-user-classes",
  "/icons/icon-192.png?v=20260723-user-classes",
  "/icons/icon-384.png?v=20260723-user-classes",
  "/icons/icon-512.png?v=20260723-user-classes",
  "/icons/apple-touch-icon.png?v=20260723-user-classes"
];

const PAGE_ASSETS = [
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/post-login",
  "/projects",
  "/tasks",
  "/notifications",
  "/batches",
  "/dino-game",
  "/project-game",
  "/create-project",
  "/edit-project",
  "/create-task",
  "/project",
  "/task",
  "/signed-out"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    Promise.all([
      caches.open(STATIC_CACHE).then((cache) => cache.addAll(STATIC_ASSETS)),
      caches.open(PAGE_CACHE).then((cache) => cache.addAll(PAGE_ASSETS))
    ]).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames
            .filter((cacheName) => !cacheName.startsWith(NEXORA_CACHE_VERSION))
            .map((cacheName) => caches.delete(cacheName))
        )
      )
      .then(() => self.clients.claim())
  );
});

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(PAGE_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch (_error) {
    return (await caches.match(request)) || caches.match("/offline.html");
  }
}

async function staleWhileRevalidate(request) {
  const cachedResponse = await caches.match(request);
  const fetchPromise = fetch(request)
    .then((response) => {
      if (response.ok) {
        caches.open(STATIC_CACHE).then((cache) => cache.put(request, response.clone()));
      }
      return response;
    })
    .catch(() => cachedResponse);

  return cachedResponse || fetchPromise;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== "GET" || url.origin !== self.location.origin) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request));
    return;
  }

  if (
    url.pathname.startsWith("/Css/") ||
    url.pathname.startsWith("/Js/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname === "/manifest.webmanifest"
  ) {
    event.respondWith(staleWhileRevalidate(request));
  }
});

function getNotificationPayload(event) {
  if (!event.data) {
    return {};
  }

  try {
    return event.data.json();
  } catch (_error) {
    return {
      title: "Nexora update",
      body: event.data.text(),
      target_url: "/notifications"
    };
  }
}

function buildNotificationTarget(targetUrl, notificationId) {
  const url = new URL(targetUrl || "/notifications", self.location.origin);
  if (notificationId) {
    url.searchParams.set("notificationId", notificationId);
  }
  return url.href;
}

self.addEventListener("push", (event) => {
  const payload = getNotificationPayload(event);
  const title = payload.title || "Nexora update";
  const options = {
    body: payload.body || "Open Nexora for details.",
    icon: payload.icon || "/icons/icon-192.png?v=20260723-user-classes",
    badge: payload.badge || "/icons/icon-192.png?v=20260723-user-classes",
    tag: payload.tag,
    data: {
      notificationId: payload.notification_id,
      targetUrl: payload.target_url || "/notifications"
    }
  };

  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, options),
      self.clients
        .matchAll({ type: "window", includeUncontrolled: true })
        .then((clientList) => {
          clientList.forEach((client) => {
            client.postMessage({
              type: "NEXORA_NOTIFICATION_RECEIVED",
              notificationId: payload.notification_id
            });
          });
        })
    ])
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetUrl = buildNotificationTarget(
    event.notification.data?.targetUrl,
    event.notification.data?.notificationId
  );

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if ("focus" in client && "navigate" in client) {
            return client.navigate(targetUrl).then((focusedClient) => {
              if (focusedClient && "focus" in focusedClient) {
                return focusedClient.focus();
              }
              return client.focus();
            });
          }
        }

        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }
        return undefined;
      })
  );
});
