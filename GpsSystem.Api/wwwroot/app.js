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
let driverConnected = false;
let driverLocationWatchId = null;
let driverMarker = null;
let finalizationSummary = null;
let sessionExpirationHandled = false;
const latestDriverLocations = new Map();

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
    const copyButton = document.getElementById('copy-phone');
    const person = document.getElementById('contact-widget-person');
    if (!contact) {
        link.hidden = true;
        link.removeAttribute('href');
        copyButton.hidden = true;
        person.textContent = '';
        return;
    }

    person.textContent = contact.nombre || '';
    const digits = (contact.telefono || '').replace(/\D/g, '');
    if (digits.length >= 7) {
        link.href = `tel:+${digits}`;
        copyButton.hidden = false;
    } else {
        link.removeAttribute('href');
        copyButton.hidden = true;
    }
    link.hidden = false;
}

document.getElementById('cell-call').addEventListener('click', (event) => {
    if (!event.currentTarget.hasAttribute('href')) {
        event.preventDefault();
        window.alert('Este usuario no tiene un número de teléfono registrado.');
    }
});

document.getElementById('copy-phone').addEventListener('click', async () => {
    const phone = acceptedDriverContact?.telefono?.trim();
    const message = document.getElementById('copy-phone-message');
    if (!phone) {
        window.alert('Este usuario no tiene un número de teléfono registrado.');
        return;
    }

    try {
        if (!navigator.clipboard?.writeText) {
            throw new Error('El portapapeles no está disponible en este navegador.');
        }
        await navigator.clipboard.writeText(phone);
        message.textContent = '¡Número copiado!';
        window.setTimeout(() => { message.textContent = ''; }, 2500);
    } catch (error) {
        message.textContent = '';
        showMessage(appMessage, `No se pudo copiar el número: ${error.message}`);
    }
});

function closeProfileModal() {
    document.getElementById('profile-modal').hidden = true;
    showMessage(document.getElementById('profile-message'));
}

document.getElementById('open-profile').addEventListener('click', () => {
    const account = JSON.parse(localStorage.getItem('gps-user'));
    const form = document.getElementById('profile-form');
    const passwordFields = document.getElementById('password-change-fields');
    passwordFields.hidden = true;
    document.getElementById('toggle-password-fields').textContent = '¿Quieres cambiar tu contraseña?';
    form.elements.namedItem('nombre').value = account?.nombre || '';
    form.elements.namedItem('telefono').value = account?.telefono || '';
    form.elements.namedItem('passwordActual').value = '';
    form.elements.namedItem('passwordNueva').value = '';
    document.getElementById('profile-modal').hidden = false;
    form.elements.namedItem('nombre').focus();
});

document.getElementById('toggle-password-fields').addEventListener('click', (event) => {
    const passwordFields = document.getElementById('password-change-fields');
    const showFields = passwordFields.hidden;
    passwordFields.hidden = !showFields;
    event.currentTarget.textContent = showFields
        ? 'Ocultar campos de contraseña'
        : '¿Quieres cambiar tu contraseña?';
    if (!showFields) {
        document.querySelector('#password-change-fields [name="passwordActual"]').value = '';
        document.querySelector('#password-change-fields [name="passwordNueva"]').value = '';
    } else {
        document.querySelector('#password-change-fields [name="passwordActual"]').focus();
    }
});

document.getElementById('close-profile').addEventListener('click', closeProfileModal);
document.getElementById('cancel-profile').addEventListener('click', closeProfileModal);
document.getElementById('profile-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const submitButton = form.querySelector('[type="submit"]');
    const values = formValues(form);
    submitButton.disabled = true;
    showMessage(document.getElementById('profile-message'));
    try {
        const profile = await api('/api/auth/perfil', {
            method: 'PUT',
            body: JSON.stringify({
                nombre: values.nombre.trim(),
                telefono: values.telefono.trim(),
                ...(document.getElementById('password-change-fields').hidden
                    ? {}
                    : {
                        passwordActual: values.passwordActual,
                        passwordNueva: values.passwordNueva
                    })
            })
        });
        const account = JSON.parse(localStorage.getItem('gps-user'));
        account.nombre = profile.nombre;
        account.telefono = profile.telefono;
        localStorage.setItem('gps-user', JSON.stringify(account));
        updateWelcome(account);
        closeProfileModal();
        window.alert('Perfil actualizado correctamente.');
    } catch (error) {
        showMessage(document.getElementById('profile-message'), error.message);
    } finally {
        submitButton.disabled = false;
    }
});

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

