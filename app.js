const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const webpush = require('web-push');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config();

const configuredVapidPublicKey = process.env.VAPID_PUBLIC_KEY;
const configuredVapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
let vapidKeys;
if (configuredVapidPublicKey && configuredVapidPrivateKey) {
    vapidKeys = {
        publicKey: configuredVapidPublicKey,
        privateKey: configuredVapidPrivateKey
    };
} else if (!configuredVapidPublicKey && !configuredVapidPrivateKey) {
    // El par temporal facilita pruebas locales; en producción configura ambas variables.
    vapidKeys = webpush.generateVAPIDKeys();
    console.warn('No se configuraron claves VAPID; se generó un par temporal que cambiará al reiniciar.');
} else {
    throw new Error('Configura VAPID_PUBLIC_KEY y VAPID_PRIVATE_KEY juntas.');
}

webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:admin@ubicaciongps.local',
    vapidKeys.publicKey,
    vapidKeys.privateKey
);

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: '*'
    }
});
const users = new Map();
const admins = new Set();
const geofences = [];
const pushSubscriptions = [];
const geocodeRateLimits = new Map();
const ADMIN_PASSWORD = process.env.ADMIN_KEY || 'gpsadmin2026';
const ADMIN_ROUTE = '/panel-privado-gps';
const ADMIN_SESSION_COOKIE = 'gps_admin_session';
const ADMIN_SESSION_TTL = 8 * 60 * 60 * 1000;
// Las sesiones no persisten al reiniciar el servidor y caducan después de ocho horas.
const adminSessions = new Map();
const MAX_HISTORY = 50;

app.set('trust proxy', 1);
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

function getCookieValue(cookieHeader, name) {
    const cookie = cookieHeader
        ?.split(';')
        .map((part) => part.trim())
        .find((part) => part.startsWith(`${name}=`));
    return cookie ? cookie.slice(name.length + 1) : null;
}

function getValidAdminSession(token) {
    if (!token) {
        return false;
    }

    const expiresAt = adminSessions.get(token);
    if (!expiresAt) {
        return false;
    }
    if (expiresAt <= Date.now()) {
        adminSessions.delete(token);
        return false;
    }
    return true;
}

function requireAdminSession(req, res, next) {
    const sessionToken = getCookieValue(req.headers.cookie, ADMIN_SESSION_COOKIE);
    if (!getValidAdminSession(sessionToken)) {
        return res.sendStatus(401);
    }
    next();
}

// Las suscripciones están en memoria y las alertas se envían en paralelo.
async function sendSosPushNotifications(userId) {
    const payload = JSON.stringify({
        title: '¡ALERTA SOS!',
        body: `Usuario ${userId} ha activado el SOS`,
        url: ADMIN_ROUTE
    });

    await Promise.all(pushSubscriptions.map(async (subscription) => {
        try {
            await webpush.sendNotification(subscription, payload);
        } catch (error) {
            console.error('No se pudo enviar una notificación push:', error);
            if (error.statusCode === 404 || error.statusCode === 410) {
                const index = pushSubscriptions.findIndex(
                    (savedSubscription) => savedSubscription.endpoint === subscription.endpoint
                );
                if (index !== -1) {
                    pushSubscriptions.splice(index, 1);
                }
            }
        }
    }));
}

function renderAdminLogin(errorMessage = '') {
    const error = errorMessage
        ? '<p class="error" role="alert">Contrase&ntilde;a incorrecta</p>'
        : '';
    return `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Acceso privado | UbicacionGPS</title>
    <style>
        * { box-sizing: border-box; font-family: Arial, Helvetica, sans-serif; }
        body { min-height: 100vh; display: grid; place-items: center; margin: 0; padding: 20px; background: #f4f4f4; color: #263238; }
        main { width: min(100%, 360px); padding: 26px; border-radius: 12px; background: #fff; box-shadow: 0 5px 22px rgba(0, 0, 0, 0.14); }
        h1 { margin: 0 0 8px; font-size: 22px; }
        p { color: #607d8b; font-size: 14px; }
        label { display: block; margin: 18px 0 6px; font-size: 14px; font-weight: 700; }
        input { width: 100%; padding: 11px 12px; border: 1px solid #cfd8dc; border-radius: 7px; font-size: 16px; }
        button { width: 100%; margin-top: 14px; padding: 11px; border: 0; border-radius: 7px; background: #1e88e5; color: #fff; cursor: pointer; font-size: 15px; font-weight: 700; }
        button:hover { background: #1565c0; }
        .error { color: #c62828; font-weight: 700; }
    </style>
</head>
<body>
    <main>
        <h1>Panel privado</h1>
        <p>Ingresa la contrase&ntilde;a para continuar.</p>
        ${error}
        <form method="post" action="${ADMIN_ROUTE}">
            <label for="password">Contrase&ntilde;a</label>
            <input id="password" name="password" type="password" autocomplete="current-password" required autofocus>
            <button type="submit">Iniciar sesi&oacute;n</button>
        </form>
    </main>
</body>
</html>`;
}

