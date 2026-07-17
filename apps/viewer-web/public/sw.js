// Stable TESSARYN offline contract. The live World Cell instrument is deliberately
// excluded: its HTML and executable graph must arrive as one network release.
const CACHE = "tessaryn-origin-v0-5-4-world-cell-v26-exact-r10";
const CORE = [
  "./",
  "./keyxym-mobile.html",
  "./personal-weave.html",
  "./release.json",
  "./world/archviz-tiny-house-locus.json",
  "./world/vesper-court.json",
  "./validation/portfolio.json",
  "./objects/catalog.json",
  "./weave.json",
  "./manifest.webmanifest",
  "./tessaryn-mark.svg",
  "./keyxym-v26/manifest.json",
  "./keyxym-v26/keyxym-v26.mjs",
  "./keyxym-v26/keyxym-v26.wasm",
  "./assurance/manifest.json",
  "./assurance/tessaryn-browser-assurance-v1.wasm",
];
const AUTHORITY_PREFIXES = ["./keyxym-v26/", "./assurance/"]
  .map((path) => new URL(path, self.registration.scope).pathname);
const RELEASE_ATTESTATION_PATH = new URL("./release.json", self.registration.scope).pathname;
const WORLD_CELL_PATH = new URL("./world-cell-theater.html", self.registration.scope).pathname;
const CANONICAL_WORLD_CELL_PATH =
  new URL("./world-cell-theater/", self.registration.scope).pathname;

function isAuthorityRequest(url) {
  return AUTHORITY_PREFIXES.some((prefix) => url.pathname.startsWith(prefix));
}

function isImmutableAuthorityRequest(url) {
  return isAuthorityRequest(url) && url.searchParams.has("source") &&
    (url.searchParams.has("sha256") || url.searchParams.has("contract"));
}

async function populateReleaseCache() {
  await caches.delete(CACHE);
  const cache = await caches.open(CACHE);
  try {
    for (const path of CORE) {
      const request = new Request(path, { cache: "reload", credentials: "same-origin" });
      const response = await fetch(request);
      if (!response.ok) throw new Error(`TESSARYN release asset unavailable: ${path} (${response.status})`);
      await cache.put(request, response);
    }
  } catch (error) {
    await caches.delete(CACHE);
    throw error;
  }
}

async function networkFirst(request, fallbackPath = null) {
  try {
    const response = await fetch(new Request(request, { cache: "no-store" }));
    if (response.ok) {
      const cache = await caches.open(CACHE);
      await cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await caches.match(request);
    if (cached) return cached;
    if (fallbackPath) {
      const fallback = await caches.match(fallbackPath);
      if (fallback) return fallback;
    }
    return new Response("TESSARYN Origin is not cached", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}

async function immutableAuthority(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(new Request(request, { cache: "no-store" }));
    if (response.ok) {
      const cache = await caches.open(CACHE);
      await cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    return new Response("TESSARYN immutable authority artifact is unavailable", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    await populateReleaseCache();
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  // Never serve the World Cell instrument from CacheStorage. A cached HTML shell
  // paired with chunks from another deployment caused intermittent VERIFYING and
  // RETRY AUTHORITY states on Safari. Network failure must be visible, not masked
  // by a different release.
  if (url.pathname === WORLD_CELL_PATH || url.pathname === CANONICAL_WORLD_CELL_PATH) {
    event.respondWith(fetch(new Request(event.request, { cache: "no-store" })));
    return;
  }

  if (url.pathname === "/mansion" || url.pathname === "/mansion/" || url.pathname === "/mansion.html") {
    event.respondWith(Response.redirect(new URL("./", self.location.href), 302));
    return;
  }
  if (isImmutableAuthorityRequest(url)) {
    event.respondWith(immutableAuthority(event.request));
    return;
  }
  if (isAuthorityRequest(url) || url.pathname === RELEASE_ATTESTATION_PATH) {
    event.respondWith(networkFirst(event.request));
    return;
  }
  if (event.request.mode === "navigate" ||
      event.request.destination === "script" ||
      event.request.destination === "style" ||
      event.request.destination === "worker" ||
      url.pathname.endsWith("/world/archviz-tiny-house-locus.json") ||
      url.pathname.endsWith("/world/vesper-court.json")) {
    event.respondWith(networkFirst(event.request, event.request.mode === "navigate" ? "./" : null));
    return;
  }

  const network = fetch(event.request).then(async (response) => {
    if (response.ok) {
      const cache = await caches.open(CACHE);
      await cache.put(event.request, response.clone());
    }
    return response;
  });
  event.waitUntil(network.then(() => undefined).catch(() => undefined));
  event.respondWith(caches.match(event.request).then((cached) => cached || network));
});