function cerrarSesionPorExpiracion() {
    if (sessionExpirationHandled) return;
    sessionExpirationHandled = true;
    localStorage.removeItem('gps-token');
    localStorage.removeItem('gps-user');
    sessionStorage.removeItem('gps-token');
    sessionStorage.removeItem('gps-user');
    window.alert('Sesión expirada. Vuelve a iniciar sesión.');
    window.location.reload();
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
    if (/^\/api\/viajes\/[^/]+\/cancelar$/.test(path)) {
        console.log('Respuesta de cancelación:', response.status);
    }

    if (!response.ok) {
        const isAuthenticationRequest = ['/api/auth/login', '/api/auth/register'].includes(path);
        if (response.status === 401 && token && !isAuthenticationRequest) {
            cerrarSesionPorExpiracion();
            throw new Error('Sesión expirada. Vuelve a iniciar sesión.');
        }

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

document.getElementById('forgot-password-link').addEventListener('click', (event) => {
    event.preventDefault();
    const form = document.getElementById('forgot-password-form');
    form.elements.namedItem('email').value =
        document.querySelector('#login-form [name="email"]').value;
    document.getElementById('forgot-password-modal').hidden = false;
    form.elements.namedItem('email').focus();
});

function closeForgotPasswordModal() {
    document.getElementById('forgot-password-modal').hidden = true;
    showMessage(document.getElementById('forgot-password-message'));
}

function closeResetPasswordModal() {
    document.getElementById('reset-password-modal').hidden = true;
    showMessage(document.getElementById('reset-password-message'));
}

document.getElementById('close-forgot-password').addEventListener('click', closeForgotPasswordModal);
document.getElementById('cancel-forgot-password').addEventListener('click', closeForgotPasswordModal);
document.getElementById('close-reset-password').addEventListener('click', closeResetPasswordModal);
document.getElementById('cancel-reset-password').addEventListener('click', closeResetPasswordModal);

document.getElementById('forgot-password-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const submitButton = form.querySelector('[type="submit"]');
    const values = formValues(form);
    submitButton.disabled = true;
    showMessage(document.getElementById('forgot-password-message'));
    try {
        await api('/api/auth/forgot-password', {
            method: 'POST',
            body: JSON.stringify({ email: values.email.trim() })
        });
        const resetForm = document.getElementById('reset-password-form');
        resetForm.elements.namedItem('email').value = values.email.trim();
        resetForm.elements.namedItem('codigo').value = '';
        resetForm.elements.namedItem('passwordNueva').value = '';
        closeForgotPasswordModal();
        document.getElementById('reset-password-modal').hidden = false;
        resetForm.elements.namedItem('codigo').focus();
    } catch (error) {
        showMessage(document.getElementById('forgot-password-message'), error.message);
    } finally {
        submitButton.disabled = false;
    }
});

document.getElementById('reset-password-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const submitButton = form.querySelector('[type="submit"]');
    const values = formValues(form);
    submitButton.disabled = true;
    showMessage(document.getElementById('reset-password-message'));
    try {
        await api('/api/auth/reset-password', {
            method: 'POST',
            body: JSON.stringify({
                email: values.email,
                codigo: values.codigo.trim(),
                passwordNueva: values.passwordNueva
            })
        });
        const loginForm = document.getElementById('login-form');
        loginForm.elements.namedItem('email').value = values.email;
        loginForm.elements.namedItem('password').value = '';
        form.reset();
        closeResetPasswordModal();
        showMessage(authMessage, 'Contraseña restablecida. Inicia sesión con tu nueva contraseña.');
    } catch (error) {
        showMessage(document.getElementById('reset-password-message'), error.message);
    } finally {
        submitButton.disabled = false;
    }
});

