const map = L.map('map').setView([10.3910, -75.4794], 13);
const authPanel = document.getElementById('auth-panel');
const userPanel = document.getElementById('user-panel');
const authMessage = document.getElementById('auth-message');
const appMessage = document.getElementById('app-message');
const addressSearchFields = {
    origin: {
        input: document.getElementById('origin-search'),
        suggestions: document.getElementById('origin-suggestions')
    },
    destination: {
        input: document.getElementById('destination-search'),
        suggestions: document.getElementById('destination-suggestions')
    }
};
const searchCityLabel = document.getElementById('search-city');
const currentCityInput = document.getElementById('current-city');
const markers = new Map();
const OpenStreetMapProvider = window.GeoSearch?.OpenStreetMapProvider;
const baseGeocodingParams = {
    'accept-language': 'es',
    addressdetails: 1,
    countrycodes: 'co',
    format: 'jsonv2'
};
let geocodeProvider = OpenStreetMapProvider
    ? new OpenStreetMapProvider({ params: { ...baseGeocodingParams } })
    : null;
let searchCityBounds = null;
const addressMarkers = { origin: null, destination: null };
const searchTimers = { origin: null, destination: null };
const searchControllers = { origin: null, destination: null };
const searchRequestIds = { origin: 0, destination: 0 };
let lastSearchStartedAt = 0;
let routeControl;
let activeTrip = null;
let acceptedDriverContact = null;
let calls = null;
let chat = null;
let call = null;
let localStream = null;
let remoteDescriptionSet = false;
let queuedCandidates = [];
let joinedTripId = null;
let fcmMessaging = null;
let fcmOnMessageRegistered = false;

function showContactWidget(open = true) {
    const widget = document.getElementById('contact-widget');
    const toggle = document.getElementById('contact-widget-toggle');
    toggle.hidden = false;
    widget.hidden = false;
    widget.setAttribute('aria-hidden', 'false');
    if (open) requestAnimationFrame(() => widget.classList.add('is-open'));
}

function closeContactWidget() {
    const widget = document.getElementById('contact-widget');
    widget.classList.remove('is-open');
    widget.setAttribute('aria-hidden', 'true');
}

function hideContactWidget() {
    closeContactWidget();
    document.getElementById('contact-widget-toggle').hidden = true;
    const widget = document.getElementById('contact-widget');
    window.setTimeout(() => {
        if (!widget.classList.contains('is-open')) widget.hidden = true;
    }, 220);
}

function setDriverContact(contact) {
    acceptedDriverContact = contact;
    const link = document.getElementById('cell-call');
    const person = document.getElementById('contact-widget-person');
    if (!contact) {
        link.hidden = true;
        link.removeAttribute('href');
        person.textContent = '';
        return;
    }

    person.textContent = contact.nombre || '';
    const digits = (contact.telefono || '').replace(/\D/g, '');
    if (digits.length >= 7) {
        link.href = `tel:+${digits}`;
        link.hidden = false;
    } else {
        link.hidden = true;
        link.removeAttribute('href');
    }
}

for (const key of ['gps-token', 'gps-user']) {
    if (!localStorage.getItem(key) && sessionStorage.getItem(key)) {
        localStorage.setItem(key, sessionStorage.getItem(key));
    }
    sessionStorage.removeItem(key);
}

L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 20
}).addTo(map);

function boundsToViewbox(bounds) {
    if (!bounds) return null;
    const southWest = bounds[0];
    const northEast = bounds[1];
    return `${southWest[1]},${northEast[0]},${northEast[1]},${southWest[0]}`;
}

function createSearchProvider(bounds = null) {
    const params = { ...baseGeocodingParams };
    const viewbox = boundsToViewbox(bounds);
    if (viewbox) {
        params.viewbox = viewbox;
        params.bounded = 0;
    }
    return new OpenStreetMapProvider({ params });
}

function cityNameFrom(result) {
    const address = result?.raw?.address;
    return address?.city || address?.town || address?.municipality || address?.county || null;
}

function normalizePlaceName(value) {
    return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase('es');
}

function isCityResult(result) {
    return ['city', 'town', 'village', 'municipality'].includes(result.raw?.addresstype)
        || (result.raw?.class === 'place' && ['city', 'town', 'village', 'municipality'].includes(result.raw?.type));
}

