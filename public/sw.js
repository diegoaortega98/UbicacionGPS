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