document.getElementById('login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    showMessage(authMessage);
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

document.getElementById('login-form').addEventListener('input', () => showMessage(authMessage));

async function loginSucceeded(account) {
    localStorage.setItem('gps-token', account.token);
    localStorage.setItem('gps-user', JSON.stringify({
        usuarioId: account.usuarioId,
        email: account.email,
        rol: account.rol,
        telefono: account.telefono,
        nombre: account.nombre
    }));
    await showAuthenticatedUi();
}

function updateWelcome(account) {
    const role = account.rol === 'Conductor' ? 'Conductor' : 'Pasajero';
    document.getElementById('welcome').textContent =
        `${role} · ${account.nombre?.trim() || account.email}`;
}

async function showAuthenticatedUi() {
    const account = JSON.parse(localStorage.getItem('gps-user'));
    if (!account || !localStorage.getItem('gps-token')) return;

    try {
        const profile = await api('/api/auth/perfil');
        account.telefono = profile.telefono;
        account.nombre = profile.nombre;
        localStorage.setItem('gps-user', JSON.stringify(account));
        if (!profile.telefono?.trim()) {
            window.alert('Tu cuenta no tiene teléfono registrado. Actualiza tu perfil para que puedan contactarte por celular.');
        }
    } catch (error) {
        showMessage(appMessage, `No se pudo verificar el teléfono del perfil: ${error.message}`);
    }

    authPanel.hidden = true;
    userPanel.hidden = false;
    updateWelcome(account);
    document.getElementById('passenger-panel').hidden = account.rol !== 'Pasajero';
    document.getElementById('driver-panel').hidden = account.rol !== 'Conductor';
    document.getElementById('enable-notifications').textContent =
        sessionStorage.getItem('gps-fcm-token') ? 'Notificaciones activadas' : 'Activar notificaciones';
    showMessage(authMessage);

    try {
        await connectHubs();
        await restoreTrips(account);
        if (account.rol === 'Conductor') {
            const shouldConnect = localStorage.getItem('gps-driver-connected') === 'true'
                && !activeTrip;
            await setDriverAvailability(shouldConnect);
            await loadDriverEarnings();
        }
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
            const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js', { scope: '/firebase/' });
            const token = await getToken(fcmMessaging, { vapidKey, serviceWorkerRegistration: registration });
            if (!token) throw new Error('Firebase no devolvió un token para este navegador.');

            await api('/api/notificaciones/registrar-token', {
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
    console.log('Token enviado a SignalR:', localStorage.getItem('gps-token') ? 'Token presente' : 'Token NULO');
    const hub = new signalR.HubConnectionBuilder()
        .withUrl(path, { accessTokenFactory: () => localStorage.getItem('gps-token') || '' })
        .withAutomaticReconnect()
        .build();
    hub.onclose((error) => {
        if (isUnauthorizedSignalRError(error)) cerrarSesionPorExpiracion();
    });
    try {
        await hub.start();
    } catch (error) {
        if (isUnauthorizedSignalRError(error)) cerrarSesionPorExpiracion();
        throw error;
    }
    return hub;
}

function isUnauthorizedSignalRError(error) {
    return error?.statusCode === 401 || /\b401\b|unauthorized/i.test(error?.message || '');
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
    viajes.on('ViajeAceptado', (trip) => {
        if (activeTrip?.id !== trip.id
            || JSON.parse(localStorage.getItem('gps-user'))?.rol !== 'Pasajero') return;

        activeTrip = { ...activeTrip, ...trip };
        showTrip(activeTrip);
        showContactWidget(true);
        showMessage(appMessage, 'Un conductor aceptó tu viaje.');
    });
    viajes.on('ActualizarViaje', (trip) => handleTripUpdate(trip));
    viajes.on('ConductorLlegando', ({ viajeId }) => {
        if (activeTrip?.id !== viajeId
            || JSON.parse(localStorage.getItem('gps-user'))?.rol !== 'Pasajero') return;
        activeTrip = { ...activeTrip, estado: 'Llegando' };
        showTrip(activeTrip);
        showMessage(appMessage, 'Tu conductor ha llegado.');
        announceDriverArrival();
    });
    viajes.on('ViajeCancelado', async ({ viajeId, canceladoPor }) => {
        console.log('Evento ViajeCancelado recibido:', viajeId, canceladoPor);
        if (activeTrip?.id !== viajeId) return;
        const account = JSON.parse(localStorage.getItem('gps-user'));
        clearActiveTripUi();
        if (account?.rol === 'Conductor') {
            showMessage(appMessage, canceladoPor === 'Conductor'
                ? 'Cancelaste el viaje.'
                : 'Viaje cancelado por el pasajero.');
            try {
                await setDriverAvailability(true);
            } catch (error) {
                showMessage(appMessage, `Viaje cancelado, pero no se pudo volver a las solicitudes: ${error.message}`);
            }
        } else {
            showMessage(appMessage, canceladoPor === 'Conductor'
                ? 'El conductor canceló el viaje.'
                : 'El viaje fue cancelado.');
        }
    });
    viajes.on('UbicacionConductor', (location) => {
        if (activeTrip?.id !== location.viajeId) return;
        updateDriverMarker({
            dispositivoId: location.conductorId,
            latitud: location.latitud,
            longitud: location.longitud
        });
        updatePassengerEta(location);
    });
    chat.on('RecibirMensaje', (message) => renderMessage(message));
    calls.on('OfertaLlamada', receiveOffer);
    calls.on('RespuestaLlamada', receiveAnswer);
    calls.on('CandidatoIce', receiveCandidate);

    [calls, chat, viajes].forEach((hub) => {
        hub.onreconnecting(() => { status.textContent = 'Reconectando...'; });
        hub.onreconnected(async () => {
            status.textContent = 'Conectado';
            if (hub === viajes
                && JSON.parse(localStorage.getItem('gps-user'))?.rol === 'Conductor'
                && driverConnected) {
                await viajes.invoke('EstablecerDisponibilidad', true);
            }
            if (activeTrip) {
                joinedTripId = null;
                await joinTripHubs(activeTrip.id);
            }
        });
        hub.onclose(() => {
            status.textContent = 'Desconectado';
            const account = JSON.parse(localStorage.getItem('gps-user'));
            if (hub !== viajes || account?.rol !== 'Conductor') return;

            driverConnected = false;
            localStorage.removeItem('gps-driver-connected');
            const button = document.getElementById('driver-availability');
            button.textContent = 'Conectarse';
            button.classList.remove('is-connected');
            button.setAttribute('aria-pressed', 'false');
            document.getElementById('available-rides-section').hidden = true;
            clearActiveTripUi();
            showMessage(appMessage, 'Se perdió la conexión. El viaje actual se ocultó; vuelve a conectarte para continuar.');
        });
    });
}

async function restoreTrips(account) {
    const trips = await api('/api/viajes/mios');
    const current = trips.find((trip) => ['Solicitado', 'Aceptado', 'Llegando', 'EnCurso', 'PendientePago'].includes(trip.estado));
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
    const requests = await api('/api/viajes/pendientes');
    const container = document.getElementById('available-rides');
    container.replaceChildren();
    requests.forEach(addAvailableRide);
}

async function loadDriverEarnings() {
    const result = await api('/api/viajes/ganancias');
    document.getElementById('driver-earnings-amount').textContent =
        formatCurrency(result.gananciasAcumuladas);
}

function addAvailableRide(request) {
    if (!driverConnected || document.getElementById('driver-panel').hidden || request.id === activeTrip?.id) return;
    const container = document.getElementById('available-rides');
    if ([...container.querySelectorAll('[data-ride-id]')].some((item) => item.dataset.rideId === request.id)) return;
    const card = document.createElement('article');
    card.className = 'ride-item';
    card.dataset.rideId = request.id;
    const passenger = document.createElement('div');
    passenger.className = 'ride-passenger';
    const avatar = document.createElement('span');
    avatar.className = 'ride-avatar';
    avatar.setAttribute('aria-hidden', 'true');
    avatar.textContent = '👤';
    const passengerDetails = document.createElement('div');
    passengerDetails.className = 'ride-passenger-details';
    const passengerName = document.createElement('span');
    passengerName.className = 'ride-passenger-name';
    passengerName.textContent = request.pasajeroNombre || request.pasajeroEmail || 'Pasajero';
    const rating = document.createElement('span');
    rating.className = 'ride-rating';
    rating.textContent = '★ 4.8 · Calificación';
    passengerDetails.append(passengerName, rating);
    passenger.append(avatar, passengerDetails);

    const price = document.createElement('strong');
    price.className = 'ride-price';
    price.textContent = formatCurrency(request.precio);
    const metrics = estimateRideMetrics(request);
    const estimates = document.createElement('div');
    estimates.className = 'ride-estimates';
    const distance = document.createElement('span');
    distance.textContent = `Distancia: ${metrics.distanceKm.toFixed(1)} km`;
    const eta = document.createElement('span');
    eta.textContent = `ETA estimada: ${metrics.etaMinutes} min`;
    estimates.append(distance, eta);
    const actions = document.createElement('div');
    actions.className = 'ride-actions';
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
            await setDriverAvailability(false);
            showRoute(trip);
            showMessage(appMessage, 'Viaje aceptado. Recoge al pasajero e ingresa su PIN.');
        } catch (error) {
            button.disabled = false;
            showMessage(appMessage, error.message);
            if (error.message.includes('disponible')) card.remove();
        }
    });
    const rejectButton = document.createElement('button');
    rejectButton.className = 'secondary';
    rejectButton.type = 'button';
    rejectButton.textContent = 'Rechazar';
    rejectButton.addEventListener('click', async () => {
        rejectButton.disabled = true;
        try {
            await api(`/api/viajes/${request.id}/rechazar`, { method: 'POST' });
            card.remove();
        } catch (error) {
            rejectButton.disabled = false;
            showMessage(appMessage, error.message);
        }
    });
    actions.append(button, rejectButton);
    card.append(passenger, price, estimates, actions);
    container.prepend(card);
}

function showTrip(trip) {
    if (activeTrip && activeTrip.id !== trip.id) setDriverContact(null);
    activeTrip = trip;
    showRoute(trip);
    const account = JSON.parse(localStorage.getItem('gps-user'));
    syncDriverLocationTracking();
    if (account.rol === 'Pasajero') {
        const panel = document.getElementById('passenger-trip');
        renderPassengerActiveTrip(trip);
        panel.hidden = false;
        panel.replaceChildren();
        const title = document.createElement('strong');
        title.textContent = trip.estado === 'Llegando'
            ? 'Tu conductor ha llegado'
            : `Estado: ${({
                Aceptado: 'Conductor en camino',
                EnCurso: 'Viaje en curso',
                PendientePago: 'Viaje finalizado, confirmando el pago',
                Finalizado: 'Viaje finalizado'
            })[trip.estado] || trip.estado}`;
        const details = document.createElement('p');
        details.textContent = trip.conductorId
            ? `${trip.estado === 'Llegando' ? 'Tu conductor ha llegado' : trip.estado === 'EnCurso' ? 'Viaje en curso' : trip.estado === 'PendientePago' ? 'Viaje finalizado, confirmando el pago' : trip.estado === 'Finalizado' ? 'Viaje finalizado' : 'Conductor en camino'}${acceptedDriverContact?.viajeId === trip.id && acceptedDriverContact.nombre ? ` · ${acceptedDriverContact.nombre}` : ''}${trip.vehiculo ? ` · ${trip.vehiculo}` : ''}${trip.placa ? ` · ${trip.placa}` : ''}`
            : 'Buscando un conductor...';
        panel.append(title, details);
        document.getElementById('cancel-ride').hidden =
            !['Solicitado', 'Aceptado', 'Llegando'].includes(trip.estado);
        if (trip.pin) mostrarPin(trip.pin);
        if (trip.conductorId) {
            const lastPosition = latestDriverLocations.get(trip.conductorId);
            if (lastPosition) {
                updateDriverMarker(lastPosition);
                updatePassengerEta(lastPosition);
            }
        }
    } else {
        const hasCurrentTrip = ['Aceptado', 'Llegando', 'EnCurso', 'PendientePago'].includes(trip.estado);
        const showPaymentSummary = trip.estado === 'PendientePago';
        document.getElementById('available-rides-section').hidden = hasCurrentTrip || !driverConnected;
        document.getElementById('driver-trip').hidden = !hasCurrentTrip || showPaymentSummary;
        document.getElementById('payment-summary').hidden = !showPaymentSummary;
        document.getElementById('driver-trip-price').textContent =
            formatCurrency(trip.precio);
        document.getElementById('driver-trip-passenger').textContent =
            `Pasajero: ${trip.pasajeroNombre || 'Pasajero'}`;
        document.getElementById('driver-trip-distance').textContent =
            `Distancia estimada: ${estimatedTripDistance(trip).toFixed(1)} km`;
        document.getElementById('driver-trip-info').textContent = `Estado: ${trip.estado}`;
        document.getElementById('arriving-ride').hidden = trip.estado !== 'Aceptado';
        document.getElementById('driver-cancel-ride').hidden =
            !['Aceptado', 'Llegando'].includes(trip.estado);
        document.getElementById('pin-form').hidden = !['Aceptado', 'Llegando'].includes(trip.estado);
        document.getElementById('finish-ride').hidden = trip.estado !== 'EnCurso';
        document.getElementById('driver-availability').disabled = hasCurrentTrip;
        if (showPaymentSummary) {
            const summary = finalizationSummary || {
                montoTotal: trip.precio,
                comision: trip.comisionPlataforma,
                gananciaNeta: trip.precio - trip.comisionPlataforma
            };
            document.getElementById('payment-total').textContent = formatCurrency(summary.montoTotal);
            document.getElementById('payment-commission').textContent = formatCurrency(summary.comision);
            document.getElementById('payment-net').textContent = formatCurrency(summary.gananciaNeta);
        }
    }
    if (trip.estado !== 'Finalizado'
        && (account.rol === 'Pasajero' || ['Aceptado', 'Llegando', 'EnCurso'].includes(trip.estado))) {
        joinTripHubs(trip.id).catch((error) => showMessage(appMessage, error.message));
    }
    if (trip.conductorId && trip.estado !== 'Solicitado') {
        showContactWidget(true);
    } else {
        hideContactWidget();
    }
    if (trip.estado === 'Finalizado' && driverMarker) {
        driverMarker.remove();
        driverMarker = null;
    }
}

function estimatedTripDistance(trip) {
    const radians = (degrees) => degrees * Math.PI / 180;
    const latitudeDelta = radians(trip.destinoLat - trip.origenLat);
    const longitudeDelta = radians(trip.destinoLng - trip.origenLng);
    const originLatitude = radians(trip.origenLat);
    const destinationLatitude = radians(trip.destinoLat);
    const haversine = Math.sin(latitudeDelta / 2) ** 2
        + Math.cos(originLatitude) * Math.cos(destinationLatitude) * Math.sin(longitudeDelta / 2) ** 2;
    return 2 * 6371 * Math.asin(Math.sqrt(haversine)) * 1.3;
}

function estimateRideMetrics(trip) {
    const distanceKm = estimatedTripDistance(trip);
    return {
        distanceKm,
        etaMinutes: Math.max(1, Math.ceil(distanceKm / 25 * 60))
    };
}

function formatCurrency(amount) {
    return `$${Number(amount).toLocaleString('es-CO', {
        maximumFractionDigits: 0
    })}`;
}

function renderPassengerActiveTrip(trip) {
    const searchStatus = document.getElementById('passenger-search-status');
    const activeTripCard = document.getElementById('passenger-active-trip');
    const isSearching = trip.estado === 'Solicitado' && !trip.conductorId;
    const hasDriver = Boolean(trip.conductorId)
        && !['Cancelado', 'Finalizado'].includes(trip.estado);

    searchStatus.hidden = !isSearching;
    activeTripCard.hidden = !hasDriver;
    if (!hasDriver) {
        setDriverContact(null);
        document.getElementById('passenger-driver-call').removeAttribute('href');
        document.getElementById('passenger-driver-call').hidden = true;
        return;
    }

    const contact = {
        viajeId: trip.id,
        nombre: trip.conductorNombre,
        telefono: trip.conductorTelefono
    };
    setDriverContact(contact);
    document.getElementById('passenger-driver-name').textContent =
        trip.conductorNombre || 'Conductor';
    const callLink = document.getElementById('passenger-driver-call');
    const phoneDigits = (trip.conductorTelefono || '').replace(/\D/g, '');
    if (phoneDigits.length >= 7) {
        callLink.href = `tel:+${phoneDigits}`;
        callLink.hidden = false;
    } else {
        callLink.removeAttribute('href');
        callLink.hidden = true;
    }
    document.getElementById('passenger-driver-eta').textContent =
        'Calculando tiempo de llegada...';
}

function updatePassengerEta(location) {
    if (JSON.parse(localStorage.getItem('gps-user'))?.rol !== 'Pasajero'
        || !activeTrip?.conductorId
        || document.getElementById('passenger-active-trip').hidden) return;

    const driverLatitude = Number(location.latitud);
    const driverLongitude = Number(location.longitud);
    const originLatitude = Number(activeTrip.origenLat);
    const originLongitude = Number(activeTrip.origenLng);
    if (![driverLatitude, driverLongitude, originLatitude, originLongitude].every(Number.isFinite)) return;

    const distanceKm = haversineDistanceKm(
        driverLatitude,
        driverLongitude,
        originLatitude,
        originLongitude);
    const etaMinutes = Math.max(1, Math.ceil(distanceKm / 30 * 60));
    document.getElementById('passenger-driver-eta').textContent =
        `Llegando en ~${etaMinutes} min`;
}

function haversineDistanceKm(latitude1, longitude1, latitude2, longitude2) {
    const radians = (degrees) => degrees * Math.PI / 180;
    const latitudeDelta = radians(latitude2 - latitude1);
    const longitudeDelta = radians(longitude2 - longitude1);
    const latitude1Radians = radians(latitude1);
    const latitude2Radians = radians(latitude2);
    const haversine = Math.sin(latitudeDelta / 2) ** 2
        + Math.cos(latitude1Radians) * Math.cos(latitude2Radians)
        * Math.sin(longitudeDelta / 2) ** 2;
    return 6371 * 2 * Math.asin(Math.sqrt(Math.min(1, haversine)));
}

function updateDriverMarker(location) {
    if (!location?.dispositivoId) return;
    latestDriverLocations.set(location.dispositivoId, location);
    const account = JSON.parse(localStorage.getItem('gps-user'));
    if (!account) return;
    const trackedDriverId = account.rol === 'Conductor'
        ? account.usuarioId
        : activeTrip?.conductorId;
    if (location.dispositivoId !== trackedDriverId) return;

    const position = [location.latitud, location.longitud];
    if (!driverMarker) {
        driverMarker = L.marker(position, {
            icon: L.divIcon({
                className: 'live-driver-marker',
                iconSize: [18, 18],
                iconAnchor: [9, 9]
            })
        }).addTo(map).bindPopup('Ubicación del conductor');
    } else {
        driverMarker.setLatLng(position);
    }
}

function syncDriverLocationTracking() {
    const account = JSON.parse(localStorage.getItem('gps-user'));
    const hasActiveRide = ['Aceptado', 'Llegando', 'EnCurso'].includes(activeTrip?.estado);
    const shouldTrack = account?.rol === 'Conductor' && hasActiveRide;
    if (shouldTrack && driverLocationWatchId === null) {
        if (!navigator.geolocation) {
            showMessage(appMessage, 'Este dispositivo no ofrece geolocalización.');
            return;
        }
        driverLocationWatchId = navigator.geolocation.watchPosition(
            ({ coords }) => {
                const currentAccount = JSON.parse(localStorage.getItem('gps-user'));
                if (!currentAccount || currentAccount.rol !== 'Conductor') return;
                const location = {
                    latitud: coords.latitude,
                    longitud: coords.longitude,
                    velocidad: Math.max(0, coords.speed || 0)
                };
                updateDriverMarker({ ...location, dispositivoId: currentAccount.usuarioId });
                if (!viajes || viajes.state !== signalR.HubConnectionState.Connected || !activeTrip) return;
                viajes.invoke(
                    'ActualizarUbicacion',
                    activeTrip.id,
                    location.latitud,
                    location.longitud,
                    location.velocidad
                ).catch((error) => showMessage(appMessage, `No se pudo enviar la ubicación: ${error.message}`));
            },
            (error) => showMessage(appMessage, `No se pudo obtener la ubicación del conductor: ${error.message}`),
            { enableHighAccuracy: true, maximumAge: 3000, timeout: 20000 }
        );
    } else if (!shouldTrack && driverLocationWatchId !== null) {
        navigator.geolocation.clearWatch(driverLocationWatchId);
        driverLocationWatchId = null;
    }
}

async function setDriverAvailability(available) {
    if (!viajes || viajes.state !== signalR.HubConnectionState.Connected) {
        throw new Error('No se puede cambiar la disponibilidad sin conexión al servidor.');
    }

    await viajes.invoke('EstablecerDisponibilidad', available);
    driverConnected = available;
    if (available) {
        localStorage.setItem('gps-driver-connected', 'true');
    } else {
        localStorage.removeItem('gps-driver-connected');
    }
    const button = document.getElementById('driver-availability');
    button.textContent = available ? 'Desconectarse' : 'Conectarse';
    button.classList.toggle('is-connected', available);
    button.setAttribute('aria-pressed', String(available));
    syncDriverLocationTracking();
    document.getElementById('available-rides-section').hidden =
        !available || Boolean(activeTrip && activeTrip.estado !== 'Finalizado');

    if (available) {
        await loadAvailableRides();
    }
}

function hideTrip() {
    document.getElementById('passenger-trip').hidden = true;
    document.getElementById('passenger-search-status').hidden = true;
    document.getElementById('passenger-active-trip').hidden = true;
    document.getElementById('cancel-ride').hidden = true;
    document.getElementById('driver-cancel-ride').hidden = true;
    document.getElementById('driver-trip').hidden = true;
    document.getElementById('payment-summary').hidden = true;
    document.getElementById('driver-availability').disabled = false;
    setDriverContact(null);
    hideContactWidget();
}

function clearActiveTripUi() {
    activeTrip = null;
    joinedTripId = null;
    finalizationSummary = null;
    if (routeControl) {
        routeControl.remove();
        routeControl = null;
    }
    if (driverMarker) {
        driverMarker.remove();
        driverMarker = null;
    }
    for (const key of Object.keys(addressMarkers)) {
        addressMarkers[key]?.remove();
        addressMarkers[key] = null;
    }
    for (const id of ['origin-lat', 'origin-lng', 'destination-lat', 'destination-lng']) {
        document.getElementById(id).value = '';
    }
    for (const id of ['origin-search', 'destination-search']) {
        document.getElementById(id).value = '';
    }
    document.getElementById('pin-banner').hidden = true;
    document.getElementById('chat-messages').replaceChildren();
    hideTrip();
    map.setView([10.3910, -75.4794], 13);
    syncDriverLocationTracking();
}

async function handleTripUpdate(trip) {
    if (trip.estado === 'Cancelado') return;
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
        showMessage(appMessage, 'Solicitud enviada. Buscando conductor...');
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

document.getElementById('driver-availability').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
        if (!viajes || viajes.state !== signalR.HubConnectionState.Connected) {
            await connectHubs();
            const account = JSON.parse(localStorage.getItem('gps-user'));
            await restoreTrips(account);
            if (activeTrip && account?.rol === 'Conductor') {
                showMessage(appMessage, 'Conexión restablecida. Se recuperó tu viaje actual.');
                return;
            }
        }

        const disconnecting = driverConnected;
        if (disconnecting) {
            clearActiveTripUi();
            button.disabled = true;
        }
        await setDriverAvailability(!driverConnected);
        showMessage(appMessage, driverConnected
            ? 'Estás conectado y recibirás nuevas solicitudes.'
            : 'Te has desconectado y ya no recibirás solicitudes.');
    } catch (error) {
        showMessage(appMessage, error.message);
    } finally {
        button.disabled = Boolean(activeTrip
            && ['Aceptado', 'Llegando', 'EnCurso', 'PendientePago'].includes(activeTrip.estado));
    }
});