io.use((socket, next) => {
    const isAdminRequest = socket.handshake.auth.isAdmin === true;
    const sessionToken = getCookieValue(socket.handshake.headers.cookie, ADMIN_SESSION_COOKIE);
    if (isAdminRequest && !getValidAdminSession(sessionToken)) {
        return next(new Error('Sesión de administrador inválida o expirada.'));
    }

    socket.data.isAdmin = isAdminRequest;
    next();
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

// Permite que la app nativa consulte el autocompletado desde su propio origen.
app.use('/api/geocode', (req, res, next) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(204);
    }
    next();
});

app.get('/api/geocode/autocomplete', async (req, res) => {
    const apiKey = process.env.GEOAPIFY_API_KEY;
    if (!apiKey) {
        return res.status(503).json({ error: 'El servicio de búsqueda no está configurado.' });
    }

    const query = typeof req.query.text === 'string' ? req.query.text.trim() : '';
    const type = typeof req.query.type === 'string' ? req.query.type : '';
    const hasLatitude = req.query.latitude !== undefined;
    const hasLongitude = req.query.longitude !== undefined;
    const latitude = typeof req.query.latitude === 'string' ? Number(req.query.latitude) : Number.NaN;
    const longitude = typeof req.query.longitude === 'string' ? Number(req.query.longitude) : Number.NaN;
    if (!query
        || query.length > 200
        || (type && type !== 'city')
        || hasLatitude !== hasLongitude
        || (hasLatitude && (!Number.isFinite(latitude) || latitude < -90 || latitude > 90))
        || (hasLongitude && (!Number.isFinite(longitude) || longitude < -180 || longitude > 180))) {
        return res.status(400).json({ error: 'La búsqueda no es válida.' });
    }

    const now = Date.now();
    const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
    const rateLimit = geocodeRateLimits.get(clientIp);
    if (rateLimit && rateLimit.resetAt > now && rateLimit.count >= 120) {
        res.set('Retry-After', String(Math.ceil((rateLimit.resetAt - now) / 1000)));
        return res.status(429).json({ error: 'Se alcanzó el límite temporal de búsquedas.' });
    }
    if (!rateLimit || rateLimit.resetAt <= now) {
        geocodeRateLimits.set(clientIp, { count: 1, resetAt: now + 60_000 });
    } else {
        rateLimit.count += 1;
    }

    const geocodeUrl = new URL('https://api.geoapify.com/v1/geocode/autocomplete');
    geocodeUrl.searchParams.set('text', query);
    geocodeUrl.searchParams.set('apiKey', apiKey);
    geocodeUrl.searchParams.set('limit', '5');
    if (type) {
        geocodeUrl.searchParams.set('type', type);
    }
    if (hasLatitude && hasLongitude) {
        geocodeUrl.searchParams.set('bias', `proximity:${longitude},${latitude}`);
    }

    try {
        const response = await fetch(geocodeUrl, {
            headers: { Accept: 'application/json' }
        });
        if (!response.ok) {
            console.error('Geoapify rechazó la búsqueda con el estado:', response.status);
            return res.status(502).json({ error: 'El proveedor de búsqueda no pudo completar la consulta.' });
        }

        res.set('Cache-Control', 'private, max-age=30');
        return res.json(await response.json());
    } catch (error) {
        console.error('No se pudo consultar Geoapify:', error);
        return res.status(502).json({ error: 'No se pudo conectar con el proveedor de búsqueda.' });
    }
});