async function applyCityBias(city, qualifier = '') {
    const cityQuery = [city, qualifier].filter(Boolean).join(', ');
    const results = await createSearchProvider().search({ query: cityQuery });
    const normalizedCity = normalizePlaceName(city);
    const cityResult = results.find((result) => {
        const resultName = result.raw?.name || result.raw?.display_name?.split(',')[0] || '';
        return normalizePlaceName(resultName) === normalizedCity
            && result.bounds;
    }) || results.find((result) => isCityResult(result) && result.bounds);
    if (!cityResult) throw new Error('No se encontraron límites geográficos para esa ciudad.');

    searchCityBounds = cityResult.bounds;
    geocodeProvider = createSearchProvider(searchCityBounds);
    currentCityInput.value = city;
    searchCityLabel.textContent = searchCityBounds
        ? `Buscando en: ${city}`
        : `Ciudad seleccionada: ${city}. No hay límites disponibles para priorizar.`;
}

async function detectSearchCity(position, knownPlace) {
    if (!geocodeProvider) {
        searchCityLabel.textContent = 'El buscador de direcciones no está disponible.';
        return;
    }

    try {
        const place = knownPlace === undefined
            ? (await geocodeProvider.reverse({ lat: position.lat, lng: position.lng }))[0]
            : knownPlace;
        if (!place) {
            searchCityLabel.textContent = 'No se pudo detectar una ciudad.';
            return;
        }

        const cityName = cityNameFrom(place);
        if (cityName) {
            currentCityInput.value = cityName;
            try {
                const qualifier = [place.raw?.address?.state, place.raw?.address?.country].filter(Boolean).join(', ');
                await applyCityInput(cityName, qualifier);
            } catch (error) {
                console.warn('No se pudieron obtener los límites de la ciudad:', error);
                searchCityBounds = place.bounds;
                geocodeProvider = createSearchProvider(searchCityBounds);
                currentCityInput.value = cityName;
                searchCityLabel.textContent = `Buscando en: ${cityName}`;
            }
        } else {
            searchCityBounds = place.bounds;
            geocodeProvider = createSearchProvider(searchCityBounds);
            searchCityLabel.textContent = 'Ciudad no identificada; priorizando esta zona.';
        }
    } catch (error) {
        console.warn('No se pudo detectar la ciudad mediante geocodificación inversa:', error);
        searchCityLabel.textContent = 'No se pudo detectar la ciudad; las búsquedas se limitarán a Colombia.';
    }
}

async function applyCityInput(city = currentCityInput.value.trim(), qualifier = '') {
    if (!geocodeProvider) throw new Error('El buscador de direcciones no está disponible.');
    if (!city) throw new Error('Escribe una ciudad para priorizar las direcciones.');

    for (const prefix of Object.keys(addressSearchFields)) {
        cancelAddressSearch(prefix);
        hideAddressSuggestions(prefix);
    }

    await applyCityBias(city, qualifier);
}

function detectInitialSearchCity() {
    const fallbackPosition = map.getCenter();
    if (!navigator.geolocation) {
        detectSearchCity(fallbackPosition);
        return;
    }

    navigator.geolocation.getCurrentPosition(
        ({ coords }) => detectSearchCity({ lat: coords.latitude, lng: coords.longitude }),
        () => detectSearchCity(fallbackPosition),
        { enableHighAccuracy: false, maximumAge: 300000, timeout: 10000 }
    );
}

function hideAddressSuggestions(prefix) {
    const field = addressSearchFields[prefix];
    field.suggestions.hidden = true;
    field.input.setAttribute('aria-expanded', 'false');
}

function cancelAddressSearch(prefix) {
    clearTimeout(searchTimers[prefix]);
    if (searchControllers[prefix]) searchControllers[prefix].abort();
    searchRequestIds[prefix] += 1;
}

function addressResultIsInCity(result) {
    if (!searchCityBounds) return false;
    const [[south, west], [north, east]] = searchCityBounds;
    return result.y >= south && result.y <= north && result.x >= west && result.x <= east;
}

function selectAddress(prefix, result) {
    cancelAddressSearch(prefix);
    const field = addressSearchFields[prefix];
    field.input.value = result.label;
    document.getElementById(`${prefix}-lat`).value = result.y;
    document.getElementById(`${prefix}-lng`).value = result.x;
    if (addressMarkers[prefix]) addressMarkers[prefix].remove();
    addressMarkers[prefix] = L.marker([result.y, result.x]).addTo(map).bindPopup(result.label);
    map.setView([result.y, result.x], Math.max(map.getZoom(), 15));
    addressMarkers[prefix].openPopup();
    hideAddressSuggestions(prefix);
}

function renderAddressSuggestions(prefix, results) {
    const field = addressSearchFields[prefix];
    field.suggestions.replaceChildren();
    if (searchCityBounds) {
        results.sort((first, second) => Number(addressResultIsInCity(second)) - Number(addressResultIsInCity(first)));
    }
    if (!results.length) {
        const empty = document.createElement('p');
        empty.className = 'destination-suggestion-empty';
        empty.textContent = 'No se encontraron direcciones.';
        field.suggestions.append(empty);
    } else {
        for (const result of results.slice(0, 6)) {
            const option = document.createElement('button');
            option.type = 'button';
            option.className = 'destination-suggestion';
            option.setAttribute('role', 'option');
            option.textContent = result.label;
            option.addEventListener('click', () => selectAddress(prefix, result));
            field.suggestions.append(option);
        }
    }
    field.suggestions.hidden = false;
    field.input.setAttribute('aria-expanded', 'true');
}