document.getElementById('cancel-ride').addEventListener('click', async (event) => {
    if (!activeTrip) return;
    const button = event.currentTarget;
    const tripId = activeTrip.id;
    button.disabled = true;
    try {
        await api(`/api/viajes/${tripId}/cancelar`, { method: 'POST' });
        if (activeTrip?.id === tripId) clearActiveTripUi();
        showMessage(appMessage, 'El viaje fue cancelado.');
    } catch (error) {
        showMessage(appMessage, error.message);
    } finally {
        button.disabled = false;
    }
});

document.getElementById('driver-cancel-ride').addEventListener('click', async (event) => {
    console.log('Clic en Cancelar Viaje del conductor.');
    if (!activeTrip) {
        console.warn('No se puede cancelar: no hay un viaje activo en la interfaz.');
        showMessage(appMessage, 'No hay un viaje activo para cancelar.');
        return;
    }
    if (!window.confirm('¿Estás seguro de cancelar el viaje?')) {
        console.log('Cancelación del viaje cancelada por el conductor.');
        return;
    }
    const button = event.currentTarget;
    const tripId = activeTrip.id;
    console.log('Enviando cancelación del viaje:', tripId);
    button.disabled = true;
    try {
        console.log('Token enviado a cancelar:', localStorage.getItem('gps-token') ? 'Sí existe' : 'NULO');
        await api(`/api/viajes/${tripId}/cancelar`, { method: 'POST' });
        if (activeTrip?.id === tripId) {
            console.log('Cancelación exitosa; limpiando la interfaz del conductor.');
            clearActiveTripUi();
            try {
                await setDriverAvailability(true);
                showMessage(appMessage, 'Viaje cancelado. Volviste a las solicitudes disponibles.');
            } catch (error) {
                showMessage(appMessage, `Viaje cancelado, pero no se pudo volver a las solicitudes: ${error.message}`);
            }
        } else if (activeTrip) {
            console.warn('La cancelación respondió correctamente, pero el viaje activo ya había cambiado.');
        } else {
            console.log('La interfaz ya fue limpiada por la notificación de SignalR.');
        }
    } catch (error) {
        showMessage(appMessage, error.message);
    } finally {
        button.disabled = false;
    }
});

