// Preload important fragments/data to speed up SPA navigation and reduce GitHub API pressure
(async function () {
  try {
    window.__preloadedPages = window.__preloadedPages || {};
    window.__preloadedData = window.__preloadedData || null;

    // Prefetch devices fragment
    try {
      const resp = await fetch('pages/devices.html', { cache: 'no-cache' });
      if (resp && resp.ok) {
        const txt = await resp.text();
        // store under both the fragment path and the routed paths
        window.__preloadedPages['pages/devices.html'] = txt;
        window.__preloadedPages['/devices'] = txt;
        window.__preloadedPages['/download'] = txt;
      }
    } catch (e) {
      // ignore
      console.info('pages/devices.html preload failed', e);
    }

    // Prefetch aggregated devices JSON (if present)
    try {
      const resp = await fetch('data/devices.json', { cache: 'no-cache' });
      if (resp && resp.ok) {
        window.__preloadedData = await resp.json();
      }
    } catch (e) {
      console.info('data/devices.json preload failed', e);
    }

    // Optionally populate Cache API so normal fetch() benefits from cached responses
    if ('caches' in window) {
      try {
        const cache = await caches.open('preload-v1');
        await cache.addAll(['pages/devices.html', 'data/devices.json'].filter(Boolean)).catch(() => {});
      } catch (e) {
        // ignore caching errors
      }
    }
  } catch (e) {
    console.error('preload bootstrap failed', e);
  }
})();