for (const [prefix, field] of Object.entries(addressSearchFields)) {
    field.input.addEventListener('input', () => {
        clearTimeout(searchTimers[prefix]);
        if (searchControllers[prefix]) searchControllers[prefix].abort();
        searchRequestIds[prefix] += 1;
        const requestId = searchRequestIds[prefix];
        document.getElementById(`${prefix}-lat`).value = '';
        document.getElementById(`${prefix}-lng`).value = '';
        if (addressMarkers[prefix]) {
            addressMarkers[prefix].remove();
            addressMarkers[prefix] = null;
        }

        const query = field.input.value.trim();
        if (query.length < 3 || !geocodeProvider) {
            hideAddressSuggestions(prefix);
            return;
        }

        searchTimers[prefix] = setTimeout(async () => {
            const delay = Math.max(0, 1000 - (Date.now() - lastSearchStartedAt));
            const loading = document.createElement('p');
            loading.className = 'destination-suggestion-empty';
            loading.setAttribute('role', 'status');
            loading.textContent = 'Buscando...';
            field.suggestions.replaceChildren(loading);
            field.suggestions.hidden = false;
            field.input.setAttribute('aria-expanded', 'true');
            if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
            if (requestId !== searchRequestIds[prefix]) return;

            searchControllers[prefix] = new AbortController();
            lastSearchStartedAt = Date.now();
            try {
                const searchQuery = `${query}, Colombia`;
                const provider = geocodeProvider;
                const results = await provider.search({
                    query: searchQuery,
                    signal: searchControllers[prefix].signal
                });
                if (requestId === searchRequestIds[prefix]) renderAddressSuggestions(prefix, results);
            } catch (error) {
                if (error.name !== 'AbortError' && requestId === searchRequestIds[prefix]) {
                    showMessage(appMessage, 'No se pudo buscar la dirección. Inténtalo de nuevo.');
                    hideAddressSuggestions(prefix);
                }
            }
        }, 350);
    });

    field.input.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') hideAddressSuggestions(prefix);
    });
}

document.addEventListener('click', (event) => {
    for (const [prefix, field] of Object.entries(addressSearchFields)) {
        if (!field.suggestions.contains(event.target) && event.target !== field.input) {
            hideAddressSuggestions(prefix);
        }
    }
});

document.getElementById('apply-city').addEventListener('click', async () => {
    const city = currentCityInput.value.trim();
    if (!city) {
        showMessage(appMessage, 'Escribe una ciudad para priorizar las direcciones.');
        currentCityInput.focus();
        return;
    }

    try {
        await applyCityInput(city);
        showMessage(appMessage, '');
    } catch (error) {
        searchCityBounds = null;
        geocodeProvider = createSearchProvider();
        searchCityLabel.textContent = 'No se pudieron obtener límites; búsqueda sin prioridad geográfica.';
        showMessage(appMessage, `No se pudo aplicar la ciudad: ${error.message}`);
    }
});

currentCityInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
        event.preventDefault();
        document.getElementById('apply-city').click();
    }
});

function showMessage(element, message = '') {
    element.textContent = message;
}

async function api(path, options = {}) {
    const token = localStorage.getItem('gps-token');
    const response = await fetch(path, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...options.headers
        }
    });

    if (!response.ok) {
        const problem = await response.json().catch(() => null);
        throw new Error(problem?.detail || problem?.title || `Error HTTP ${response.status}`);
    }

    return response.status === 204 ? null : response.json();
}

function formValues(form) {
    return Object.fromEntries(new FormData(form).entries());
}

document.getElementById('show-login').addEventListener('click', () => {
    document.getElementById('login-form').hidden = false;
    document.getElementById('register-form').hidden = true;
    document.getElementById('show-login').classList.add('active');
    document.getElementById('show-register').classList.remove('active');
    showMessage(authMessage);
});

document.getElementById('show-register').addEventListener('click', () => {
    document.getElementById('login-form').hidden = true;
    document.getElementById('register-form').hidden = false;
    document.getElementById('show-register').classList.add('active');
    document.getElementById('show-login').classList.remove('active');
    showMessage(authMessage);
});

document.getElementById('register-role').addEventListener('change', (event) => {
    document.getElementById('driver-fields').hidden = event.target.value !== 'Conductor';
});