document.getElementById('arriving-ride').addEventListener('click', async (event) => {
    if (!activeTrip) return;
    const button = event.currentTarget;
    button.disabled = true;
    try {
        const trip = await api(`/api/viajes/${activeTrip.id}/llegando`, { method: 'POST' });
        activeTrip = trip;
        showTrip(trip);
        showMessage(appMessage, 'Se notificó al pasajero que llegaste.');
    } catch (error) {
        showMessage(appMessage, error.message);
    } finally {
        button.disabled = false;
    }
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
    const button = document.getElementById('finish-ride');
    button.disabled = true;
    try {
        finalizationSummary = await api(`/api/viajes/${activeTrip.id}/finalizar`, { method: 'POST' });
        activeTrip = finalizationSummary.viaje;
        showTrip(activeTrip);
        showMessage(appMessage, 'Revisa el resumen y confirma cuando recibas el pago.');
    } catch (error) {
        showMessage(appMessage, error.message);
    } finally {
        button.disabled = false;
    }
});

document.getElementById('confirm-payment').addEventListener('click', async (event) => {
    if (!activeTrip) return;
    const button = event.currentTarget;
    button.disabled = true;
    try {
        activeTrip = await api(`/api/viajes/${activeTrip.id}/pago-recibido`, { method: 'POST' });
        finalizationSummary = null;
        showTrip(activeTrip);
        await loadDriverEarnings();
        showMessage(appMessage, 'Pago confirmado. El viaje quedó cerrado.');
    } catch (error) {
        showMessage(appMessage, error.message);
    } finally {
        button.disabled = false;
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

function announceDriverArrival() {
    if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') return;
    const message = new SpeechSynthesisUtterance('Tu conductor ha llegado. Por favor, prepárate.');
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
    driverConnected = false;
    syncDriverLocationTracking();
    driverMarker?.remove();
    driverMarker = null;
    localStorage.removeItem('gps-token');
    localStorage.removeItem('gps-user');
    localStorage.removeItem('gps-driver-connected');
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

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/service-worker.js')
            .catch((error) => console.error('No se pudo registrar el Service Worker de la app:', error));
    });
}
