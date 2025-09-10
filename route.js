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

    // Helper to normalize different JSON shapes (data.response[] vs flat)
    function normalizeEntry(res) {
        // res may be { name, data: { response: [ { ... } ] }, rawUrl, lastModified }
        // or already a simple device object
        if (!res) return { rawName: '' };
        const rawName = (res.name || '').replace(/\.json$/i, '');
        if (res.data && Array.isArray(res.data.response) && res.data.response.length > 0) {
            const d = res.data.response[0];
            return Object.assign({ rawName, raw: res }, d);
        }
        if (res.data && typeof res.data === 'object') {
            return Object.assign({ rawName, raw: res }, res.data);
        }
        // fallback: res itself could be the device object
        return Object.assign({ rawName, raw: res }, res);
    }

    // New helper: determine the best update timestamp (ms) for an entry
    function getUpdatedTime(entry) {
        if (!entry) return 0;
        // Prefer explicit timestamp fields in various shapes
        try {
            // If entry.data is the wrapper with response[] (from data/devices.json)
            const data = entry.data || (entry.raw && entry.raw.data) || null;
            if (data) {
                const resp = Array.isArray(data.response) ? data.response[0] : data;
                if (resp && resp.timestamp) {
                    const ts = Number(resp.timestamp);
                    if (!Number.isNaN(ts) && ts > 0) return ts * 1000;
                }
                if (data.timestamp) {
                    const ts2 = Number(data.timestamp);
                    if (!Number.isNaN(ts2) && ts2 > 0) return ts2 * 1000;
                }
            }

            // Some fetch results include lastModified header stored on the wrapper
            if (entry.lastModified) {
                const t = Date.parse(entry.lastModified);
                if (!Number.isNaN(t)) return t;
            }

            // If response objects contain a 'timestamp' at top-level
            if (entry.timestamp) {
                const t2 = Number(entry.timestamp);
                if (!Number.isNaN(t2) && t2 > 0) return t2 * 1000;
            }

            // If version is a date-like string, try to parse it
            const maybe = entry.version || (entry.data && entry.data.version) || '';
            if (maybe && !Number.isNaN(Date.parse(maybe))) return Date.parse(maybe);
        } catch (e) {
            // ignore parse errors
        }
        return 0;
    }

    // Common render function for all data sources
    function renderDevices(devices) {
        container.innerHTML = '';
        const grid = document.createElement('div');
        grid.className = 'grid responsive medium-space'; // Add responsive grid with medium spacing
        container.appendChild(grid);

        // Keep raw list for search/filter
        window.__allDevicesRaw = devices.slice();

        // Brand color mapping and helpers for OEM chip styling
        const _brandColors = {
            xiaomi: '#FF6900',
            google: '#4285F4',
            pixel: '#4285F4',
            oneplus: '#EB0029',
            nothing: '#000000',
            samsung: '#1428A0',
            motorola: '#E60012',
            huawei: '#D70015',
            oppo: '#00B388',
            vivo: '#1E90FF',
            realme: '#F3D04E',
            sony: '#00A3E0',
            lg: '#A50034',
            nokia: '#124191',
            asus: '#005BAC'
        };

        function getBrandColor(name) {
            if (!name) return null;
            const v = String(name).toLowerCase().trim();
            // direct key
            if (_brandColors[v]) return _brandColors[v];
            // try contains
            for (const k of Object.keys(_brandColors)) {
                if (v.indexOf(k) !== -1) return _brandColors[k];
            }
            return null;
        }

        function getTextColor(hex) {
            if (!hex) return 'inherit';
            // convert #RRGGBB to rgb
            const h = hex.replace('#', '');
            if (h.length !== 6) return 'white';
            const r = parseInt(h.slice(0,2), 16);
            const g = parseInt(h.slice(2,4), 16);
            const b = parseInt(h.slice(4,6), 16);
            // Perceived luminance
            const lum = 0.299 * r + 0.587 * g + 0.114 * b;
            return lum > 186 ? 'black' : 'white';
        }

        devices.forEach(res => {
            const d = normalizeEntry(res);
            const codename = (d.codename || d.device || d.id || d.rawName || '').toString();
            const fullname = d.device || d.name || d.model || codename;

            // prefer numeric timestamp -> ISO date; otherwise use version/lastModified
            let latestDisplay = 'Unknown';
            if (d.timestamp) {
                try {
                    const ts = Number(d.timestamp);
                    if (!Number.isNaN(ts) && ts > 0) latestDisplay = new Date(ts * 1000).toISOString().split('T')[0];
                } catch (e) { /* ignore */ }
            }
            if (latestDisplay === 'Unknown') {
                const raw = d.latestVersion || (res && res.lastModified) || d.version || d.release || '';
                if (raw) latestDisplay = isNaN(Date.parse(raw)) ? String(raw) : new Date(raw).toISOString().split('T')[0];
            }

            // maintainer can be a string or object; build a simple display
            let maintName = '';
            let maintUrl = '';
            if (typeof d.maintainer === 'string') {
                maintName = d.maintainer;
                // try to surface telegram/paypal/forum if present on parent
                maintUrl = d.telegram || d.paypal || d.forum || '';
            } else if (d.maintainer && typeof d.maintainer === 'object') {
                maintName = d.maintainer.name || d.maintainer.username || d.maintainer.maintainer || '';
                maintUrl = d.maintainer.url || d.maintainer.website || '';
            }
            const maintHtml = maintUrl ? `<a href="${escapeAttr(maintUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(maintName || maintUrl)}</a>` : escapeHtml(maintName || 'Unknown');

            const infoLink = (res.rawUrl || (d.raw && d.raw.rawUrl) || `https://raw.githubusercontent.com/AlphaDroid-devices/OTA/master/${codename}.json`);

            // compute chip values
            const oemVal = (d.oem || d.vendor || d.brand || '').toString();
            const maintText = (typeof maintName === 'string' && maintName) ? maintName : (d.maintainer && typeof d.maintainer === 'string' ? d.maintainer : 'Unknown');

            const oemColor = getBrandColor(oemVal);
            const oemTextColor = getTextColor(oemColor);
            const oemStyle = oemColor ? ('style="background:' + oemColor + '; color:' + oemTextColor + '; border-color: ' + oemColor + ';"') : '';
            const imageUrl = d.image || `images/devices/${codename}.webp`;

            const card = document.createElement('article');
            card.className = 's12 m6 l4 padding center-align'; // Responsive columns: 1 on small, 2 on medium, 3 on large screens
            card.setAttribute('data-codename', codename.toLowerCase());
            card.setAttribute('data-oem', (oemVal || '').toLowerCase());
            card.setAttribute('data-model', (fullname || '').toLowerCase());
            card.innerHTML = `
                <div class="small-padding relative" style="aspect-ratio: 3 / 4; width: 100%;">
                    <div style="display:flex; justify-content:center; align-items:flex-start; padding-top:8px;">
                        <img src="${escapeAttr(imageUrl)}" alt="${escapeAttr(fullname)}" style="width:72px;height:72px;object-fit:contain;" onerror="this.replaceWith(Object.assign(document.createElement('i'),{className:'extra-large',textContent:'smartphone'}));">
                    </div>
                    <div class="absolute bottom left" style="width: 100%; text-align:left; display:flex; flex-direction:column; align-items:flex-start;">
                        <h5 class="small-margin" style="margin-left:4px;">${escapeHtml(fullname)}</h5>
                        <button class="chip fill round" style="margin-left:4px;">
                            <i>today</i>
                            <span>${escapeHtml(latestDisplay)}</span>
                        </button>
                        <div class="small-margin" style="width:100%;">
                            <nav class="group connected" style="justify-content:flex-start;">
                                <button class="chip left-round" ${oemStyle}><span>${escapeHtml(oemVal || 'Unknown')}</span></button>
                                <button class="chip fill no-round"><span>${escapeHtml(maintText)}</span></button>
                                <button class="chip fill right-round"><span>${escapeHtml(codename)}</span></button>
                            </nav>
                        </div>
                        <div class="small-margin" style="display:flex; justify-content:flex-end; width:100%;">
                            <button class="border round" onclick="showDeviceDetails('${escapeAttr(codename)}')">
                                <i>info</i>
                                <span>Details</span>
                            </button>
                        </div>
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

        // If full list (limit==0) ensure search initialized
        if (!limit || limit === 0) {
            if (typeof setupDeviceSearch === 'function') setupDeviceSearch();
            if (typeof buildOemFilterChips === 'function') buildOemFilterChips();
        }
    }

    // If preloaded aggregated data exists, use it immediately
    try {
        // Prefer overrides DB produced locally: data/device_db.json
        const dbResp = await fetch('data/device_db.json', { cache: 'no-cache' }).catch(() => null);
        if (dbResp && dbResp.ok) {
            const db = await dbResp.json();
            const overrides = (db && db.overrides) ? db.overrides : {};

            // Attempt to load the richer devices.json to preserve download/variant details
            let devicesList = [];
            try {
                const localResp = await fetch('data/devices.json', { cache: 'no-cache' });
                if (localResp && localResp.ok) devicesList = await localResp.json();
            } catch (e) {
                // ignore, we'll create minimal entries from overrides
            }

            const entries = Object.keys(overrides).map(key => {
                const ov = overrides[key] || {};
                const lower = key.toLowerCase();
                const found = (devicesList || []).find(it => ((it.name || '').replace(/\.json$/i, '').toLowerCase() === lower));
                if (found) {
                    // Use the upstream response but apply override fields to the first response object
                    const respArr = (found.data && Array.isArray(found.data.response)) ? found.data.response.slice() : (found.data ? [found.data] : []);
                    const base = respArr[0] || {};
                    const merged = Object.assign({}, base, {
                        codename: ov.codename || base.codename || key,
                        device: ov.model || base.device || base.model || base.device,
                        model: ov.model || base.model || base.device || '',
                        maintainer: ov.maintainer || base.maintainer || base.maintainer,
                        image: ov.image || base.image || (ov.codename ? `images/devices/${ov.codename}.webp` : `images/devices/${key}.webp`)
                    });
                    respArr[0] = merged;
                    return { ok: true, name: found.name || (key + '.json'), data: { response: respArr }, rawUrl: found.rawUrl || found.rawUrl };
                }
                // Minimal synthesized entry from override
                const minimal = {
                    maintainer: ov.maintainer || '',
                    oem: ov.oem || '',
                    device: ov.model || '',
                    codename: ov.codename || key,
                    image: ov.image || `images/devices/${key}.webp`
                };
                return { ok: true, name: key + '.json', data: { response: [minimal] } };
            });

            // Sort and render
            entries.sort((a, b) => getUpdatedTime(b) - getUpdatedTime(a));
            const toRender = (limit && limit > 0) ? entries.slice(0, limit) : entries;
            renderDevices(toRender);
            return;
        }
    } catch (e) {
        console.info('device_db.json not usable, falling back to other sources', e);
    }
    
    // Fallback: use any preloaded aggregated data if present
    try {
        if (window.__preloadedData && Array.isArray(window.__preloadedData)) {
            const list = window.__preloadedData;
            const valid = list.filter(Boolean);
            // sort by best-known updated time desc
            valid.sort((a, b) => getUpdatedTime(b) - getUpdatedTime(a));
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
            // sort by best-known updated time desc
            valid.sort((a, b) => getUpdatedTime(b) - getUpdatedTime(a));
            const toRender = (limit && limit > 0) ? valid.slice(0, limit) : valid;

            renderDevices(toRender);
            return;
        }
    } catch (e) {
        console.info('Local devices cache not available or invalid, falling back to remote fetch', e);
    }

    // Try remote GitHub API listing and fall back to raw fetching if necessary
    try {
        const apiUrl = 'https://api.github.com/repos/AlphaDroid-devices/OTA/contents/';
        const listResp = await fetch(apiUrl);
        if (!listResp.ok) throw new Error(`Failed to list repo contents: ${listResp.status}`);

        const items = await listResp.json();
        const jsonItems = items.filter(i => i.type === 'file' && i.name.toLowerCase().endsWith('.json'));

        if (jsonItems.length === 0) {
            container.innerHTML = '<div class="center-align"><h5>No device definitions found</h5></div>';
            return;
        }

        const results = [];
        const concurrency = 6;
        for (let i = 0; i < jsonItems.length; i += concurrency) {
            const slice = jsonItems.slice(i, i + concurrency);
            const batch = await Promise.all(slice.map(async item => {
                try {
                    const url = item.download_url || item.html_url || item.url;
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

        const valid = results.filter(r => r.ok);
        // Sort by best-known updated time desc
        valid.sort((a, b) => getUpdatedTime(b) - getUpdatedTime(a));

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
deviceDialog.style.maxWidth = '90%';
deviceDialog.style.width = '400px';
deviceDialog.style.border = 'none';
deviceDialog.style.borderRadius = '8px';
deviceDialog.style.overflow = 'hidden';
deviceDialog.style.zIndex = '100001'; // Above the overlay
document.body.appendChild(deviceDialog);

// Show device details in a modal dialog
async function showDeviceDetails(codename) {
    try {
        // Fetch device data (prefer local cache)
        let deviceData = null;
        try {
            const localResp = await fetch('data/devices.json');
            if (localResp && localResp.ok) {
                const list = await localResp.json();
                deviceData = list.find(item => {
                    if (!item) return false;
                    const responses = (item.data && Array.isArray(item.data.response)) ? item.data.response : (item.data ? [item.data] : []);
                    if ((item.name || '').replace(/\.json$/i, '').toLowerCase() === codename.toLowerCase()) return true;
                    return responses.some(d => {
                        if (!d) return false;
                        const candidates = [d.codename, d.device, d.id, item.name];
                        return candidates.some(c => (c || '').toString().toLowerCase() === codename.toLowerCase());
                    });
                });
            }
        } catch (e) { /* ignore and fallback */ }

        if (!deviceData) {
            const response = await fetch(`https://raw.githubusercontent.com/AlphaDroid-devices/OTA/master/${codename}.json`);
            if (!response.ok) throw new Error('Device info not found');
            const rawData = await response.json();
            deviceData = { data: rawData, rawUrl: `https://raw.githubusercontent.com/AlphaDroid-devices/OTA/master/${codename}.json` };
        }

        // Normalize
        let d = null;
        if (deviceData && deviceData.data) {
            if (Array.isArray(deviceData.data.response) && deviceData.data.response.length > 0) {
                d = deviceData.data.response.find(item => ((item.codename || item.device || '') + '').toLowerCase() === codename.toLowerCase()) || deviceData.data.response[0];
            } else {
                d = deviceData.data;
            }
        } else {
            d = deviceData;
        }

        // Apply overrides if available
        try {
            const dbResp = await fetch('data/device_db.json', { cache: 'no-cache' }).catch(() => null);
            if (dbResp && dbResp.ok) {
                const db = await dbResp.json();
                const ov = (db && db.overrides) ? db.overrides[codename.toLowerCase()] : null;
                if (ov) {
                    d = d || {};
                    d.codename = ov.codename || d.codename || codename;
                    d.oem = ov.oem || d.oem;
                    d.model = ov.model || d.model || d.device || '';
                    d.device = ov.model || d.device || d.model || '';
                    if (ov.maintainer) d.maintainer = ov.maintainer;
                    if (ov.image) d.image = ov.image; else if (!d.image) d.image = `images/devices/${d.codename || codename}.webp`;
                }
            }
        } catch (e) { /* ignore */ }

        const displayName = escapeHtml(d.name || d.model || codename);
        const deviceCodename = escapeHtml(d.codename || d.device || codename);
        const modalImageUrl = d.image || `images/devices/${(d.codename || codename)}.webp`;

        // Variants
        const variants = (deviceData && deviceData.data && Array.isArray(deviceData.data.response) && deviceData.data.response.length > 0)
            ? deviceData.data.response
            : [d];

        // Helpers
        function formatBytes(bytes) {
            if (bytes == null || bytes === '') return 'Unknown';
            const n = Number(bytes);
            if (Number.isNaN(n)) return String(bytes);
            if (n === 0) return '0 B';
            const units = ['B','KB','MB','GB','TB'];
            let i = 0;
            let val = n;
            while (val >= 1024 && i < units.length - 1) { val /= 1024; i++; }
            const fixed = (val < 10 && i > 0) ? val.toFixed(1) : Math.round(val);
            return `${fixed} ${units[i]}`;
        }

        function buildLinkButtons(entry) {
            if (!entry) return '';

            const groups = [
                { name: 'Source', items: [['Device tree', entry.dt], ['Kernel', entry.kernel]] },
                { name: 'Support', items: [['Forum', entry.forum], ['Telegram', entry.telegram], ['Paypal', entry.paypal]] },
                { name: 'More', items: [['Recovery', entry.recovery], ['Firmware', entry.firmware], ['Vendor', entry.vendor]] }
            ];

            // keep only groups that have at least one URL
            const present = groups.map(g => ({ name: g.name, items: g.items.filter(([lbl, url]) => url) })).filter(g => g.items.length);
            if (!present.length) return '';

            const buttons = present.map((g, idx) => {
                let cls = 'no-round';
                if (idx === 0) cls = 'left-round';
                else if (idx === present.length - 1) cls = 'right-round';

                const menuItems = g.items.map(([label, url]) => `
                    <li><a href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a></li>
                `).join('');

                return `
                    <button class="${cls}">
                        <span>${escapeHtml(g.name)}</span>
                        <i>arrow_drop_up</i>
                        <menu class="top">
                            ${menuItems}
                        </menu>
                    </button>
                `;
            }).join('');

            return `<nav class="group connected">${buttons}</nav>`;
        }

        function buildVariantsListHtml(list) {
            if (!list || !list.length) return '';
            const buttons = list.map((v, i) => {
                const label = escapeHtml(v.buildvariant || v.buildtype || v.filename || v.version || `Variant ${i+1}`);
                let cls = 'no-round small';
                if (i === 0) cls = 'left-round small';
                else if (i === list.length - 1) cls = 'right-round small';
                return `<button class="${cls}" data-variant-index="${i}">${label}</button>`;
            }).join('');
            return `<nav class="group connected">${buttons}</nav>`;
        }

        // Render modal
        deviceDialog.innerHTML = `
            <h5>${displayName}</h5>
            <div class="grid">
                <div class="s12 m6">
                    <div class="row middle-align">
                        <i>smartphone</i>
                        <div class="max">
                            <div class="bold">Codename</div>
                            <div>${deviceCodename}</div>
                        </div>
                    </div>

                    <div class="row middle-align">
                        <i>info</i>
                        <div class="max">
                            <div class="bold">Model</div>
                            <div>${escapeHtml(d.model || d.device || 'N/A')}</div>
                        </div>
                    </div>

                    <div class="row middle-align">
                        <i>update</i>
                        <div class="max">
                            <div class="bold">Latest</div>
                            <div id="device-latest">${escapeHtml(d.timestamp ? (new Date(Number(d.timestamp) * 1000).toISOString().split('T')[0]) : (d.version || 'Unknown'))}</div>
                        </div>
                    </div>
                </div>

                <div class="s12 m6">
                    <div class="row middle-align">
                        <i>tag</i>
                        <div class="max">
                            <div class="bold">Version</div>
                            <div id="device-version">${escapeHtml(d.version || (d.filename ? (d.filename.match(/v[\d.]+/) || [''])[0] : 'Unknown'))}</div>
                        </div>
                    </div>

                    <div class="row middle-align">
                        <i>storage</i>
                        <div class="max">
                            <div class="bold">Size</div>
                            <div id="device-size">${escapeHtml(formatBytes(d.size || d.filesize || d.size_bytes || ''))}</div>
                        </div>
                    </div>

                    <div class="row middle-align">
                        <i>person</i>
                        <div class="max">
                            <div class="bold">Maintainer</div>
                            <div>${(d.maintainer && typeof d.maintainer === 'object' && d.maintainer.url) ? `<a href="${escapeAttr(d.maintainer.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(d.maintainer.name || d.maintainer.url)}</a>` : escapeHtml((typeof d.maintainer === 'string' && d.maintainer) || (d.maintainer && (d.maintainer.name || d.maintainer.url)) || 'Unknown')}</div>
                        </div>
                    </div>
                </div>

                <div class="s12">
                    <div class="row">
                        <i>tag</i>
                        <div class="max">
                            <div class="bold">Build Variants</div>
                            <div id="build-variants">
                                ${buildVariantsListHtml(variants)}
                            </div>
                        </div>
                    </div>

                </div>
                <div class="s12">
                    <div class="row center-align">
                        <div id="device-links-wrapper">
                            ${buildLinkButtons(variants[0] || d)}
                        </div>
                    </div>
                </div>
                <div class="s12">
                    <nav class="row right-align no-space">
                        <button class="transparent link" onclick="this.closest('dialog').close(); hideOverlay()">Close</button>
                        <button id="device-download" class="transparent link">Download</button>
                    </nav>
                </div>
            </div>
        `;

        // Variant interactions
        (function() {
            const entries = variants;
            const getListButtons = () => deviceDialog.querySelectorAll('#build-variants [data-variant-index]');
            let selectedIndex = 0;

            function getEntryForIndex(idx) {
                return entries[idx] || entries[0] || d;
            }

            function updateVariantDisplay() {
                const entry = getEntryForIndex(selectedIndex);
                const btn = deviceDialog.querySelector('#device-download');
                const url = entry.download || entry.url || entry.file || entry.filename || deviceData.rawUrl || `https://sourceforge.net/projects/alphadroid-project/files/${codename}`;
                if (btn) btn.onclick = () => window.open(url, '_blank');

                if (btn) {
                    const sizeLabel = formatBytes(entry.size || entry.filesize || entry.size_bytes || d.size || '');
                    btn.textContent = `Download (${sizeLabel})`;
                }

                const versionEl = deviceDialog.querySelector('#device-version');
                const latestEl = deviceDialog.querySelector('#device-latest');
                const sizeEl = deviceDialog.querySelector('#device-size');
                if (versionEl) versionEl.textContent = entry.version || entry.filename || entry.buildvariant || entry.buildtype || (d && d.version) || 'Unknown';
                if (latestEl) latestEl.textContent = entry.timestamp ? new Date(Number(entry.timestamp) * 1000).toISOString().split('T')[0] : (entry.version || 'Unknown');
                if (sizeEl) sizeEl.textContent = formatBytes(entry.size || entry.filesize || entry.size_bytes || d.size || '');

                const linksWrapper = deviceDialog.querySelector('#device-links-wrapper');
                if (linksWrapper) linksWrapper.innerHTML = buildLinkButtons(entry);

                const chips = getListButtons();
                if (chips && chips.length) {
                    chips.forEach(c => c.classList.remove('active'));
                    const active = deviceDialog.querySelector(`#build-variants [data-variant-index='${selectedIndex}']`);
                    if (active) active.classList.add('active');
                }
            }

            const listBtns = getListButtons();
            if (listBtns && listBtns.length) {
                listBtns.forEach((b) => {
                    const idx = Number(b.getAttribute('data-variant-index'));
                    b.addEventListener('click', () => {
                        selectedIndex = idx;
                        updateVariantDisplay();
                    });
                });
                updateVariantDisplay();
            } else {
                selectedIndex = 0;
                updateVariantDisplay();
            }
        })();

        // show modal
        showOverlay();
        if (typeof deviceDialog.show === 'function') deviceDialog.show();
        else if (typeof deviceDialog.showModal === 'function') deviceDialog.showModal();
    } catch (error) {
        console.error('Error showing device details:', error);
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

// Search setup
function setupDeviceSearch() {
    const input = document.getElementById('device-search-input');
    const suggestMenu = document.getElementById('device-search-suggestions'); // retained but unused (suggestions removed)
    if (suggestMenu) suggestMenu.style.display = 'none';
    if (!input) return;

    const container = document.querySelector('.devices-container');
    if (!container) return;

    function getCards() {
        return Array.from(container.querySelectorAll('article[data-codename]'));
    }

    function activeOemFilter() {
        const active = document.querySelector('#oem-filter-chips button.primary[data-oem]');
        return active ? (active.getAttribute('data-oem') || '').toLowerCase() : '';
    }

    function runFilter(raw) {
        const oemFilter = activeOemFilter();
        const val = (raw || '').trim().toLowerCase();
        const tokens = val.split(/\s+/).filter(Boolean);
        const cards = getCards();
        if (!tokens.length && !oemFilter) {
            cards.forEach(c => c.style.display = '');
            return;
        }
        cards.forEach(c => {
            const codename = c.getAttribute('data-codename') || '';
            const oem = c.getAttribute('data-oem') || '';
            const model = c.getAttribute('data-model') || '';
            if (oemFilter && oem !== oemFilter) {
                c.style.display = 'none';
                return;
            }
            const hay = (codename + ' ' + oem + ' ' + model).toLowerCase();
            const match = tokens.every(t => hay.includes(t));
            c.style.display = match ? '' : (tokens.length ? 'none' : '');
        });
    }

    let debounceTimer = null;
    function schedule() {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => runFilter(input.value), 1000); // 1s cooldown
    }

    window.applyDeviceSearch = () => runFilter(input.value || '');
    input.addEventListener('input', schedule);
    input.addEventListener('keydown', e => {
        if (e.key === 'Enter') { // allow manual immediate search on Enter
            if (debounceTimer) clearTimeout(debounceTimer);
            runFilter(input.value);
        } else if (e.key === 'Escape') {
            input.value='';
            if (debounceTimer) clearTimeout(debounceTimer);
            runFilter('');
        }
    });

    // expose for external trigger (OEM pills)
    window.__runDeviceSearchFilter = () => runFilter(input.value || '');
}