document.getElementById('register-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const values = formValues(event.currentTarget);
    try {
        const account = await api('/api/auth/register', {
            method: 'POST',
            body: JSON.stringify({
                email: values.email,
                password: values.password,
                telefono: values.telefono,
                rol: values.rol,
                vehiculo: values.vehiculo || null,
                placa: values.placa || null
            })
        });
        window.alert('Usuario creado');
        await loginSucceeded(account);
    } catch (error) {
        showMessage(authMessage, error.message);
    }
});

document.getElementById('contact-widget-toggle').addEventListener('click', () => showContactWidget(true));
document.getElementById('contact-widget-close').addEventListener('click', closeContactWidget);

document.getElementById('login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const values = formValues(event.currentTarget);
    try {
        const account = await api('/api/auth/login', {
            method: 'POST',
            body: JSON.stringify(values)
        });
        await loginSucceeded(account);
    } catch (error) {
        showMessage(authMessage, error.message);
    }
});

async function loginSucceeded(account) {
    localStorage.setItem('gps-token', account.token);
    localStorage.setItem('gps-user', JSON.stringify({
        usuarioId: account.usuarioId,
        email: account.email,
        rol: account.rol
    }));
    await showAuthenticatedUi();
}

async function showAuthenticatedUi() {
    const account = JSON.parse(localStorage.getItem('gps-user'));
    if (!account || !localStorage.getItem('gps-token')) return;

    authPanel.hidden = true;
    userPanel.hidden = false;
    document.getElementById('welcome').textContent = account.rol === 'Conductor'
        ? `Conductor · ${account.email}`
        : `Pasajero · ${account.email}`;
    document.getElementById('passenger-panel').hidden = account.rol !== 'Pasajero';
    document.getElementById('driver-panel').hidden = account.rol !== 'Conductor';
    document.getElementById('enable-notifications').textContent =
        sessionStorage.getItem('gps-fcm-token') ? 'Notificaciones activadas' : 'Activar notificaciones';
    showMessage(authMessage);

    try {
        await connectHubs();
        await restoreTrips(account);
        if (account.rol === 'Conductor') await loadAvailableRides();
    } catch (error) {
        showMessage(appMessage, error.message);
    }

    document.getElementById('enable-notifications').addEventListener('click', async (event) => {
        const button = event.currentTarget;
        button.disabled = true;
        try {
            if (!('Notification' in window) || !('serviceWorker' in navigator)) {
                throw new Error('Este navegador no es compatible con notificaciones web.');
            }

            const configResponse = await fetch('/api/notificaciones/config');
            if (!configResponse.ok) throw new Error(`No se pudo leer la configuración Firebase (${configResponse.status}).`);
            const firebaseConfig = await configResponse.json();
            const { apiKey, projectId, appId, messagingSenderId, vapidKey } = firebaseConfig;
            if (![apiKey, projectId, appId, messagingSenderId, vapidKey].every(Boolean)) {
                throw new Error('Firebase Messaging web no está configurado en el servidor.');
            }

            const permission = await Notification.requestPermission();
            if (permission !== 'granted') throw new Error('No se concedió permiso para las notificaciones.');

            const [{ initializeApp, getApp, getApps }, { getMessaging, getToken, onMessage }] = await Promise.all([
                import('https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js'),
                import('https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging.js')
            ]);
            const firebaseApp = getApps().some((app) => app.name === 'gps-ride-messaging')
                ? getApp('gps-ride-messaging')
                : initializeApp(firebaseConfig, 'gps-ride-messaging');
            fcmMessaging ??= getMessaging(firebaseApp);
            const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js', { scope: '/' });
            const token = await getToken(fcmMessaging, { vapidKey, serviceWorkerRegistration: registration });
            if (!token) throw new Error('Firebase no devolvió un token para este navegador.');

            await api('/api/notificaciones/token', {
                method: 'POST',
                body: JSON.stringify({ token })
            });
            sessionStorage.setItem('gps-fcm-token', token);
            button.textContent = 'Notificaciones activadas';
            showMessage(appMessage, 'Este dispositivo recibirá avisos de viajes.');

            if (!fcmOnMessageRegistered) {
                onMessage(fcmMessaging, (payload) => {
                    const title = payload.notification?.title || 'UbicacionGPS';
                    const body = payload.notification?.body || 'Tienes una actualización de tu viaje.';
                    showMessage(appMessage, `${title}: ${body}`);
                    if (payload.data?.tipo === 'NuevaSolicitud' && !document.getElementById('driver-panel').hidden) {
                        loadAvailableRides().catch((error) => showMessage(appMessage, error.message));
                    }
                });
                fcmOnMessageRegistered = true;
            }
        } catch (error) {
            showMessage(appMessage, error.message);
        } finally {
            button.disabled = false;
        }
    });
}

