const CACHE_NAME = "sunwave-tracker-v306";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css?v=253",
  "./config.js",
  "./jsQR.js",
  "./app.js?v=255",
  "./manifest.webmanifest",
  "./icon.svg",
  "./sunwave-shop/",
  "./sunwave-shop/index.html",
  "./sunwave-shop/styles.css?v=274",
  "./sunwave-shop/app.js?v=290",
  "./sunwave-shop/manifest.webmanifest"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.url.includes("/api/")) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => {
        if (event.request.mode === "navigate") {
          const requestUrl = new URL(event.request.url);
          if (requestUrl.pathname.startsWith("/sunwave-shop/")) {
            return caches.match("./sunwave-shop/index.html");
          }
          return caches.match("./index.html");
        }
        return caches.match(event.request);
      })
  );
});
