self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

// Nogle Chrome-versioner bliver mere “sikre” på installbarhed når fetch findes
self.addEventListener("fetch", () => {});