async function connectHub(path) {
    const hub = new signalR.HubConnectionBuilder()
        .withUrl(path, { accessTokenFactory: () => localStorage.getItem('gps-token') || '' })
        .withAutomaticReconnect()
        .build();
    await hub.start();
    return hub;
}

async function connectHubs() {
    const status = document.getElementById('connection-status');
    status.textContent = 'Conectando...';
    [calls, chat, viajes].filter(Boolean).forEach((hub) => hub.stop());
    [calls, chat, viajes] = await Promise.all([
        connectHub('/hubs/llamada'),
        connectHub('/hubs/chat'),
        connectHub('/hubs/viajes')
    ]);
    status.textContent = 'Conectado';

    viajes.on('NuevaSolicitud', (request) => {
        addAvailableRide(request);
        showMessage(appMessage, 'Hay una nueva solicitud de viaje.');
    });
    viajes.on('ViajeAceptado', (event) => {
        if (activeTrip?.id !== event.viajeId
            || JSON.parse(localStorage.getItem('gps-user'))?.rol !== 'Pasajero') return;

        const contact = {
            viajeId: event.viajeId,
            nombre: event.conductorNombre,
            telefono: event.conductorTelefono
        };
        setDriverContact(contact);
        const panel = document.getElementById('passenger-trip');
        const title = panel.querySelector('strong');
        const details = panel.querySelector('p');
        if (title) title.textContent = 'Estado: Conductor en camino';
        if (details) details.textContent = contact.nombre
            ? `Conductor en camino · ${contact.nombre}${activeTrip.vehiculo ? ` · ${activeTrip.vehiculo}` : ''}${activeTrip.placa ? ` · ${activeTrip.placa}` : ''}`
            : 'Conductor en camino';
        showContactWidget(true);
        showMessage(appMessage, 'Un conductor aceptó tu viaje.');
    });
    viajes.on('ActualizarViaje', (trip) => handleTripUpdate(trip));
    chat.on('RecibirMensaje', (message) => renderMessage(message));
    calls.on('OfertaLlamada', receiveOffer);
    calls.on('RespuestaLlamada', receiveAnswer);
    calls.on('CandidatoIce', receiveCandidate);

    [calls, chat, viajes].forEach((hub) => {
        hub.onreconnecting(() => { status.textContent = 'Reconectando...'; });
        hub.onreconnected(async () => {
            status.textContent = 'Conectado';
            if (activeTrip) {
                joinedTripId = null;
                await joinTripHubs(activeTrip.id);
            }
        });
        hub.onclose(() => { status.textContent = 'Desconectado'; });
    });
}

async function restoreTrips(account) {
    const trips = await api('/api/viajes/mios');
    const current = trips.find((trip) => ['Solicitado', 'Aceptado', 'EnCurso'].includes(trip.estado));
    if (!current) return;
    activeTrip = current;
    showTrip(current);
    if (account.rol === 'Conductor' && current.estado === 'Solicitado') {
        activeTrip = null;
        joinedTripId = null;
        hideTrip();
    }
}

async function joinTripHubs(tripId) {
    if (joinedTripId === tripId) return;
    await Promise.all([
        viajes.invoke('UnirseViaje', tripId),
        chat.invoke('UnirseChat', tripId),
        calls.invoke('UnirseLlamada', tripId)
    ]);
    joinedTripId = tripId;
}

async function loadAvailableRides() {
    const requests = await api('/api/viajes/disponibles');
    const container = document.getElementById('available-rides');
    container.replaceChildren();
    requests.forEach(addAvailableRide);
}

function addAvailableRide(request) {
    if (document.getElementById('driver-panel').hidden || request.id === activeTrip?.id) return;
    const container = document.getElementById('available-rides');
    if ([...container.querySelectorAll('[data-ride-id]')].some((item) => item.dataset.rideId === request.id)) return;
    const card = document.createElement('article');
    card.className = 'ride-item';
    card.dataset.rideId = request.id;
    const detail = document.createElement('span');
    detail.textContent = `Origen ${Number(request.origenLat).toFixed(4)}, ${Number(request.origenLng).toFixed(4)} · destino ${Number(request.destinoLat).toFixed(4)}, ${Number(request.destinoLng).toFixed(4)} · $${request.precio}`;
    const button = document.createElement('button');
    button.className = 'primary';
    button.type = 'button';
    button.textContent = 'Aceptar viaje';
    button.addEventListener('click', async () => {
        button.disabled = true;
        try {
            const trip = await api(`/api/viajes/${request.id}/aceptar`, { method: 'POST' });
            activeTrip = trip;
            showTrip(trip);
            card.remove();
            showRoute(trip);
            showMessage(appMessage, 'Viaje aceptado. Recoge al pasajero e ingresa su PIN.');
        } catch (error) {
            button.disabled = false;
            showMessage(appMessage, error.message);
            if (error.message.includes('disponible')) card.remove();
        }
    });
    card.append(detail, button);
    container.prepend(card);
}

