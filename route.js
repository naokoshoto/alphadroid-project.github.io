const routes = {
    "#": "pages/home.html",
    "#home": "pages/home.html",
    "#features": "pages/home.html",     // will scroll to #features after render
    "#screenshots": "pages/home.html",  // will scroll to #screenshots after render (if present)
    "#devices": "pages/devices.html",
    "#download": "pages/devices.html",
    "#about": "pages/about.html",
    "#contact": "pages/contact.html"
};

async function fetchContent(url) {
    // Use preloaded page fragment if available
    try {
        if (window.__preloadedPages && window.__preloadedPages[url]) {
            return {
                ok: true,
                text: async () => window.__preloadedPages[url]
            };
        }
    } catch (e) {
        // fall back to network
    }

    // Handle both development and production environments
    if (window.location.protocol === 'file:') {
        // Development mode - return mock content
        return {
            ok: true,
            text: async () => `<div class="container">
                <h1>Development Mode</h1>
                <p>You are viewing: ${url}</p>
                <p>To see actual content, please run this site through a web server.</p>
            </div>`
        };
    }
    return fetch(url);
}

function getBasePath() {
    // Get the base path from the current URL
    const path = window.location.pathname;
    const projectRoot = '/';
    return path.includes(projectRoot) ? projectRoot : '/';
}