// Solo una sesión válida del panel puede consultar la clave o registrar dispositivos.
app.get('/vapid-public-key', requireAdminSession, (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ publicKey: vapidKeys.publicKey });
});

app.post('/subscribe', requireAdminSession, (req, res) => {
    const subscription = req.body;
    if (!subscription
        || typeof subscription.endpoint !== 'string'
        || !subscription.endpoint
        || typeof subscription.keys?.p256dh !== 'string'
        || typeof subscription.keys?.auth !== 'string') {
        return res.status(400).json({ error: 'Suscripción push no válida.' });
    }

    const existingIndex = pushSubscriptions.findIndex(
        (savedSubscription) => savedSubscription.endpoint === subscription.endpoint
    );
    if (existingIndex === -1) {
        pushSubscriptions.push(subscription);
    } else {
        pushSubscriptions[existingIndex] = subscription;
    }
    res.sendStatus(201);
});

app.get('/admin', (req, res) => {
    res.sendStatus(404);
});

app.get(ADMIN_ROUTE, (req, res) => {
    const sessionToken = getCookieValue(req.headers.cookie, ADMIN_SESSION_COOKIE);
    if (!getValidAdminSession(sessionToken)) {
        return res.status(200).type('html').send(renderAdminLogin());
    }

    res.set('Cache-Control', 'no-store');
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.post(ADMIN_ROUTE, (req, res) => {
    if (req.body.password !== ADMIN_PASSWORD) {
        return res.status(401).type('html').send(renderAdminLogin('Contraseña incorrecta'));
    }

    const now = Date.now();
    for (const [token, expiresAt] of adminSessions) {
        if (expiresAt <= now) {
            adminSessions.delete(token);
        }
    }

    const sessionToken = crypto.randomBytes(32).toString('hex');
    adminSessions.set(sessionToken, now + ADMIN_SESSION_TTL);
    const secureCookie = req.secure ? '; Secure' : '';
    res.set(
        'Set-Cookie',
        `${ADMIN_SESSION_COOKIE}=${sessionToken}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${ADMIN_SESSION_TTL / 1000}${secureCookie}`
    );
    res.redirect(303, ADMIN_ROUTE);
});

app.get('/admin.html', (req, res) => {
    res.sendStatus(404);
});

app.use(express.static(path.join(__dirname, 'public')));

function notifyAdmins(event, data) {
    admins.forEach((adminId) => {
        io.to(adminId).emit(event, data);
    });
}

function getUserSnapshot(user) {
    return {
        socketId: user.socketId,
        displayName: user.displayName || '',
        roomCode: user.roomCode,
        lastLat: user.lastLat,
        lastLng: user.lastLng,
        lastUpdate: user.lastUpdate,
        history: user.history.map((location) => ({ ...location }))
    };
}

function distanceInMeters(latitude1, longitude1, latitude2, longitude2) {
    const radians = (degrees) => degrees * Math.PI / 180;
    const earthRadius = 6371000;
    const latitudeDifference = radians(latitude2 - latitude1);
    const longitudeDifference = radians(longitude2 - longitude1);
    // Haversine calcula la distancia geodésica entre dos coordenadas.
    const haversine = Math.sin(latitudeDifference / 2) ** 2
        + Math.cos(radians(latitude1)) * Math.cos(radians(latitude2))
        * Math.sin(longitudeDifference / 2) ** 2;

    return 2 * earthRadius * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function checkGeofences(user) {
    geofences.forEach((geofence) => {
        const isInside = distanceInMeters(
            user.lastLat,
            user.lastLng,
            geofence.lat,
            geofence.lng
        ) <= geofence.radius;
        const wasInitialized = user.checkedGeofences.has(geofence.id);
        const wasInside = user.insideGeofences.has(geofence.id);

        user.checkedGeofences.add(geofence.id);
        if (isInside) {
            user.insideGeofences.add(geofence.id);
        } else {
            user.insideGeofences.delete(geofence.id);
        }

        if (!isInside && (!wasInitialized || !wasInside)) {
            return;
        }
        if (wasInitialized && isInside === wasInside) {
            return;
        }

        notifyAdmins('geofence-alert', {
            socketId: user.socketId,
            userName: user.displayName || user.socketId,
            name: geofence.name,
            action: isInside ? 'entró' : 'salió',
            lat: user.lastLat,
            lng: user.lastLng,
            timestamp: user.lastUpdate
        });
    });
}

function createTrackedUser(userId) {
    return {
        socketId: userId,
        displayName: '',
        roomCode: 'global',
        transport: 'walking',
        lastLat: null,
        lastLng: null,
        lastUpdate: null,
        history: [],
        insideGeofences: new Set(),
        checkedGeofences: new Set()
    };
}

const allowedTransports = new Set(['walking', 'cycling', 'motorcycle', 'driving']);

function updateUserLocation(user, latitude, longitude, sourceSocket, transport) {
    if (allowedTransports.has(transport)) {
        user.transport = transport;
    }
    user.lastLat = latitude;
    user.lastLng = longitude;
    user.lastUpdate = new Date().toISOString();
    user.history.push({
        lat: user.lastLat,
        lng: user.lastLng,
        timestamp: user.lastUpdate
    });
    if (user.history.length > MAX_HISTORY) {
        user.history.shift();
    }

    const locationEvent = {
        id: user.socketId,
        latitude: user.lastLat,
        longitude: user.lastLng,
        transport: user.transport
    };
    if (sourceSocket) {
        sourceSocket.to(user.roomCode).emit('receive-location', locationEvent);
    } else {
        io.to(user.roomCode).emit('receive-location', locationEvent);
    }
    notifyAdmins('admin-update', getUserSnapshot(user));
    checkGeofences(user);
}

app.post('/update-location', (req, res) => {
    if (!req.secure && req.hostname !== 'localhost' && req.hostname !== '127.0.0.1') {
        return res.status(426).json({ error: 'El endpoint de ubicación requiere HTTPS.' });
    }

    const body = req.body || {};
    const location = body.location || {};
    const deviceId = req.get('X-Device-Id') || body.deviceId;
    const lat = body.lat ?? location.latitude;
    const lng = body.lng ?? location.longitude;
    if (typeof deviceId !== 'string' || !/^[\w-]{16,80}$/.test(deviceId)
        || !Number.isFinite(lat) || !Number.isFinite(lng)
        || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        return res.status(400).json({ error: 'Identificador o coordenadas no válidos.' });
    }

    let user = users.get(deviceId);
    if (!user) {
        user = createTrackedUser(deviceId);
        users.set(deviceId, user);
    }
    updateUserLocation(user, lat, lng, undefined, body.transport ?? location.transport);
    res.sendStatus(204);
});

io.on('connection', (socket) => {
    console.log('Usuario conectado:', socket.id);
    const isAdminConnection = socket.data.isAdmin === true;
    const roomCode = 'global';
    let isAdmin = isAdminConnection;
    const clientId = socket.handshake.auth.clientId;
    const hasPersistentUserId = !isAdminConnection
        && typeof clientId === 'string'
        && /^[\w-]{16,80}$/.test(clientId);
    const userId = hasPersistentUserId ? clientId : socket.id;
    socket.data.userId = userId;
    socket.data.hasPersistentUserId = hasPersistentUserId;

    if (isAdminConnection) {
        admins.add(socket.id);
    }

    socket.on('join-admin', (callback) => {
        if (!isAdminConnection) {
            if (typeof callback === 'function') {
                callback({ ok: false, error: 'Se requiere iniciar sesión como administrador.' });
            }
            return;
        }

        isAdmin = true;
        admins.add(socket.id);
        socket.emit('admin-init', {
            users: Array.from(users.values(), getUserSnapshot),
            geofences
        });
        if (typeof callback === 'function') {
            callback({ ok: true });
        }
    });

    if (!isAdminConnection) {
        socket.join(roomCode);
        let user = users.get(userId);
        if (!user) {
            user = createTrackedUser(userId);
            users.set(userId, user);
        }
        notifyAdmins('admin-update', getUserSnapshot(user));
    }

    socket.on('save-geofence', (data, callback) => {
        if (!isAdmin || !data || typeof data.name !== 'string'
            || !data.name.trim()
            || !Number.isFinite(data.lat)
            || !Number.isFinite(data.lng)
            || !Number.isFinite(data.radius)
            || data.lat < -90 || data.lat > 90
            || data.lng < -180 || data.lng > 180
            || data.radius <= 0) {
            if (typeof callback === 'function') {
                callback({ ok: false, error: 'Datos de geocerca no válidos.' });
            }
            return;
        }

        const geofence = {
            id: crypto.randomUUID(),
            name: data.name.trim(),
            lat: data.lat,
            lng: data.lng,
            radius: data.radius
        };
        geofences.push(geofence);
        notifyAdmins('geofence-added', geofence);
        if (typeof callback === 'function') {
            callback({ ok: true, geofence });
        }
    });

    socket.on('send-sos', (callback) => {
        console.log('SOS recibido en el servidor de:', socket.id);
        if (isAdmin || isAdminConnection) {
            if (typeof callback === 'function') {
                callback({ ok: false, error: 'Solo usuarios pueden enviar SOS.' });
            }
            return;
        }

        const user = users.get(userId);
        console.log('Usuarios administradores conectados:', admins.size);
        notifyAdmins('sos-alert', {
            socketId: userId,
            userName: user && user.displayName ? user.displayName : userId,
            lat: user && Number.isFinite(user.lastLat) ? user.lastLat : null,
            lng: user && Number.isFinite(user.lastLng) ? user.lastLng : null,
            lastLat: user && Number.isFinite(user.lastLat) ? user.lastLat : null,
            lastLng: user && Number.isFinite(user.lastLng) ? user.lastLng : null,
            lastUpdate: user?.lastUpdate || null
        });
        sendSosPushNotifications(userId);
        if (typeof callback === 'function') {
            callback({ ok: true });
        }
    });

    socket.on('send-location', (data) => {
        if (isAdmin || isAdminConnection || !data
            || !Number.isFinite(data.latitude)
            || !Number.isFinite(data.longitude)
            || data.latitude < -90
            || data.latitude > 90
            || data.longitude < -180
            || data.longitude > 180) {
            return;
        }

        const user = users.get(userId);
        if (!user) {
            return;
        }

        updateUserLocation(user, data.latitude, data.longitude, socket, data.transport);
    });

    socket.on('set-transport', (transport) => {
        if (isAdmin || isAdminConnection || !allowedTransports.has(transport)) {
            return;
        }

        const user = users.get(userId);
        if (user) {
            user.transport = transport;
        }
    });

    socket.on('rename-device', (data, callback) => {
        const name = typeof data?.name === 'string' ? data.name.trim() : '';
        const targetId = typeof data?.socketId === 'string' ? data.socketId : '';
        const user = isAdmin && targetId ? users.get(targetId) : null;
        if (!user || !name || name.length > 40) {
            if (typeof callback === 'function') {
                callback({
                    ok: false,
                    error: 'Selecciona un dispositivo y usa un nombre de 1 a 40 caracteres.'
                });
            }
            return;
        }

        user.displayName = name;
        const snapshot = getUserSnapshot(user);
        notifyAdmins('admin-update', snapshot);
        if (typeof callback === 'function') {
            callback({ ok: true, user: snapshot });
        }
    });

    socket.on('stop-tracking', (callback) => {
        if (socket.data.hasPersistentUserId && users.has(userId)) {
            users.delete(userId);
            socket.to(roomCode).emit('user-disconnected', userId);
            notifyAdmins('admin-user-left', userId);
        }
        if (typeof callback === 'function') {
            callback({ ok: true });
        }
    });

    socket.on('disconnect', () => {
        admins.delete(socket.id);
        if (!isAdminConnection) {
            if (!socket.data.hasPersistentUserId) {
                socket.to(roomCode).emit('user-disconnected', userId);
                users.delete(userId);
                notifyAdmins('admin-user-left', userId);
            }
        }
    });
});

const port = process.env.PORT || 3000;
server.listen(port, () => {
    console.log(`Servidor de UbicacionGPS en el puerto ${port}`);
});