function showTrip(trip) {
    if (activeTrip && activeTrip.id !== trip.id) setDriverContact(null);
    activeTrip = trip;
    showRoute(trip);
    const account = JSON.parse(localStorage.getItem('gps-user'));
    if (account.rol === 'Pasajero') {
        const panel = document.getElementById('passenger-trip');
        panel.hidden = false;
        panel.replaceChildren();
        const title = document.createElement('strong');
        title.textContent = `Estado: ${trip.estado === 'Aceptado' ? 'Conductor en camino' : trip.estado}`;
        const details = document.createElement('p');
        details.textContent = trip.conductorId
            ? `Conductor en camino${acceptedDriverContact?.viajeId === trip.id && acceptedDriverContact.nombre ? ` · ${acceptedDriverContact.nombre}` : ''}${trip.vehiculo ? ` · ${trip.vehiculo}` : ''}${trip.placa ? ` · ${trip.placa}` : ''}`
            : 'Buscando un conductor...';
        panel.append(title, details);
        if (trip.pin) mostrarPin(trip.pin);
    } else {
        document.getElementById('driver-trip').hidden = false;
        document.getElementById('driver-trip-info').textContent =
            `Estado: ${trip.estado} · Pasajero: ${trip.pasajeroId} · $${trip.precio}`;
        document.getElementById('pin-form').hidden = trip.estado !== 'Aceptado';
        document.getElementById('finish-ride').hidden = trip.estado !== 'EnCurso';
    }
    if (trip.estado !== 'Finalizado'
        && (account.rol === 'Pasajero' || ['Aceptado', 'EnCurso'].includes(trip.estado))) {
        joinTripHubs(trip.id).catch((error) => showMessage(appMessage, error.message));
    }
    if (trip.conductorId && trip.estado !== 'Solicitado') {
        showContactWidget(true);
    } else {
        hideContactWidget();
    }
}

function hideTrip() {
    document.getElementById('passenger-trip').hidden = true;
    document.getElementById('driver-trip').hidden = true;
    setDriverContact(null);
    hideContactWidget();
}

async function handleTripUpdate(trip) {
    if (activeTrip?.id !== trip.id) {
        if (trip.conductorId === JSON.parse(localStorage.getItem('gps-user')).usuarioId) {
            activeTrip = trip;
            showTrip(trip);
        } else {
            return;
        }
    } else {
        activeTrip = { ...activeTrip, ...trip };
        showTrip(activeTrip);
    }
    showMessage(appMessage, `El estado del viaje cambió a ${trip.estado}.`);
    if (trip.estado === 'Finalizado') {
        sayArrival();
    }
}

function showRoute(trip) {
    const start = L.latLng(trip.origenLat, trip.origenLng);
    const end = L.latLng(trip.destinoLat, trip.destinoLng);
    if (!routeControl) {
        routeControl = L.Routing.control({
            waypoints: [start, end],
            addWaypoints: false,
            draggableWaypoints: false,
            fitSelectedRoutes: true,
            show: false,
            lineOptions: { styles: [{ color: '#123B63', opacity: 0.85, weight: 6 }] },
            createMarker: (index, waypoint) => L.marker(waypoint.latLng)
                .bindPopup(index === 0 ? 'Origen' : 'Destino')
        }).addTo(map);
    } else {
        routeControl.setWaypoints([start, end]);
    }
}

function renderMessage(message) {
    const list = document.getElementById('chat-messages');
    const item = document.createElement('div');
    item.className = 'chat-message';
    const sender = document.createElement('small');
    sender.textContent = message.remitenteId === JSON.parse(localStorage.getItem('gps-user')).usuarioId
        ? 'Tú'
        : 'Otro participante';
    const text = document.createElement('span');
    text.textContent = message.texto;
    item.append(sender, text);
    list.append(item);
    list.scrollTop = list.scrollHeight;
}

document.getElementById('chat-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!activeTrip || !chat) return;
    const values = formValues(event.currentTarget);
    try {
        await chat.invoke('EnviarMensaje', activeTrip.id, values.texto);
        event.currentTarget.reset();
    } catch (error) {
        showMessage(appMessage, error.message);
    }
});

