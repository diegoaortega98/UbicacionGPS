const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const crypto = require('crypto');

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
const ADMIN_PASSWORD = process.env.ADMIN_KEY || 'gpsadmin2026';
const ADMIN_ROUTE = '/panel-privado-gps';
const ADMIN_SESSION_COOKIE = 'gps_admin_session';
const ADMIN_SESSION_TTL = 8 * 60 * 60 * 1000;
// Las sesiones no persisten al reiniciar el servidor y caducan después de ocho horas.
const adminSessions = new Map();
const MAX_HISTORY = 50;

app.set('trust proxy', 1);
app.use(express.urlencoded({ extended: false }));

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
            userName: user.socketId,
            name: geofence.name,
            action: isInside ? 'entró' : 'salió',
            lat: user.lastLat,
            lng: user.lastLng,
            timestamp: user.lastUpdate
        });
    });
}

io.on('connection', (socket) => {
    console.log('Usuario conectado:', socket.id);
    const isAdminConnection = socket.data.isAdmin === true;
    const roomCode = 'global';
    let isAdmin = false;

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
        const user = {
            socketId: socket.id,
            roomCode,
            lastLat: null,
            lastLng: null,
            lastUpdate: null,
            history: [],
            insideGeofences: new Set(),
            checkedGeofences: new Set()
        };
        users.set(socket.id, user);
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
        console.log('SOS recibido de:', socket.id);
        if (isAdmin || isAdminConnection) {
            if (typeof callback === 'function') {
                callback({ ok: false, error: 'Solo usuarios pueden enviar SOS.' });
            }
            return;
        }

        const user = users.get(socket.id);
        notifyAdmins('sos-alert', {
            socketId: socket.id,
            lat: user && Number.isFinite(user.lastLat) ? user.lastLat : null,
            lng: user && Number.isFinite(user.lastLng) ? user.lastLng : null,
            lastLat: user && Number.isFinite(user.lastLat) ? user.lastLat : null,
            lastLng: user && Number.isFinite(user.lastLng) ? user.lastLng : null,
            lastUpdate: user?.lastUpdate || null
        });
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

        const user = users.get(socket.id);
        if (!user) {
            return;
        }

        user.lastLat = data.latitude;
        user.lastLng = data.longitude;
        user.lastUpdate = new Date().toISOString();
        user.history.push({
            lat: user.lastLat,
            lng: user.lastLng,
            timestamp: user.lastUpdate
        });
        // Limita el historial para mantener controlado el uso de memoria.
        if (user.history.length > MAX_HISTORY) {
            user.history.shift();
        }

        socket.to(roomCode).emit('receive-location', {
            id: socket.id,
            latitude: user.lastLat,
            longitude: user.lastLng
        });
        notifyAdmins('admin-update', getUserSnapshot(user));
        checkGeofences(user);
    });

    socket.on('disconnect', () => {
        admins.delete(socket.id);
        if (!isAdminConnection) {
            socket.to(roomCode).emit('user-disconnected', socket.id);
            users.delete(socket.id);
            notifyAdmins('admin-user-left', socket.id);
        }
    });
});

const port = process.env.PORT || 3000;
server.listen(port, () => {
    console.log(`Servidor de UbicacionGPS en el puerto ${port}`);
});
