const CACHE_NAME = 'ubicaciongps-pwa-v1';
const APP_SHELL = [
    '/',
    '/index.html',
    '/style.css',
    '/app.js',
    '/manifest.json',
    '/icon-192x192.png',
    '/icon-512x512.png'
];
const LIBRARY_ASSETS = [
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
    'https://unpkg.com/leaflet-routing-machine@3.2.12/dist/leaflet-routing-machine.css',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
    'https://unpkg.com/leaflet-geosearch@5.2.0/dist/geosearch.umd.js',
    'https://unpkg.com/leaflet-routing-machine@3.2.12/dist/leaflet-routing-machine.js',
    'https://cdnjs.cloudflare.com/ajax/libs/microsoft-signalr/8.0.7/signalr.min.js'
];

self.addEventListener('install', (event) => {
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE_NAME);
        await cache.addAll(APP_SHELL);
        await Promise.all(LIBRARY_ASSETS.map(async (url) => {
            try {
                const request = new Request(url, { mode: 'no-cors' });
                const response = await fetch(request);
                await cache.put(request, response);
            } catch (error) {
                console.warn('No se pudo precargar una biblioteca para uso sin conexión:', error);
            }
        }));
        await self.skipWaiting();
    })());
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        const cacheNames = await caches.keys();
        await Promise.all(cacheNames
            .filter((cacheName) => cacheName.startsWith('ubicaciongps-pwa-') && cacheName !== CACHE_NAME)
            .map((cacheName) => caches.delete(cacheName)));
        await self.clients.claim();
    })());
});

self.addEventListener('fetch', (event) => {
    const request = event.request;
    if (request.method !== 'GET') {
        return;
    }

    const requestUrl = new URL(request.url);
    const isSameOrigin = requestUrl.origin === self.location.origin;
    const isNavigation = isSameOrigin && request.mode === 'navigate';
    const isLocalAsset = isSameOrigin
        && (['script', 'style', 'image', 'font'].includes(request.destination)
            || requestUrl.pathname === '/manifest.json');
    const isLibraryAsset = !isSameOrigin
        && ['script', 'style'].includes(request.destination)
        && ['unpkg.com', 'cdnjs.cloudflare.com'].includes(requestUrl.hostname);
    if (!isNavigation && !isLocalAsset && !isLibraryAsset) {
        return;
    }

    event.respondWith((async () => {
        const cache = await caches.open(CACHE_NAME);
        try {
            const response = await fetch(request);
            if (response.ok || response.type === 'opaque') {
                try {
                    await cache.put(request, response.clone());
                } catch (error) {
                    console.warn('No se pudo actualizar un recurso de la caché PWA:', error);
                }
            }
            return response;
        } catch (error) {
            const cachedResponse = await cache.match(request);
            if (cachedResponse) {
                return cachedResponse;
            }
            if (isNavigation) {
                const appShell = await cache.match('/');
                if (appShell) {
                    return appShell;
                }
            }
            return Response.error();
        }
    })());
});