document.getElementById('request-ride').addEventListener('click', async () => {
    const button = document.getElementById('request-ride');
    const originInput = addressSearchFields.origin.input;
    const originLat = document.getElementById('origin-lat').value;
    const originLng = document.getElementById('origin-lng').value;
    const destinationLat = document.getElementById('destination-lat').value;
    const destinationLng = document.getElementById('destination-lng').value;
    if (!originInput.value.trim() || !originLat || !originLng) {
        showMessage(appMessage, 'Selecciona un origen, usa tu ubicación actual o elige un punto en el mapa.');
        originInput.focus();
        return;
    }
    if (!addressSearchFields.destination.input.value.trim() || !destinationLat || !destinationLng) {
        showMessage(appMessage, 'Selecciona un destino de la lista o elige uno en el mapa.');
        addressSearchFields.destination.input.focus();
        return;
    }
    const request = {
        origenLat: Number(originLat),
        origenLng: Number(originLng),
        destinoLat: Number(destinationLat),
        destinoLng: Number(destinationLng)
    };
    button.disabled = true;
    try {
        const trip = await api('/api/viajes/solicitar', {
            method: 'POST',
            body: JSON.stringify(request)
        });
        activeTrip = trip;
        showTrip(trip);
        if (trip.pin) mostrarPin(trip.pin);
        showMessage(appMessage, 'Solicitud enviada. Comparte el PIN con tu conductor al encontrarse.');
    } catch (error) {
        showMessage(appMessage, error.message);
    } finally {
        button.disabled = false;
    }
});

function mostrarPin(pin) {
    document.getElementById('trip-pin').textContent = pin;
    document.getElementById('pin-banner').hidden = false;
}

document.getElementById('close-pin-banner').addEventListener('click', () => {
    document.getElementById('pin-banner').hidden = true;
});

document.getElementById('refresh-rides').addEventListener('click', () => {
    loadAvailableRides().catch((error) => showMessage(appMessage, error.message));
});

document.getElementById('pin-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!activeTrip) return;
    const { pin } = formValues(event.currentTarget);
    try {
        const trip = await api(`/api/viajes/${activeTrip.id}/iniciar`, {
            method: 'POST',
            body: JSON.stringify({ pin })
        });
        activeTrip = trip;
        showTrip(trip);
        showMessage(appMessage, 'PIN válido. El viaje está en curso.');
    } catch (error) {
        showMessage(appMessage, error.message);
    }
});

document.getElementById('finish-ride').addEventListener('click', async () => {
    if (!activeTrip) return;
    try {
        const trip = await api(`/api/viajes/${activeTrip.id}/finalizar`, { method: 'POST' });
        activeTrip = trip;
        showTrip(trip);
        sayArrival();
        showMessage(appMessage, `Viaje finalizado. Comisión de plataforma: $${trip.comisionPlataforma}.`);
    } catch (error) {
        showMessage(appMessage, error.message);
    }
});

document.getElementById('use-location').addEventListener('click', () => {
    if (!navigator.geolocation) {
        const message = 'Este dispositivo no ofrece geolocalización.';
        showMessage(appMessage, message);
        window.alert(message);
        return;
    }
    navigator.geolocation.getCurrentPosition(
        async ({ coords }) => {
            const position = { lat: coords.latitude, lng: coords.longitude };
            const originInput = addressSearchFields.origin.input;
            document.getElementById('origin-lat').value = coords.latitude;
            document.getElementById('origin-lng').value = coords.longitude;
            originInput.value = `Ubicación actual (${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)})`;
            if (addressMarkers.origin) addressMarkers.origin.remove();
            addressMarkers.origin = L.marker([coords.latitude, coords.longitude])
                .addTo(map)
                .bindPopup('Tu ubicación actual');
            map.setView([coords.latitude, coords.longitude], 15);
            addressMarkers.origin.openPopup();

            if (!geocodeProvider) {
                const message = 'El buscador de direcciones no está disponible.';
                showMessage(appMessage, message);
                window.alert(message);
                return;
            }
            try {
                const provider = new OpenStreetMapProvider({ params: { ...baseGeocodingParams } });
                const [place] = await provider.reverse(position);
                if (place) originInput.value = place.label;
                const cityName = cityNameFrom(place);
                if (!cityName) {
                    searchCityLabel.textContent = 'No se pudo identificar la ciudad de tu ubicación.';
                    return;
                }

                currentCityInput.value = cityName;
                const qualifier = [place.raw?.address?.state, place.raw?.address?.country].filter(Boolean).join(', ');
                try {
                    await applyCityInput(cityName, qualifier);
                } catch (error) {
                    searchCityBounds = place.bounds;
                    geocodeProvider = createSearchProvider(searchCityBounds);
                    searchCityLabel.textContent = `Buscando en: ${cityName}`;
                    console.warn('No se pudieron obtener los límites de la ciudad:', error);
                }
            } catch (error) {
                console.warn('No se pudo resolver la dirección de la ubicación actual:', error);
                showMessage(appMessage, 'No se pudo detectar la ciudad de tu ubicación.');
            }
        },
        (error) => {
            const message = `No se pudo obtener tu ubicación: ${error.message}`;
            showMessage(appMessage, message);
            window.alert(message);
        },
        { enableHighAccuracy: true, timeout: 10000 }
    );
});

