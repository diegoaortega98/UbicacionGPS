const CACHE_NAME = 'ubicaciongps-shell-v1';
const APP_SHELL = [
    '/',
    '/manifest.json',
    '/icon-192x192.png',
    '/icon-512x512.png',
    '/native-config.js',
    '/background-location.bundle.js'
];
const LIBRARY_SHELL = [
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
    'https://cdn.socket.io/4.8.1/socket.io.min.js'
];

async function cacheAppShell() {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_SHELL);

    // Guarda las bibliotecas externas cuando hay conexión, sin bloquear la instalación si fallan.
    await Promise.all(LIBRARY_SHELL.map(async (url) => {
        try {
            const response = await fetch(new Request(url, { mode: 'no-cors' }));
            await cache.put(url, response);
        } catch (error) {
            console.warn('No se pudo guardar una biblioteca para uso sin conexión:', error);
        }
    }));
}

self.addEventListener('install', (event) => {
    // Guarda los recursos esenciales para abrir la app sin conexión.
    event.waitUntil(
        cacheAppShell()
            .catch((error) => {
                console.error('No se pudo guardar la app para uso sin conexión:', error);
                throw error;
            })
    );
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    // Elimina cachés antiguas al publicar una nueva versión del shell.
    event.waitUntil(
        Promise.all([
            caches.keys().then((cacheNames) => Promise.all(
                cacheNames
                    .filter((cacheName) => cacheName.startsWith('ubicaciongps-shell-') && cacheName !== CACHE_NAME)
                    .map((cacheName) => caches.delete(cacheName))
            )),
            self.clients.claim()
        ])
    );
});

self.addEventListener('fetch', (event) => {
    const requestUrl = new URL(event.request.url);
    if (event.request.method !== 'GET') {
        return;
    }

    const isSameOrigin = requestUrl.origin === self.location.origin;
    const isAppNavigation = isSameOrigin
        && event.request.mode === 'navigate'
        && requestUrl.pathname === '/';
    const isLocalAsset = isSameOrigin
        && (['script', 'style', 'image', 'font'].includes(event.request.destination)
            || requestUrl.pathname === '/manifest.json');
    const isLibraryAsset = !isSameOrigin
        && ['script', 'style'].includes(event.request.destination)
        && ['unpkg.com', 'cdn.socket.io'].includes(requestUrl.hostname);
    if (!isAppNavigation && !isLocalAsset && !isLibraryAsset) {
        return;
    }

    // Intenta obtener la versión actual y usa la copia local si la red no está disponible.
    event.respondWith(
        (async () => {
            try {
                const response = await fetch(event.request);
                if (response.ok || response.type === 'opaque') {
                    try {
                        const cache = await caches.open(CACHE_NAME);
                        await cache.put(event.request, response.clone());
                    } catch (error) {
                        console.warn('No se pudo actualizar un recurso de la caché offline:', error);
                    }
                }
                return response;
            } catch (error) {
                const cachedResponse = await caches.match(event.request);
                if (cachedResponse) {
                    return cachedResponse;
                }
                if (isAppNavigation) {
                    const appShell = await caches.match('/');
                    if (appShell) {
                        return appShell;
                    }
                }
                return Response.error();
            }
        })()
    );
});

self.addEventListener('push', (event) => {
    // El proveedor push puede enviar el payload como JSON o como texto plano.
    let payload = {};
    try {
        payload = event.data ? event.data.json() : {};
    } catch (error) {
        payload = { body: event.data ? event.data.text() : '' };
    }

    const title = payload.title || 'UbicacionGPS';
    const options = {
        body: payload.body || 'Tienes una nueva alerta.',
        data: { url: payload.url || '/panel-privado-gps' }
    };
    event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    event.waitUntil((async () => {
        // No permitir que una carga de notificación navegue fuera del origen de la app.
        const targetUrl = new URL(
            event.notification.data?.url || '/panel-privado-gps',
            self.location.origin
        );
        if (targetUrl.origin !== self.location.origin) {
            targetUrl.href = new URL('/panel-privado-gps', self.location.origin).href;
        }

        const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const client of windows) {
            if (new URL(client.url).origin === self.location.origin) {
                await client.navigate(targetUrl.href);
                return client.focus();
            }
        }
        return self.clients.openWindow(targetUrl.href);
    })());
});
