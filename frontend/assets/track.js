// assets/track.js - sidevisnings-logning til de sider, der IKKE bruger
// assets/app.js (index.html logger selv via app.js - medtag ikke begge).
//
// Indsæt før </body>:  <script src="/assets/track.js" defer></script>
(() => {
  function safeUrl(u) {
    try {
      const url = new URL(u, location.origin);
      return url.origin + url.pathname + (url.search ? url.search.substring(0, 200) : "");
    } catch {
      return String(u || "").substring(0, 500);
    }
  }
  try {
    fetch("/api/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        eventType: "PageView",
        pageUrl: safeUrl(location.href),
        path: location.pathname,
        referrer: safeUrl(document.referrer || "")
      }),
      keepalive: true
    }).catch(() => {});
  } catch { /* logning må aldrig forstyrre siden */ }
})();