function navigateTo(path) {
    // Convert path to hash if needed
    const hash = path.startsWith('#') ? path : '#' + path.replace(/^[/#]/, '');
    
    // If we're already on this hash, just scroll to top for root
    if (hash === '#' && window.location.hash === '') {
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
    }

    // If target section exists on current page, scroll to it instead of navigation
    const targetId = hash.replace('#', '');
    const targetElement = document.getElementById(targetId);
    if (targetElement && (window.location.hash === '' || window.location.hash === '#' || window.location.hash === '#home')) {
        targetElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
    }

    // Update hash which triggers hashchange event
    window.location.hash = hash;
}

// Fix: proper function name (was split across a newline previously)
async function navigate(event, path) {
    event.preventDefault();
    navigateTo(path);
}

const routeActions = {
    "#": async () => {
        // show latest 5 devices on main page (already handled in updateContent, keep for safety)
        if (typeof loadDevices === 'function') await loadDevices(5);
    },
    "#home": async () => {
        if (typeof loadDevices === 'function') await loadDevices(5);
    },
    "#features": async () => {
        // ensure devices loaded for home too (if desired) then scroll to #features
        if (typeof loadDevices === 'function') await loadDevices(5);
        scrollToSection('features');
    },
    "#screenshots": async () => {
        if (typeof loadDevices === 'function') await loadDevices(5);
        scrollToSection('screenshots');
    },
    "#devices": async () => {
        // Render full list into the devices fragment injected into #app
        if (typeof loadDevices === 'function') await loadDevices(0);
    },
    "#download": async () => {
        if (typeof loadDevices === 'function') await loadDevices(0);
    }
};

// helper: smooth scroll to element by id if exists
function scrollToSection(id) {
    if (!id) return;
    // small timeout to allow images/fonts to settle after innerHTML injection
    setTimeout(() => {
        const el = document.getElementById(id);
        if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } else {
            // If the section is inside the injected app content, try querySelector as well
            const appEl = document.getElementById('app');
            const inside = appEl ? appEl.querySelector(`#${id}`) : null;
            if (inside) inside.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }, 120);
}

// New helper: attempt to resolve the route key for the current pathname.
// This allows supporting deployment under a repo subpath (e.g. /repo/devices).
function resolveRouteKey(pathname) {
    if (routes[pathname]) return pathname;
    // exact mapping for index-like names
    if (pathname === '' || pathname === '/') return '/';
    // try match by suffix: e.g. /repo/devices => matches /devices
    for (const key of Object.keys(routes)) {
        if (key === '/') continue;
        if (pathname === key || pathname.endsWith(key)) return key;
    }
    // fallback to index
    if (pathname.endsWith('/index.html')) return '/';
    return null;
}

async function updateContent() {
    const hash = window.location.hash || '#';
    const appDiv = document.getElementById("app");
    console.log('Current hash:', hash); // Debug logging
    
    // Start transition
    appDiv.classList.remove('fade-in');
    appDiv.classList.add('fade-out');
    await new Promise(resolve => setTimeout(resolve, 400)); // Wait for fade out
    
    try {
        const routeKey = hash;
        console.log('Route key:', routeKey, 'Route found:', routes[routeKey]); // Debug route resolution
        if (routeKey && routes[routeKey]) {
            const response = await fetchContent(routes[routeKey]);
            if (response.ok) {
                appDiv.innerHTML = await response.text();
                appDiv.classList.remove('fade-out');
                appDiv.classList.add('fade-in');

                // If the injected page is the home page (or mapped to it), populate devices dynamically
                if (routes[routeKey] && routes[routeKey].startsWith('pages/home.html')) {
                    // Load latest 5 devices for the homepage
                    loadDevices(5).catch(err => {
                        console.error('Error loading devices:', err);
                    });
                }

                // Run any route-specific post-render actions (scrolling, extra loads)
                if (routeActions[routeKey]) {
                    routeActions[routeKey]().catch(err => console.error('routeAction error', err));
                }

                return;
            }
        }

        // allow serving top-level HTML files directly (e.g. visiting /devices.html)
        // try to fetch the path as-is (strip leading slash)
        const tryPath = path.replace(/^\//, '');
        try {
            const directResp = await fetchContent(tryPath);
            if (directResp.ok) {
                appDiv.innerHTML = await directResp.text();
                return;
            }
        } catch (e) {
            // ignore and fall through to 404
        }

        const notFoundResponse = await fetchContent('pages/404.html');
        appDiv.innerHTML = await notFoundResponse.text();
    } catch (error) {
        console.error('Error loading page:', error);
        appDiv.innerHTML = '<div class="container"><h1>Error</h1><p>Failed to load content. Please ensure you are running the site through a web server.</p></div>';
    }
}

// Handle browser navigation (back/forward buttons and hash changes)
window.onhashchange = updateContent;

// Load the correct content when the page loads
window.onload = updateContent;

/**
 * Fetch device JSON files from the GitHub repo and render device cards.
 * Uses data/devices.json (created by GitHub Actions) if available to avoid client-side rate limits.
 * @param {number} limit - maximum number of devices to render (0 or omitted = all)
 */
async function loadDevices(limit = 0) {
    const container = document.querySelector('.devices-container');
    if (!container) return;

    // Simple loading state
    const loadingEl = document.createElement('div');
    loadingEl.className = 'center-align';
    loadingEl.innerHTML = '<div class="loader"></div>';
    container.innerHTML = '';
    container.appendChild(loadingEl);

    // Common render function for all data sources
    function renderDevices(devices) {
        container.innerHTML = '';
        const grid = document.createElement('div');
        grid.className = 'grid responsive medium-space'; // Add responsive grid with medium spacing
        container.appendChild(grid);

        devices.forEach(res => {
            const d = res.data || {};
            const codename = d.codename || d.device || d.id || (res.name || '').replace(/\.json$/i, '');
            const fullname = d.name || d.model || d.device_name || codename;
            // show latestVersion and maintainer instead of status/official
            const latestRaw = d.latestVersion || res.lastModified || d.version || '';
            const latestDisplay = latestRaw ? (isNaN(Date.parse(latestRaw)) ? String(latestRaw) : new Date(latestRaw).toISOString().split('T')[0]) : 'Unknown';
            const maint = d.maintainer || {};
            const maintName = maint.name || maint.username || maint.maintainer || '';
            const maintUrl = maint.url || maint.website || '';
            const maintHtml = maintUrl ? `<a href="${escapeAttr(maintUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(maintName || maintUrl)}</a>` : escapeHtml(maintName || 'Unknown');
            const infoLink = `https://github.com/AlphaDroid-devices/OTA/blob/master/${d.codename || codename}.json`;

            const card = document.createElement('article');
            card.className = 's12 m6 l4 padding center-align'; // Responsive columns: 1 on small, 2 on medium, 3 on large screens
            card.innerHTML = `
                <div class="large-padding relative" style="min-height: 200px">
                    <i class="extra-large" aria-hidden="true">smartphone</i>
                    <h5 class="no-margin">${escapeHtml(fullname)}</h5>
                    <div class="small-margin">Latest: ${escapeHtml(latestDisplay)}</div>
                    <div class="small-margin">Maintainer: ${maintHtml}</div>
                    <div class="absolute bottom right small-margin">
                        <button class="border round" onclick="showDeviceDetails('${escapeAttr(d.codename || codename)}')">
                            <i>info</i>
                            <span>Details</span>
                        </button>
                    </div>
                </div>
            `;
            grid.appendChild(card);
        });

        if (limit && limit > 0) {
            const moreWrap = document.createElement('div');
            moreWrap.className = 'center-align';
            moreWrap.innerHTML = `
                <button onclick="navigateTo('/devices'); return false;" class="round">
                    <i>devices</i>
                    <span>View all devices</span>
                </button>
            `;
            container.appendChild(moreWrap);
        }
    }

    // If preloaded aggregated data exists, use it immediately
    try {
        if (window.__preloadedData && Array.isArray(window.__preloadedData)) {
            const list = window.__preloadedData;
            const valid = list.filter(Boolean);
            valid.sort((a, b) => {
                const ta = a.lastModified ? Date.parse(a.lastModified) : 0;
                const tb = b.lastModified ? Date.parse(b.lastModified) : 0;
                return tb - ta;
            });
            const toRender = (limit && limit > 0) ? valid.slice(0, limit) : valid;
            renderDevices(toRender);
            return;
        }
    } catch (e) {
        // fall through to fetch-based loading
        console.info('preloadedData not usable, falling back to fetch', e);
    }

    // Try local cached file first (produced by GitHub Actions)
    try {
        const localResp = await fetch('data/devices.json', { cache: 'no-cache' });
        if (localResp.ok) {
            const list = await localResp.json();
            // Expecting array of { name, data, rawUrl, lastModified }
            const valid = (Array.isArray(list) ? list : []).filter(Boolean);
            // sort by lastModified desc
            valid.sort((a, b) => {
                const ta = a.lastModified ? Date.parse(a.lastModified) : 0;
                const tb = b.lastModified ? Date.parse(b.lastModified) : 0;
                return tb - ta;
            });
            const toRender = (limit && limit > 0) ? valid.slice(0, limit) : valid;

            renderDevices(toRender);
            return;
        }
    } catch (e) {
        console.info('Local devices cache not available or invalid, falling back to remote fetch', e);
    }

    try {
        // List repo contents (root). Adjust path if your JSON files are under subfolder.
        const apiUrl = 'https://api.github.com/repos/AlphaDroid-devices/OTA/contents/';
        const listResp = await fetch(apiUrl);
        if (!listResp.ok) throw new Error(`Failed to list repo contents: ${listResp.status}`);

        const items = await listResp.json();
        // Filter JSON files
        const jsonItems = items.filter(i => i.type === 'file' && i.name.toLowerCase().endsWith('.json'));

        if (jsonItems.length === 0) {
            container.innerHTML = '<div class="center-align"><h5>No device definitions found</h5></div>';
            return;
        }

        // Fetch JSON files in batches. Capture Last-Modified header for sorting.
        const results = [];
        const concurrency = 6;
        for (let i = 0; i < jsonItems.length; i += concurrency) {
            const slice = jsonItems.slice(i, i + concurrency);
            const batch = await Promise.all(slice.map(async item => {
                try {
                    const url = item.download_url || item.html_url;
                    const r = await fetch(url);
                    if (!r.ok) throw new Error(`Failed to fetch ${item.name}`);
                    const data = await r.json();
                    const lastModified = r.headers.get('last-modified') || null;
                    return { ok: true, name: item.name, data, rawUrl: url, lastModified };
                } catch (e) {
                    console.warn('Failed to fetch device file', item.name, e);
                    return { ok: false, name: item.name, error: e };
                }
            }));
            results.push(...batch);
        }

        // Only keep successful fetches
        const valid = results.filter(r => r.ok);

        // Sort by Last-Modified header (most recent first). Files without header go last.
        valid.sort((a, b) => {
            const ta = a.lastModified ? Date.parse(a.lastModified) : 0;
            const tb = b.lastModified ? Date.parse(b.lastModified) : 0;
            return tb - ta;
        });

        // Apply limit if provided (>0)
        const toRender = (limit && limit > 0) ? valid.slice(0, limit) : valid;

        renderDevices(toRender);

    } catch (err) {
        console.error('loadDevices error', err);
        container.innerHTML = '<div class="center-align error-text"><h5>Failed to load devices</h5><p>Check console for details</p></div>';
    }
}

// Add overlay and dialog elements
const overlayDiv = document.createElement('div');
overlayDiv.className = 'overlay blur modal-overlay';
// Ensure overlay covers the viewport and sits behind the dialog
overlayDiv.style.position = 'fixed';
overlayDiv.style.top = '0';
overlayDiv.style.left = '0';
overlayDiv.style.width = '100%';
overlayDiv.style.height = '100%';
overlayDiv.style.background = 'rgba(0,0,0,0.45)';
overlayDiv.style.backdropFilter = 'blur(4px)';
// Start hidden using opacity/visibility so CSS transitions can work
overlayDiv.style.display = 'none';
overlayDiv.style.opacity = '0';
overlayDiv.style.visibility = 'hidden';
// ensure overlay receives pointer events so clicks can close the dialog
overlayDiv.style.pointerEvents = 'auto';
// Use a high z-index so overlay appears above page content but below the dialog
overlayDiv.style.zIndex = '100000';
// Add a short transition so opacity/visibility animate when shown/hidden
overlayDiv.style.transition = 'opacity 220ms ease, visibility 220ms ease';
document.body.appendChild(overlayDiv);

// Utility functions to show/hide the overlay with a smooth transition
function showOverlay() {
    // Ensure display is set so element participates in layout
    overlayDiv.style.display = 'block';
    // Force layout to ensure transition will run
    // eslint-disable-next-line no-unused-expressions
    overlayDiv.getBoundingClientRect();
    overlayDiv.style.opacity = '1';
    overlayDiv.style.visibility = 'visible';
}
function hideOverlay() {
    // Start the fade-out
    overlayDiv.style.opacity = '0';
    overlayDiv.style.visibility = 'hidden';
    // After transition ends, remove from layout to avoid blocking interactable elements
    const cleanup = () => {
        overlayDiv.style.display = 'none';
        overlayDiv.removeEventListener('transitionend', cleanup);
    };
    overlayDiv.addEventListener('transitionend', cleanup);
}

// Create reusable modal elements
const deviceDialog = document.createElement('dialog');
deviceDialog.className = 'modal';
deviceDialog.style.position = 'fixed';
deviceDialog.style.top = '50%';
deviceDialog.style.left = '50%';
deviceDialog.style.transform = 'translate(-50%, -50%)';
// ensure dialog sits above the overlay
deviceDialog.style.zIndex = '100001';
// allow the dialog to receive pointer events
deviceDialog.style.pointerEvents = 'auto';
document.body.appendChild(deviceDialog);

// Ensure overlay is hidden when the dialog is closed (ESC, cancel or dialog.close())
if (typeof deviceDialog.addEventListener === 'function') {
    deviceDialog.addEventListener('close', () => {
        hideOverlay();
    });
    // also handle cancel (ESC key) which fires 'cancel'
    deviceDialog.addEventListener('cancel', () => {
        hideOverlay();
    });
}

// Set up overlay click handler
overlayDiv.onclick = () => {
    if (typeof deviceDialog.close === 'function') deviceDialog.close();
    hideOverlay();
};

// Device details modal functionality
async function showDeviceDetails(codename) {
    try {
        // Try to fetch device data from local cache first
        const localResp = await fetch(`data/devices.json`);
        let deviceData;
        
        if (localResp.ok) {
            const list = await localResp.json();
            deviceData = list.find(item => {
                const device = item.data || {};
                return (device.codename || device.device || '').toLowerCase() === codename.toLowerCase();
            });
        }

        // If not found locally, fetch from GitHub
        if (!deviceData) {
            const response = await fetch(`https://raw.githubusercontent.com/AlphaDroid-devices/OTA/master/${codename}.json`);
            if (!response.ok) throw new Error('Device info not found');
            const rawData = await response.json();
            deviceData = { data: rawData };
        }

        const d = deviceData.data;
        
        // Update and show the preloaded dialog
        deviceDialog.innerHTML = `
            <h5>${escapeHtml(d.name || d.model || codename)}</h5>
            <div class="row middle-align">
                <i>smartphone</i>
                <div class="max">
                    <div class="bold">Codename</div>
                    <div>${escapeHtml(d.codename || codename)}</div>
                </div>
            </div>
            <div class="row middle-align">
                <i>info</i>
                <div class="max">
                    <div class="bold">Model</div>
                    <div>${escapeHtml(d.model || 'N/A')}</div>
                </div>
            </div>
            <div class="row middle-align">
                <i>update</i>
                <div class="max">
                    <div class="bold">Latest</div>
                    <div>${escapeHtml(d.latestVersion || deviceData.lastModified || d.version || 'Unknown')}</div>
                </div>
            </div>
            <div class="row middle-align">
                <i>person</i>
                <div class="max">
                    <div class="bold">Maintainer</div>
                    <div>${(d.maintainer && d.maintainer.url) ? `<a href="${escapeAttr(d.maintainer.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(d.maintainer.name || d.maintainer.url)}</a>` : escapeHtml((d.maintainer && (d.maintainer.name || d.maintainer.url)) || 'Unknown')}</div>
                </div>
            </div>
            <nav class="right-align no-space">
                <button class="transparent link" onclick="this.closest('dialog').close(); hideOverlay()">Close</button>
                <button class="transparent link" onclick="window.open('https://sourceforge.net/projects/alphadroid-project/files/${codename}', '_blank')">Download</button>
            </nav>
        `;

        // Show the dialog and overlay
        showOverlay();
        // Use show() instead of showModal() to avoid the UA backdrop that can obscure custom overlays
        if (typeof deviceDialog.show === 'function') {
            deviceDialog.show();
        } else if (typeof deviceDialog.showModal === 'function') {
            // fallback if older browser doesn't support show()
            deviceDialog.showModal();
        }
    } catch (error) {
        console.error('Error showing device details:', error);
        // Show error snackbar using BeerCSS
        const snackbar = document.createElement('div');
        snackbar.className = 'snackbar';
        snackbar.innerHTML = `
            <div>Failed to load device details</div>
            <button class="transparent circle" onclick="this.parentElement.remove()">
                <i>close</i>
            </button>
        `;
        document.body.appendChild(snackbar);
        setTimeout(() => snackbar.remove(), 3000);
    }
}

// Small helpers to avoid injecting poorly-escaped values
function escapeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function escapeAttr(s) {
    return escapeHtml(s).replace(/"/g, '&quot;');
}