detectInitialSearchCity();

function sayArrival() {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const message = new SpeechSynthesisUtterance('Has llegado a tu destino. Gracias por viajar con UbicacionGPS.');
    message.lang = 'es-CO';
    window.speechSynthesis.speak(message);
}

async function prepareCall() {
    if (!activeTrip || !calls) throw new Error('Primero debes tener un viaje asignado.');
    if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('El navegador no permite acceso al micrófono. Usa HTTPS o localhost.');
    }
    if (!localStream) {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    }
    if (!call) {
        call = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
        localStream.getTracks().forEach((track) => call.addTrack(track, localStream));
        call.ontrack = ({ streams }) => {
            document.getElementById('remote-audio').srcObject = streams[0];
            document.getElementById('call-status').textContent = 'Llamada conectada';
        };
        call.onicecandidate = ({ candidate }) => {
            if (candidate) {
                calls.invoke('EnviarCandidatoIce', activeTrip.id, JSON.stringify(candidate))
                    .catch((error) => showMessage(appMessage, error.message));
            }
        };
        call.onconnectionstatechange = () => {
            document.getElementById('call-status').textContent =
                call?.connectionState === 'connected' ? 'Llamada conectada' : `Llamada: ${call?.connectionState}`;
        };
    }
    document.getElementById('end-call').hidden = false;
}

document.getElementById('call-button').addEventListener('click', async () => {
    try {
        await prepareCall();
        const offer = await call.createOffer();
        await call.setLocalDescription(offer);
        await calls.invoke('EnviarOferta', activeTrip.id, offer.sdp);
        document.getElementById('call-status').textContent = 'Llamando...';
    } catch (error) {
        showMessage(appMessage, error.message);
    }
});

async function receiveOffer(signal) {
    if (!activeTrip) return;
    try {
        await prepareCall();
        await call.setRemoteDescription({ type: 'offer', sdp: signal.valor });
        remoteDescriptionSet = true;
        await flushCandidates();
        const answer = await call.createAnswer();
        await call.setLocalDescription(answer);
        await calls.invoke('EnviarRespuesta', activeTrip.id, answer.sdp);
        document.getElementById('call-status').textContent = 'Conectando llamada...';
    } catch (error) {
        showMessage(appMessage, `No se pudo responder la llamada: ${error.message}`);
    }
}

async function receiveAnswer(signal) {
    if (!call || call.signalingState !== 'have-local-offer') return;
    await call.setRemoteDescription({ type: 'answer', sdp: signal.valor });
    remoteDescriptionSet = true;
    await flushCandidates();
}

async function receiveCandidate(signal) {
    if (!call) return;
    const candidate = new RTCIceCandidate(JSON.parse(signal.valor));
    if (remoteDescriptionSet) await call.addIceCandidate(candidate);
    else queuedCandidates.push(candidate);
}

async function flushCandidates() {
    for (const candidate of queuedCandidates) await call.addIceCandidate(candidate);
    queuedCandidates = [];
}

document.getElementById('end-call').addEventListener('click', endCall);

function endCall() {
    call?.close();
    call = null;
    localStream?.getTracks().forEach((track) => track.stop());
    localStream = null;
    remoteDescriptionSet = false;
    queuedCandidates = [];
    document.getElementById('remote-audio').srcObject = null;
    document.getElementById('end-call').hidden = true;
    document.getElementById('call-status').textContent = 'Llamada finalizada';
}

document.getElementById('logout').addEventListener('click', async () => {
    const token = sessionStorage.getItem('gps-fcm-token');
    if (token) {
        try {
            await api('/api/notificaciones/token', {
                method: 'DELETE',
                body: JSON.stringify({ token })
            });
        } catch (error) {
            console.error('No se pudo desasociar el token de notificaciones:', error);
        }
    }
    endCall();
    [calls, chat, viajes].filter(Boolean).forEach((hub) => hub.stop());
    calls = chat = viajes = null;
    activeTrip = null;
    localStorage.removeItem('gps-token');
    localStorage.removeItem('gps-user');
    sessionStorage.removeItem('gps-fcm-token');
    userPanel.hidden = true;
    authPanel.hidden = false;
    hideTrip();
});

let viajes;
if (localStorage.getItem('gps-token')) {
    showAuthenticatedUi().catch((error) => {
        localStorage.removeItem('gps-token');
        localStorage.removeItem('gps-user');
        showMessage(authMessage, error.message);
    });
}