function buildOemFilterChips() {
    const wrap = document.getElementById('oem-filter-chips');
    if (!wrap) return;
    const cards = Array.from(document.querySelectorAll('.devices-container article[data-oem]'));
    const oems = Array.from(new Set(cards.map(c => c.getAttribute('data-oem') || '').filter(Boolean))).sort();
    if (!oems.length) { wrap.innerHTML=''; return; }
    wrap.innerHTML = '';

    const nav = document.createElement('nav');
    nav.className = 'group connected';
    nav.style.display = 'flex';
    nav.style.flexWrap = 'wrap';
    nav.style.gap = '2px';
    wrap.appendChild(nav);

    function applyRoundClass(btn, i, total) {
        btn.classList.remove('left-round','right-round','no-round');
        if (i === 0) {
            btn.classList.add('left-round');
        } else if (i === total - 1) {
            btn.classList.add('right-round');
        } else {
            btn.classList.add('no-round');
        }
    }

    function rebuildRoundClasses() {
        const list = Array.from(nav.querySelectorAll('button'));
        list.forEach((b, i) => applyRoundClass(b, i, list.length));
    }

    function makeButton(label, dataOEM) {
        const btn = document.createElement('button');
        btn.textContent = label;
        btn.className = 'small border';
        if (dataOEM) btn.setAttribute('data-oem', dataOEM); else btn.setAttribute('data-all', '');
        btn.addEventListener('click', () => {
            const isActive = btn.classList.contains('primary');
            const allButtons = nav.querySelectorAll('button');
            allButtons.forEach(b => { b.classList.remove('fill','primary'); if (!b.hasAttribute('data-all')) b.classList.add('border'); });
            if (btn.hasAttribute('data-all')) {
                if (!isActive) { btn.classList.remove('border'); btn.classList.add('fill','primary'); }
                else { // keep All active always
                    btn.classList.add('fill','primary'); btn.classList.remove('border');
                }
            } else {
                if (!isActive) {
                    btn.classList.remove('border');
                    btn.classList.add('fill','primary');
                } else {
                    // revert to All
                    const all = nav.querySelector('button[data-all]');
                    if (all) { all.classList.add('fill','primary'); all.classList.remove('border'); }
                }
            }
            if (window.__runDeviceSearchFilter) window.__runDeviceSearchFilter();
        });
        return btn;
    }

    // All button first
    const allBtn = makeButton('All', null);
    allBtn.classList.remove('border');
    allBtn.classList.add('fill','primary');
    nav.appendChild(allBtn);

    // OEM buttons
    oems.forEach(o => nav.appendChild(makeButton(o, o)));

    rebuildRoundClasses();
}