// Consensus World Cell Theater route extends the stable TESSARYN offline contract.
const CACHE = "tessaryn-origin-v0-5-0-world-cell-consensus-1";
const CORE = [
  "./",
  "./keyxym-mobile.html",
  "./personal-weave.html",
  "./world-cell-theater.html",
  "./keyxym/manifest.json",
  "./keyxym/keyxym-v22.mjs",
  "./keyxym/keyxym-v22.wasm",
  "./keyxym/frontend-manifest.json",
  "./keyxym/keyxym-frontend-v1.wasm.b64",
  "./world/archviz-tiny-house-locus.json",
  "./world/vesper-court.json",
  "./validation/portfolio.json",
  "./objects/catalog.json",
  "./weave.json",
  "./manifest.webmanifest",
  "./tessaryn-mark.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(CORE)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)),
  )));
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname === "/mansion" || url.pathname === "/mansion/" || url.pathname === "/mansion.html") {
    event.respondWith(Response.redirect(new URL("./", self.location.href), 302));
    return;
  }

  const networkFirst = event.request.mode === "navigate" ||
    url.pathname.endsWith("/world-cell-theater.html") ||
    url.pathname.includes("/keyxym/") ||
    url.pathname.endsWith("/world/archviz-tiny-house-locus.json") ||
    url.pathname.endsWith("/world/vesper-court.json");
  if (networkFirst) {
    event.respondWith(fetch(event.request, { cache: "no-store" }).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, copy));
      }
      return response;
    }).catch(async () => (await caches.match(event.request)) ||
      (await caches.match("./")) ||
      new Response("TESSARYN Origin is not cached", {
        status: 503,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      })));
    return;
  }

  event.respondWith(caches.match(event.request).then((cached) => {
    const network = fetch(event.request).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, copy));
      }
      return response;
    }).catch(() => cached);
    return cached || network;
  }));
});
