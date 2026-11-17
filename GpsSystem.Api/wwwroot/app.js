let deferredPrompt = null;
const map = L.map('map').setView([10.3910, -75.4794], 13);
const satelliteLayer = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { attribution: 'Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community', maxZoom: 20 }
);
const streetsLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 19
});
const darkLayer = L.tileLayer(
    'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    { attribution: '&copy; OpenStreetMap contributors &copy; CARTO', subdomains: 'abcd', maxZoom: 20 }
);
satelliteLayer.addTo(map);
L.control.layers({
    'Satélite': satelliteLayer,
    Calles: streetsLayer,
    Oscuro: darkLayer
}, null, { position: 'topright' }).addTo(map);
const telemetryMarkerIcon = L.divIcon({
    className: 'telemetry-map-marker',
    iconSize: [20, 20],
    iconAnchor: [10, 10]
});
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
const favoriteAddressFields = {
    home: {
        input: document.getElementById('home-address'),
        suggestions: document.getElementById('home-address-suggestions'),
        latitude: document.getElementById('home-lat'),
        longitude: document.getElementById('home-lng'),
        label: 'Casa'
    },
    work: {
        input: document.getElementById('work-address'),
        suggestions: document.getElementById('work-address-suggestions'),
        latitude: document.getElementById('work-lat'),
        longitude: document.getElementById('work-lng'),
        label: 'Trabajo'
    }
};
const searchCityLabel = document.getElementById('search-city');
const currentCityInput = document.getElementById('current-city');
const markers = new Map();
const routeStops = [];
let nextRouteStopId = 1;
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
const favoriteSearchTimers = { home: null, work: null };
const favoriteSearchControllers = { home: null, work: null };
const favoriteSearchRequestIds = { home: 0, work: 0 };
let lastSearchStartedAt = 0;
let routeControl;
let routeWaypointCount = 0;
let activeTrip = null;
let appliedPromo = null;
let acceptedDriverContact = null;
let calls = null;
let chat = null;
let call = null;
let localStream = null;
let remoteDescriptionSet = false;
let queuedCandidates = [];
let pendingCallOffer = null;
let joinedTripId = null;
let fcmMessaging = null;
let fcmOnMessageRegistered = false;
let driverConnected = false;
let tripLocationWatchId = null;
let driverMarker = null;
let passengerMarker = null;
let finalizationSummary = null;
let sessionExpirationHandled = false;
let tripForRating = null;
let selectedTripRating = 0;
const latestDriverLocations = new Map();
const markerAnimationFrames = new WeakMap();

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

document.getElementById('passenger-sos').addEventListener('click', () => {
    if (!activeTrip || !['Aceptado', 'EnCurso'].includes(activeTrip.estado)) return;
    if (window.confirm('¿Estás en peligro? Se llamará a emergencias.')) {
        window.location.href = 'tel:123';
    }
});

document.getElementById('passenger-share-trip').addEventListener('click', async () => {
    if (!activeTrip || !['Aceptado', 'EnCurso'].includes(activeTrip.estado)) return;

    const trip = activeTrip;
    const destinationInput = document.getElementById('destination-search').value.trim();
    const coordinates = [Number(trip.destinoLat), Number(trip.destinoLng)];
    const destination = destinationInput
        || (coordinates.every(Number.isFinite)
            ? coordinates.map((coordinate) => coordinate.toFixed(5)).join(', ')
            : 'destino indicado');
    const title = 'Mi viaje en UbicacionGPS';
    const text = `Estoy viajando con ${trip.conductorNombre || 'un conductor'} en un ${trip.vehiculo || 'vehículo no especificado'}. Mi destino es ${destination}.`;
    const shareData = { title, text, url: window.location.href };

    if (!navigator.share) {
        window.alert(`${title}\n${text}\n${shareData.url}`);
        return;
    }

    try {
        await navigator.share(shareData);
    } catch (error) {
        if (error.name !== 'AbortError') {
            showMessage(appMessage, `No se pudo compartir el viaje: ${error.message}`);
        }
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

function updateProfileRating(account) {
    const summary = document.getElementById('profile-rating-summary');
    summary.hidden = account?.rol !== 'Conductor';
    summary.textContent = `⭐ ${Number(account?.promedioCalificacion ?? 5).toFixed(1)} / 5.0 · ${Number(account?.totalCalificaciones ?? 0)} viajes calificados`;
}

function updateTripRatingStars() {
    document.querySelectorAll('#trip-rating-stars .rating-star').forEach((button) => {
        const selected = Number(button.dataset.rating) <= selectedTripRating;
        button.classList.toggle('is-selected', selected);
        button.setAttribute('aria-pressed', String(Number(button.dataset.rating) === selectedTripRating));
    });
    document.getElementById('submit-trip-rating').disabled = selectedTripRating === 0;
}

function openTripRating(trip, ignoreDismissal = false) {
    if (trip.estado !== 'Finalizado' || trip.calificacion != null
        || JSON.parse(localStorage.getItem('gps-user'))?.rol !== 'Pasajero') return false;

    const dismissedKey = `gps-rating-dismissed-${trip.id}`;
    if (!ignoreDismissal && sessionStorage.getItem(dismissedKey) === 'true') return false;
    if (!document.getElementById('trip-rating-modal').hidden && tripForRating?.id === trip.id) return true;

    tripForRating = trip;
    selectedTripRating = 0;
    document.getElementById('trip-rating-driver').textContent =
        trip.conductorNombre ? `Conductor: ${trip.conductorNombre}` : '¿Cómo fue tu viaje?';
    document.querySelector('#trip-rating-form [name="comentario"]').value = '';
    showMessage(document.getElementById('trip-rating-message'));
    updateTripRatingStars();
    document.getElementById('trip-rating-modal').hidden = false;
    return true;
}

function closeTripRating(dismiss = true) {
    if (dismiss && tripForRating) {
        sessionStorage.setItem(`gps-rating-dismissed-${tripForRating.id}`, 'true');
    }
    document.getElementById('trip-rating-modal').hidden = true;
    tripForRating = null;
}

function maybePromptTripRating(trip) {
    openTripRating(trip);
}

async function loadTripHistory() {
    const message = document.getElementById('trip-history-message');
    const list = document.getElementById('trip-history-list');
    list.replaceChildren();
    showMessage(message, 'Cargando historial...');
    try {
        const trips = await api('/api/viajes/historial');
        showMessage(message, trips.length ? '' : 'Todavía no tienes viajes finalizados o cancelados.');
        const account = JSON.parse(localStorage.getItem('gps-user'));
        for (const trip of trips) {
            const item = document.createElement('article');
            item.className = 'trip-history-item';

            const heading = document.createElement('strong');
            heading.textContent = `${trip.estado} · ${new Date(trip.fechaCreacion).toLocaleString('es-CO')}`;
            const route = document.createElement('p');
            route.textContent = `Origen: ${Number(trip.origenLat).toFixed(5)}, ${Number(trip.origenLng).toFixed(5)} → Destino: ${Number(trip.destinoLat).toFixed(5)}, ${Number(trip.destinoLng).toFixed(5)}`;
            const price = document.createElement('p');
            price.textContent = `Precio: ${formatCurrency(trip.precio)}`;
            item.append(heading, route, price);

            if (trip.calificacion != null) {
                const rating = document.createElement('p');
                rating.className = 'trip-history-rating';
                rating.textContent = `Calificación: ${'⭐'.repeat(trip.calificacion)} ${trip.calificacion}/5${trip.comentarioCalificacion ? ` · ${trip.comentarioCalificacion}` : ''}`;
                item.append(rating);
            } else if (account?.rol === 'Pasajero' && trip.estado === 'Finalizado') {
                const rateButton = document.createElement('button');
                rateButton.className = 'secondary';
                rateButton.type = 'button';
                rateButton.textContent = 'Calificar conductor';
                rateButton.addEventListener('click', () => {
                    document.getElementById('trip-history-modal').hidden = true;
                    openTripRating(trip, true);
                });
                item.append(rateButton);
            }
            list.append(item);
        }
    } catch (error) {
        showMessage(message, error.message);
    }
}

async function loadPassengerHistory() {
    const message = document.getElementById('passenger-history-message');
    const list = document.getElementById('passenger-history-list');
    list.replaceChildren();
    document.getElementById('passenger-history-total-trips').textContent = '0';
    document.getElementById('passenger-history-total-spent').textContent = formatCurrency(0);
    showMessage(message, 'Cargando historial...');
    try {
        const [statistics, trips] = await Promise.all([
            api('/api/viajes/estadisticas-pasajero'),
            api('/api/viajes/historial-pasajero')
        ]);
        document.getElementById('passenger-history-total-trips').textContent =
            String(statistics.totalViajes);
        document.getElementById('passenger-history-total-spent').textContent =
            formatCurrency(statistics.totalGastado);
        showMessage(message, trips.length ? '' : 'Aún no tienes viajes finalizados.');

        for (const trip of trips) {
            const item = document.createElement('article');
            item.className = 'trip-history-item';

            const date = document.createElement('strong');
            date.textContent = new Date(trip.fecha).toLocaleString('es-CO');
            const destination = document.createElement('p');
            destination.textContent =
                `Destino: ${Number(trip.destinoLat).toFixed(5)}, ${Number(trip.destinoLng).toFixed(5)}`;
            const origin = document.createElement('p');
            origin.textContent =
                `Origen: ${Number(trip.origenLat).toFixed(5)}, ${Number(trip.origenLng).toFixed(5)}`;
            const driver = document.createElement('p');
            driver.textContent = `Conductor: ${trip.conductorNombre || 'No disponible'}`;
            const price = document.createElement('p');
            price.textContent = `Precio: ${formatCurrency(trip.montoPagado)}`;
            item.append(date, destination, origin, driver, price);
            list.append(item);
        }
    } catch (error) {
        showMessage(message, error.message);
    }
}

document.getElementById('open-passenger-history').addEventListener('click', async () => {
    document.getElementById('passenger-history-modal').hidden = false;
    await loadPassengerHistory();
});
document.getElementById('close-passenger-history').addEventListener('click', () => {
    document.getElementById('passenger-history-modal').hidden = true;
});
document.getElementById('passenger-history-modal').addEventListener('click', (event) => {
    if (event.target === event.currentTarget) event.currentTarget.hidden = true;
});

document.getElementById('open-trip-history').addEventListener('click', async () => {
    document.getElementById('trip-history-modal').hidden = false;
    await loadTripHistory();
});
document.getElementById('open-admin-panel').addEventListener('click', () => {
    window.location.href = '/admin.html';
});
document.getElementById('close-trip-history').addEventListener('click', () => {
    document.getElementById('trip-history-modal').hidden = true;
});
document.getElementById('open-driver-wallet').addEventListener('click', async () => {
    const modal = document.getElementById('driver-wallet-modal');
    modal.hidden = false;
    document.getElementById('wallet-message').textContent = '';
    try {
        await cargarBilletera();
    } catch (error) {
        document.getElementById('wallet-message').textContent =
            `No se pudo cargar la billetera: ${error.message}`;
    }
});
document.getElementById('close-driver-wallet').addEventListener('click', () => {
    document.getElementById('driver-wallet-modal').hidden = true;
});
document.getElementById('settle-pending-balance').addEventListener('click', () => {
    window.alert('Para liquidar tu saldo, transfiere a Nequi 300-123-4567 y envía el comprobante');
});
document.getElementById('driver-wallet-modal').addEventListener('click', (event) => {
    if (event.target === event.currentTarget) event.currentTarget.hidden = true;
});
document.getElementById('open-driver-documents').addEventListener('click', () => {
    const account = JSON.parse(localStorage.getItem('gps-user'));
    actualizarInterfazVerificacionConductor(account);
    showMessage(document.getElementById('driver-documents-message'));
    document.getElementById('driver-documents-modal').hidden = false;
});
document.getElementById('close-driver-documents').addEventListener('click', () => {
    document.getElementById('driver-documents-modal').hidden = true;
});
document.getElementById('cancel-driver-documents').addEventListener('click', () => {
    document.getElementById('driver-documents-modal').hidden = true;
});
document.getElementById('driver-documents-modal').addEventListener('click', (event) => {
    if (event.target === event.currentTarget) event.currentTarget.hidden = true;
});
document.querySelectorAll('.upload-driver-document').forEach((button) => {
    button.addEventListener('click', async () => {
        const fileInput = document.getElementById(button.dataset.fileInput);
        const status = document.getElementById(button.dataset.statusId);
        const file = fileInput.files[0];
        if (!file) {
            showMessage(document.getElementById('driver-documents-message'), 'Selecciona un archivo antes de subirlo.');
            return;
        }

        const formData = new FormData();
        formData.append('archivo', file);
        formData.append('tipoDocumento', button.dataset.documentType);
        button.disabled = true;
        showMessage(status, 'Subiendo documento...');
        showMessage(document.getElementById('driver-documents-message'));
        try {
            const verification = await apiFormData('/api/conductor/subir-documento', formData);
            const account = JSON.parse(localStorage.getItem('gps-user'));
            if (!account) throw new Error('No se encontró la sesión del conductor.');
            account.estadoVerificacion = verification.estadoVerificacion;
            account.fechaVencimientoDocumentos = verification.fechaVencimientoDocumentos;
            account.motivoRechazo = verification.motivoRechazo;
            account.tieneLicencia = verification.tieneLicencia;
            account.tieneSoat = verification.tieneSoat;
            account.tieneTarjetaPropiedad = verification.tieneTarjetaPropiedad;
            localStorage.setItem('gps-user', JSON.stringify(account));
            actualizarInterfazVerificacionConductor(account);
            fileInput.value = '';
            showMessage(
                document.getElementById('driver-documents-message'),
                'Documento cargado. Sube los demás y envía la verificación.'
            );
        } catch (error) {
            showMessage(status, 'No se pudo subir el documento.');
            showMessage(document.getElementById('driver-documents-message'), error.message);
        } finally {
            button.disabled = false;
        }
    });
});
document.getElementById('submit-driver-verification').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    showMessage(document.getElementById('driver-documents-message'), 'Enviando documentos a revisión...');
    try {
        const verification = await api('/api/conductor/enviar-verificacion', { method: 'POST' });
        const account = JSON.parse(localStorage.getItem('gps-user'));
        if (!account) throw new Error('No se encontró la sesión del conductor.');
        account.estadoVerificacion = verification.estadoVerificacion;
        account.fechaVencimientoDocumentos = verification.fechaVencimientoDocumentos;
        account.motivoRechazo = verification.motivoRechazo;
        account.tieneLicencia = verification.tieneLicencia;
        account.tieneSoat = verification.tieneSoat;
        account.tieneTarjetaPropiedad = verification.tieneTarjetaPropiedad;
        localStorage.setItem('gps-user', JSON.stringify(account));
        actualizarInterfazVerificacionConductor(account);
        showMessage(document.getElementById('driver-documents-message'), 'Documentos enviados para verificación.');
    } catch (error) {
        showMessage(document.getElementById('driver-documents-message'), error.message);
    } finally {
        button.disabled = false;
    }
});
document.querySelectorAll('#trip-rating-stars .rating-star').forEach((button) => {
    button.addEventListener('click', () => {
        selectedTripRating = Number(button.dataset.rating);
        updateTripRatingStars();
    });
});
document.getElementById('close-trip-rating').addEventListener('click', () => closeTripRating());
document.getElementById('skip-trip-rating').addEventListener('click', () => closeTripRating());
document.getElementById('trip-rating-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!tripForRating || selectedTripRating < 1 || selectedTripRating > 5) return;

    const submitButton = document.getElementById('submit-trip-rating');
    const trip = tripForRating;
    const comment = document.querySelector('#trip-rating-form [name="comentario"]').value.trim();
    submitButton.disabled = true;
    showMessage(document.getElementById('trip-rating-message'));
    try {
        const ratedTrip = await api(`/api/viajes/${trip.id}/calificar`, {
            method: 'POST',
            body: JSON.stringify({ estrellas: selectedTripRating, comentario: comment || null })
        });
        sessionStorage.removeItem(`gps-rating-dismissed-${trip.id}`);
        if (activeTrip?.id === trip.id) activeTrip = { ...activeTrip, ...ratedTrip };
        closeTripRating(false);
        showMessage(appMessage, 'Gracias por calificar a tu conductor.');
        if (!document.getElementById('trip-history-modal').hidden) await loadTripHistory();
    } catch (error) {
        showMessage(document.getElementById('trip-rating-message'), error.message);
    } finally {
        submitButton.disabled = selectedTripRating === 0;
    }
});

document.getElementById('open-profile').addEventListener('click', () => {
    const account = JSON.parse(localStorage.getItem('gps-user'));
    const form = document.getElementById('profile-form');
    const passwordFields = document.getElementById('password-change-fields');
    document.getElementById('favorite-places-section').hidden = account?.rol !== 'Pasajero';
    for (const key of Object.keys(favoriteAddressFields)) {
        hideFavoriteAddressSuggestions(key);
    }
    passwordFields.hidden = true;
    document.getElementById('toggle-password-fields').textContent = '¿Quieres cambiar tu contraseña?';
    form.elements.namedItem('nombre').value = account?.nombre || '';
    form.elements.namedItem('telefono').value = account?.telefono || '';
    form.elements.namedItem('direccionCasa').value = account?.direccionCasa || '';
    form.elements.namedItem('latCasa').value = account?.latCasa ?? '';
    form.elements.namedItem('lngCasa').value = account?.lngCasa ?? '';
    form.elements.namedItem('direccionTrabajo').value = account?.direccionTrabajo || '';
    form.elements.namedItem('latTrabajo').value = account?.latTrabajo ?? '';
    form.elements.namedItem('lngTrabajo').value = account?.lngTrabajo ?? '';
    form.elements.namedItem('passwordActual').value = '';
    form.elements.namedItem('passwordNueva').value = '';
    updateProfileRating(account);
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
        const account = JSON.parse(localStorage.getItem('gps-user'));
        if (account?.rol === 'Pasajero') {
            const favoriteRequest = {
                direccionCasa: values.direccionCasa.trim() || null,
                latCasa: values.latCasa === '' ? null : Number(values.latCasa),
                lngCasa: values.lngCasa === '' ? null : Number(values.lngCasa),
                direccionTrabajo: values.direccionTrabajo.trim() || null,
                latTrabajo: values.latTrabajo === '' ? null : Number(values.latTrabajo),
                lngTrabajo: values.lngTrabajo === '' ? null : Number(values.lngTrabajo)
            };
            const missingCoordinates = [
                ['Casa', favoriteRequest.direccionCasa, favoriteRequest.latCasa, favoriteRequest.lngCasa],
                ['Trabajo', favoriteRequest.direccionTrabajo, favoriteRequest.latTrabajo, favoriteRequest.lngTrabajo]
            ].some(([, address, latitude, longitude]) =>
                (address && (latitude === null || longitude === null))
                || (!address && (latitude !== null || longitude !== null)));
            if (missingCoordinates) {
                showMessage(
                    document.getElementById('profile-message'),
                    'Selecciona una dirección sugerida para Casa y Trabajo antes de guardar.'
                );
                return;
            }
            const favoriteProfile = await api('/api/auth/lugares-favoritos', {
                method: 'PUT',
                body: JSON.stringify(favoriteRequest)
            });
            account.direccionCasa = favoriteProfile.direccionCasa;
            account.latCasa = favoriteProfile.latCasa;
            account.lngCasa = favoriteProfile.lngCasa;
            account.direccionTrabajo = favoriteProfile.direccionTrabajo;
            account.latTrabajo = favoriteProfile.latTrabajo;
            account.lngTrabajo = favoriteProfile.lngTrabajo;
            localStorage.setItem('gps-user', JSON.stringify(account));
        }

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
        account.nombre = profile.nombre;
        account.telefono = profile.telefono;
        account.promedioCalificacion = profile.promedioCalificacion;
        account.totalCalificaciones = profile.totalCalificaciones;
        account.direccionCasa = profile.direccionCasa;
        account.latCasa = profile.latCasa;
        account.lngCasa = profile.lngCasa;
        account.direccionTrabajo = profile.direccionTrabajo;
        account.latTrabajo = profile.latTrabajo;
        account.lngTrabajo = profile.lngTrabajo;
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
    addressMarkers[prefix] = L.marker([result.y, result.x], { icon: telemetryMarkerIcon })
        .addTo(map)
        .bindPopup(result.label);
    map.setView([result.y, result.x], Math.max(map.getZoom(), 15));
    addressMarkers[prefix].openPopup();
    hideAddressSuggestions(prefix);
}

function goToFavoritePlace(key) {
    const account = JSON.parse(localStorage.getItem('gps-user'));
    const favorite = key === 'home'
        ? { address: account?.direccionCasa, latitude: account?.latCasa, longitude: account?.lngCasa }
        : { address: account?.direccionTrabajo, latitude: account?.latTrabajo, longitude: account?.lngTrabajo };
    const placeName = key === 'home' ? 'Casa' : 'Trabajo';
    const latitude = Number(favorite.latitude);
    const longitude = Number(favorite.longitude);
    if (!favorite.address
        || favorite.latitude === null || favorite.latitude === undefined
        || favorite.longitude === null || favorite.longitude === undefined
        || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        window.alert(`Aún no has guardado tu dirección de ${placeName}. Ve a Mi Perfil para configurarla`);
        return;
    }

    selectAddress('destination', {
        label: favorite.address,
        y: latitude,
        x: longitude
    });

    const originLatitudeValue = document.getElementById('origin-lat').value;
    const originLongitudeValue = document.getElementById('origin-lng').value;
    const originLatitude = Number(originLatitudeValue);
    const originLongitude = Number(originLongitudeValue);
    if (!activeTrip
        && originLatitudeValue !== ''
        && originLongitudeValue !== ''
        && Number.isFinite(originLatitude)
        && Number.isFinite(originLongitude)) {
        showRoute({
            origenLat: originLatitude,
            origenLng: originLongitude,
            destinoLat: latitude,
            destinoLng: longitude
        });
    } else if (!activeTrip) {
        showMessage(appMessage, 'Selecciona un origen para dibujar la ruta hacia este lugar.');
    }
}

document.getElementById('go-home').addEventListener('click', () => goToFavoritePlace('home'));
document.getElementById('go-work').addEventListener('click', () => goToFavoritePlace('work'));

function hideFavoriteAddressSuggestions(key) {
    const field = favoriteAddressFields[key];
    field.suggestions.hidden = true;
    field.input.setAttribute('aria-expanded', 'false');
}

for (const [key, field] of Object.entries(favoriteAddressFields)) {
    field.input.addEventListener('input', () => {
        clearTimeout(favoriteSearchTimers[key]);
        favoriteSearchControllers[key]?.abort();
        favoriteSearchRequestIds[key] += 1;
        const requestId = favoriteSearchRequestIds[key];
        field.latitude.value = '';
        field.longitude.value = '';
        const query = field.input.value.trim();
        if (query.length < 3 || !geocodeProvider) {
            hideFavoriteAddressSuggestions(key);
            return;
        }

        favoriteSearchTimers[key] = setTimeout(async () => {
            const delay = Math.max(0, 1000 - (Date.now() - lastSearchStartedAt));
            const loading = document.createElement('p');
            loading.className = 'destination-suggestion-empty';
            loading.setAttribute('role', 'status');
            loading.textContent = 'Buscando...';
            field.suggestions.replaceChildren(loading);
            field.suggestions.hidden = false;
            field.input.setAttribute('aria-expanded', 'true');
            if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
            if (requestId !== favoriteSearchRequestIds[key]) return;

            const controller = new AbortController();
            favoriteSearchControllers[key] = controller;
            lastSearchStartedAt = Date.now();
            try {
                const results = await geocodeProvider.search({
                    query: `${query}, Colombia`,
                    signal: controller.signal
                });
                if (requestId !== favoriteSearchRequestIds[key]) return;
                if (searchCityBounds) {
                    results.sort((first, second) =>
                        Number(addressResultIsInCity(second)) - Number(addressResultIsInCity(first)));
                }
                field.suggestions.replaceChildren();
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
                        option.addEventListener('click', () => {
                            field.input.value = result.label;
                            field.latitude.value = result.y;
                            field.longitude.value = result.x;
                            hideFavoriteAddressSuggestions(key);
                            showMessage(document.getElementById('profile-message'));
                        });
                        field.suggestions.append(option);
                    }
                }
                field.suggestions.hidden = false;
                field.input.setAttribute('aria-expanded', 'true');
            } catch (error) {
                if (error.name !== 'AbortError' && requestId === favoriteSearchRequestIds[key]) {
                    showMessage(
                        document.getElementById('profile-message'),
                        `No se pudo buscar la dirección de ${field.label}. Inténtalo de nuevo.`
                    );
                    hideFavoriteAddressSuggestions(key);
                }
            }
        }, 350);
    });
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

function configureAddressSearch(prefix, field) {
    addressSearchFields[prefix] = field;
    searchTimers[prefix] ??= null;
    searchControllers[prefix] ??= null;
    searchRequestIds[prefix] ??= 0;
    addressMarkers[prefix] ??= null;

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

for (const [prefix, field] of Object.entries(addressSearchFields)) {
    configureAddressSearch(prefix, field);
}

function updateRouteStopControls() {
    routeStops.forEach((prefix, index) => {
        document.getElementById(`${prefix}-label`).textContent = `Parada ${index + 1}`;
        document.getElementById(`${prefix}-remove`).setAttribute(
            'aria-label',
            `Eliminar parada ${index + 1}`);
    });
    document.getElementById('add-route-stop').disabled = routeStops.length >= 3;
}

function addRouteStop() {
    if (routeStops.length >= 3) return;

    const prefix = `route-stop-${nextRouteStopId++}`;
    const row = document.createElement('div');
    row.id = `${prefix}-row`;
    row.className = 'route-stop-row';

    const searchContainer = document.createElement('div');
    searchContainer.className = 'destination-search route-stop-search';
    const label = document.createElement('label');
    label.id = `${prefix}-label`;
    label.htmlFor = `${prefix}-search`;
    label.textContent = `Parada ${routeStops.length + 1}`;

    const input = document.createElement('input');
    input.id = `${prefix}-search`;
    input.type = 'search';
    input.placeholder = 'Escribe una dirección o lugar';
    input.autocomplete = 'off';
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-controls', `${prefix}-suggestions`);
    input.setAttribute('aria-expanded', 'false');
    label.append(input);

    const suggestions = document.createElement('div');
    suggestions.id = `${prefix}-suggestions`;
    suggestions.className = 'destination-suggestions';
    suggestions.setAttribute('role', 'listbox');
    suggestions.hidden = true;
    const latitude = document.createElement('input');
    latitude.id = `${prefix}-lat`;
    latitude.type = 'hidden';
    const longitude = document.createElement('input');
    longitude.id = `${prefix}-lng`;
    longitude.type = 'hidden';
    searchContainer.append(label, suggestions, latitude, longitude);

    const removeButton = document.createElement('button');
    removeButton.id = `${prefix}-remove`;
    removeButton.type = 'button';
    removeButton.className = 'secondary compact route-stop-remove';
    removeButton.textContent = '❌';
    removeButton.addEventListener('click', () => removeRouteStop(prefix));
    row.append(searchContainer, removeButton);
    document.getElementById('route-stops-list').append(row);
    routeStops.push(prefix);
    configureAddressSearch(prefix, { input, suggestions });
    updateRouteStopControls();
}

function removeRouteStop(prefix) {
    const index = routeStops.indexOf(prefix);
    if (index < 0) return;

    cancelAddressSearch(prefix);
    hideAddressSuggestions(prefix);
    addressMarkers[prefix]?.remove();
    document.getElementById(`${prefix}-row`).remove();
    routeStops.splice(index, 1);
    delete addressSearchFields[prefix];
    delete searchTimers[prefix];
    delete searchControllers[prefix];
    delete searchRequestIds[prefix];
    delete addressMarkers[prefix];
    updateRouteStopControls();
}

function readRouteStops() {
    return routeStops.map((prefix) => ({
        input: addressSearchFields[prefix].input,
        latitude: document.getElementById(`${prefix}-lat`).value,
        longitude: document.getElementById(`${prefix}-lng`).value
    }));
}

document.getElementById('add-route-stop').addEventListener('click', addRouteStop);

document.addEventListener('click', (event) => {
    for (const [prefix, field] of Object.entries(addressSearchFields)) {
        if (!field.suggestions.contains(event.target) && event.target !== field.input) {
            hideAddressSuggestions(prefix);
        }
    }
    for (const [key, field] of Object.entries(favoriteAddressFields)) {
        if (!field.suggestions.contains(event.target) && event.target !== field.input) {
            hideFavoriteAddressSuggestions(key);
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

async function apiFormData(path, formData) {
    const token = localStorage.getItem('gps-token');
    const response = await fetch(path, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData
    });
    if (!response.ok) {
        if (response.status === 401 && token) {
            cerrarSesionPorExpiracion();
            throw new Error('Sesión expirada. Vuelve a iniciar sesión.');
        }

        const problem = await response.json().catch(() => null);
        throw new Error(problem?.detail || problem?.title || `Error HTTP ${response.status}`);
    }

    return response.json();
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
        if (form) {
            form.reset();
        }
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

function puedeConducir(account) {
    if (account?.rol !== 'Conductor' || account.estadoVerificacion !== 'Aprobado'
        || !account.fechaVencimientoDocumentos) return false;
    const expiry = new Date(account.fechaVencimientoDocumentos);
    if (!Number.isFinite(expiry.getTime())) return false;
    return expiry.toISOString().slice(0, 10) >= new Date().toISOString().slice(0, 10);
}

function actualizarInterfazVerificacionConductor(account) {
    const esConductor = account?.rol === 'Conductor';
    const estado = account?.estadoVerificacion || 'Pendiente';
    const puedeTrabajar = puedeConducir(account);
    const estadoVisible = estado === 'Aprobado' && !puedeTrabajar ? 'Vencido' : estado;
    const banner = document.getElementById('driver-verification-banner');
    banner.hidden = !esConductor || estadoVisible === 'Aprobado';
    const motivo = document.getElementById('driver-verification-reason');
    motivo.hidden = estadoVisible !== 'Rechazado' || !account?.motivoRechazo;
    motivo.textContent = motivo.hidden ? '' : `Motivo: ${account.motivoRechazo}`;
    document.getElementById('open-driver-documents').hidden =
        !esConductor || estadoVisible === 'Aprobado';

    document.getElementById('driver-documents-verification-status').textContent =
        `Estado de verificación: ${estadoVisible}${account?.fechaVencimientoDocumentos
            ? ` · Vencimiento: ${new Date(account.fechaVencimientoDocumentos).toLocaleDateString('es-CO')}`
            : ''}`;
    const rejectionReason = document.getElementById('driver-documents-rejection-reason');
    rejectionReason.hidden = estadoVisible !== 'Rechazado' || !account?.motivoRechazo;
    rejectionReason.textContent = rejectionReason.hidden
        ? ''
        : `Motivo del rechazo: ${account.motivoRechazo}`;
    document.getElementById('license-document-status').textContent =
        account?.tieneLicencia ? 'Documento cargado' : 'Aún no subido';
    document.getElementById('soat-document-status').textContent =
        account?.tieneSoat ? 'Documento cargado' : 'Aún no subido';
    document.getElementById('registration-document-status').textContent =
        account?.tieneTarjetaPropiedad ? 'Documento cargado' : 'Aún no subido';
    const availabilityButton = document.getElementById('driver-availability');
    availabilityButton.disabled = (!puedeTrabajar && !driverConnected) || Boolean(activeTrip);
    availabilityButton.textContent = estadoVisible === 'Vencido' && !driverConnected
        ? 'Documentos vencidos'
        : driverConnected ? 'Desconectarse' : 'Conectarse';
}

async function showAuthenticatedUi() {
    const account = JSON.parse(localStorage.getItem('gps-user'));
    if (!account || !localStorage.getItem('gps-token')) return;

    try {
        const profile = await api('/api/auth/perfil');
        account.telefono = profile.telefono;
        account.nombre = profile.nombre;
        account.promedioCalificacion = profile.promedioCalificacion;
        account.totalCalificaciones = profile.totalCalificaciones;
        account.direccionCasa = profile.direccionCasa;
        account.latCasa = profile.latCasa;
        account.lngCasa = profile.lngCasa;
        account.direccionTrabajo = profile.direccionTrabajo;
        account.latTrabajo = profile.latTrabajo;
        account.lngTrabajo = profile.lngTrabajo;
        account.estadoVerificacion = profile.estadoVerificacion;
        account.fechaVencimientoDocumentos = profile.fechaVencimientoDocumentos;
        account.motivoRechazo = profile.motivoRechazo;
        account.tieneLicencia = profile.tieneLicencia;
        account.tieneSoat = profile.tieneSoat;
        account.tieneTarjetaPropiedad = profile.tieneTarjetaPropiedad;
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
    actualizarInterfazVerificacionConductor(account);
    document.getElementById('open-admin-panel').hidden = account.rol !== 'Admin';
    document.getElementById('enable-notifications').textContent =
        sessionStorage.getItem('gps-fcm-token') ? 'Notificaciones activadas' : 'Activar notificaciones';
    showMessage(authMessage);

    try {
        await connectHubs();
        await restoreTrips(account);
        if (account.rol === 'Conductor') {
            const shouldConnect = puedeConducir(account)
                && localStorage.getItem('gps-driver-connected') === 'true'
                && !activeTrip;
            await setDriverAvailability(shouldConnect);
            await cargarBilletera();
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
            const swRegistration = await navigator.serviceWorker.register('/firebase-messaging-sw.js', { scope: '/firebase/' });
            const token = await getToken(fcmMessaging, { vapidKey, serviceWorkerRegistration: swRegistration });
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
    viajes.on('UbicacionParticipante', (location) => {
        if (activeTrip?.id !== location.viajeId) return;
        if (location.rol === 'Conductor') {
            const driverLocation = {
                dispositivoId: location.usuarioId,
                latitud: location.latitud,
                longitud: location.longitud
            };
            updateDriverMarker(driverLocation);
            updatePassengerEta(driverLocation);
        } else {
            updatePassengerMarker(location);
        }
    });
    chat.on('RecibirMensaje', (message) => renderMessage(message));
    calls.on('OfertaLlamada', receiveOffer);
    calls.on('RespuestaLlamada', receiveAnswer);
    calls.on('CandidatoIce', receiveCandidate);
    calls.on('LlamadaRechazada', () => endCall('Llamada rechazada'));

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

async function cargarBilletera() {
    const [earnings, history, today] = await Promise.all([
        api('/api/viajes/ganancias'),
        api('/api/viajes/historial-conductor'),
        api('/api/viajes/finanzas-hoy')
    ]);
    const formattedEarnings = formatCurrency(earnings.gananciasAcumuladas);
    document.getElementById('driver-earnings-amount').textContent = formattedEarnings;
    document.getElementById('wallet-collected-today').textContent =
        formatCurrency(today.totalRecaudado);
    document.getElementById('wallet-net-today').textContent =
        formatCurrency(today.gananciaNetaHoy);
    document.getElementById('wallet-pending-balance').textContent =
        formatCurrency(today.saldoPendiente);
    document.getElementById('settle-pending-balance').hidden =
        Number(today.saldoPendiente) <= 0;

    const rows = document.getElementById('wallet-trip-list');
    rows.replaceChildren();
    history.forEach((trip) => {
        const row = document.createElement('tr');
        const values = [
            new Date(trip.fecha).toLocaleString('es-CO'),
            formatCurrency(trip.montoTotal),
            formatCurrency(trip.gananciaNeta)
        ];
        values.forEach((value) => {
            const cell = document.createElement('td');
            cell.textContent = value;
            row.append(cell);
        });
        rows.append(row);
    });

    const hasHistory = history.length > 0;
    document.getElementById('wallet-history-container').hidden = !hasHistory;
    document.getElementById('wallet-empty').hidden = hasHistory;
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
    passengerDetails.append(passengerName);
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
    if (activeTrip && activeTrip.id !== trip.id) {
        setDriverContact(null);
        removeLiveMarkers();
    }
    activeTrip = trip;
    showRoute(trip);
    const account = JSON.parse(localStorage.getItem('gps-user'));
    maybePromptTripRating(trip);
    syncTripLocationTracking();
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
        const price = document.createElement('p');
        price.textContent = `Tarifa total: ${formatCurrency(trip.precio)}`;
        panel.append(title, details, price);
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
        document.getElementById('view-passenger-profile').hidden = !hasCurrentTrip;
        document.getElementById('driver-pin-guidance').hidden =
            !['Aceptado', 'Llegando'].includes(trip.estado);
        document.getElementById('arriving-ride').hidden = trip.estado !== 'Aceptado';
        document.getElementById('driver-cancel-ride').hidden =
            !['Aceptado', 'Llegando'].includes(trip.estado);
        document.getElementById('pin-form').hidden = !['Aceptado', 'Llegando'].includes(trip.estado);
        document.getElementById('finish-ride').hidden = trip.estado !== 'EnCurso';
        document.getElementById('driver-availability').disabled =
            hasCurrentTrip || (!puedeConducir(account) && !driverConnected);
        if (showPaymentSummary) {
            const summary = finalizationSummary || {
                montoTotal: trip.precio,
                gananciaNeta: trip.precio
            };
            document.getElementById('payment-total').textContent = formatCurrency(summary.montoTotal);
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
    if (trip.estado === 'Finalizado') {
        removeLiveMarkers();
    }
}

function estimatedTripDistance(trip) {
    const radians = (degrees) => degrees * Math.PI / 180;
    const waypoints = [
        { latitud: trip.origenLat, longitud: trip.origenLng },
        ...(trip.paradas || [])
            .slice()
            .sort((first, second) => first.orden - second.orden),
        { latitud: trip.destinoLat, longitud: trip.destinoLng }
    ];
    let distanceKm = 0;
    for (let index = 1; index < waypoints.length; index++) {
        const origin = waypoints[index - 1];
        const destination = waypoints[index];
        const latitudeDelta = radians(destination.latitud - origin.latitud);
        const longitudeDelta = radians(destination.longitud - origin.longitud);
        const originLatitude = radians(origin.latitud);
        const destinationLatitude = radians(destination.latitud);
        const haversine = Math.sin(latitudeDelta / 2) ** 2
            + Math.cos(originLatitude) * Math.cos(destinationLatitude)
            * Math.sin(longitudeDelta / 2) ** 2;
        distanceKm += 2 * 6371 * Math.asin(Math.sqrt(haversine));
    }
    return distanceKm * 1.3;
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
    const showSafetyActions = ['Aceptado', 'EnCurso'].includes(trip.estado);
    const hasDriver = Boolean(trip.conductorId)
        && !['Cancelado', 'Finalizado'].includes(trip.estado);

    searchStatus.hidden = !isSearching;
    activeTripCard.hidden = !hasDriver;
    document.getElementById('passenger-sos').hidden = !showSafetyActions;
    document.getElementById('passenger-share-trip').hidden = !showSafetyActions;
    const passengerPin = document.getElementById('passenger-trip-pin');
    const showPassengerPin = Boolean(trip.pin) && ['Aceptado', 'Llegando'].includes(trip.estado);
    passengerPin.hidden = !showPassengerPin;
    document.getElementById('passenger-trip-pin-value').textContent =
        showPassengerPin ? trip.pin : '';
    if (!hasDriver) {
        setDriverContact(null);
        document.getElementById('passenger-driver-call').removeAttribute('href');
        document.getElementById('passenger-driver-call').hidden = true;
        document.getElementById('view-driver-profile').hidden = true;
        return;
    }

    document.getElementById('view-driver-profile').hidden = false;
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

function showTripOtherUserProfile() {
    if (!activeTrip) return;
    const isPassenger = JSON.parse(localStorage.getItem('gps-user'))?.rol === 'Pasajero';
    const profile = isPassenger
        ? {
            id: activeTrip.conductorId,
            nombre: activeTrip.conductorNombre,
            promedio: activeTrip.conductorPromedioCalificacion,
            totalViajes: activeTrip.conductorTotalViajes
        }
        : {
            id: activeTrip.pasajeroId,
            nombre: activeTrip.pasajeroNombre,
            promedio: activeTrip.pasajeroPromedioCalificacion,
            totalViajes: activeTrip.pasajeroTotalViajes
        };
    if (!profile.id) return;

    const promedio = Math.max(0, Math.min(5, Number(profile.promedio) || 0));
    const estrellas = Math.round(promedio);
    document.getElementById('trip-user-profile-title').textContent = 'Perfil del viaje';
    document.getElementById('trip-user-profile-name').textContent = profile.nombre || 'Usuario';
    document.getElementById('trip-user-profile-rating').textContent =
        `${'★'.repeat(estrellas)}${'☆'.repeat(5 - estrellas)} ${promedio.toFixed(1)} / 5`;
    document.getElementById('trip-user-profile-total-trips').textContent =
        String(Number(profile.totalViajes) || 0);
    document.getElementById('trip-user-profile-modal').hidden = false;
}

document.getElementById('view-driver-profile').addEventListener('click', showTripOtherUserProfile);
document.getElementById('view-passenger-profile').addEventListener('click', showTripOtherUserProfile);
document.getElementById('close-trip-user-profile').addEventListener('click', () => {
    document.getElementById('trip-user-profile-modal').hidden = true;
});
document.getElementById('trip-user-profile-modal').addEventListener('click', (event) => {
    if (event.target === event.currentTarget) event.currentTarget.hidden = true;
});

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
        moveMarkerSmoothly(driverMarker, position);
    }
}

function updatePassengerMarker(location) {
    const account = JSON.parse(localStorage.getItem('gps-user'));
    if (account?.rol !== 'Conductor'
        || location.usuarioId !== activeTrip?.pasajeroId) return;

    const position = [location.latitud, location.longitud];
    if (!passengerMarker) {
        passengerMarker = L.marker(position, {
            icon: L.divIcon({
                className: 'live-passenger-marker',
                iconSize: [18, 18],
                iconAnchor: [9, 9]
            })
        }).addTo(map).bindPopup('Ubicación del pasajero');
    } else {
        moveMarkerSmoothly(passengerMarker, position);
    }
}

function removeLiveMarkers() {
    driverMarker?.remove();
    passengerMarker?.remove();
    driverMarker = null;
    passengerMarker = null;
}

function moveMarkerSmoothly(marker, position) {
    const previousFrame = markerAnimationFrames.get(marker);
    if (previousFrame) cancelAnimationFrame(previousFrame);

    const start = marker.getLatLng();
    const startedAt = performance.now();
    const duration = 450;
    const animate = (now) => {
        const progress = Math.min(1, (now - startedAt) / duration);
        const eased = progress * (2 - progress);
        marker.setLatLng([
            start.lat + (position[0] - start.lat) * eased,
            start.lng + (position[1] - start.lng) * eased
        ]);
        if (progress < 1) {
            markerAnimationFrames.set(marker, requestAnimationFrame(animate));
        } else {
            markerAnimationFrames.delete(marker);
        }
    };
    markerAnimationFrames.set(marker, requestAnimationFrame(animate));
}

function syncTripLocationTracking() {
    const account = JSON.parse(localStorage.getItem('gps-user'));
    const hasActiveRide = ['Aceptado', 'Llegando', 'EnCurso'].includes(activeTrip?.estado);
    const shouldTrack = ['Conductor', 'Pasajero'].includes(account?.rol) && hasActiveRide;
    if (shouldTrack && tripLocationWatchId === null) {
        if (!navigator.geolocation) {
            showMessage(appMessage, 'Este dispositivo no ofrece geolocalización.');
            return;
        }
        tripLocationWatchId = navigator.geolocation.watchPosition(
            ({ coords }) => {
                const currentAccount = JSON.parse(localStorage.getItem('gps-user'));
                if (!currentAccount || !activeTrip) return;
                const location = {
                    latitud: coords.latitude,
                    longitud: coords.longitude,
                    velocidad: Math.max(0, coords.speed || 0)
                };
                const position = [location.latitud, location.longitud];
                if (activeTrip.estado === 'EnCurso') {
                    if (map.getZoom() !== 16) map.setZoom(16);
                    map.panTo(position, { animate: true, duration: 0.4 });
                }
                if (currentAccount.rol === 'Conductor') {
                    updateDriverMarker({ ...location, dispositivoId: currentAccount.usuarioId });
                }
                if (!viajes || viajes.state !== signalR.HubConnectionState.Connected || !activeTrip) return;
                viajes.invoke(
                    'ActualizarUbicacion',
                    activeTrip.id,
                    location.latitud,
                    location.longitud,
                    location.velocidad
                ).catch((error) => showMessage(appMessage, `No se pudo compartir la ubicación: ${error.message}`));
            },
            (error) => showMessage(appMessage, `No se pudo obtener la ubicación: ${error.message}`),
            { enableHighAccuracy: true, maximumAge: 3000, timeout: 20000 }
        );
    } else if (!shouldTrack && tripLocationWatchId !== null) {
        navigator.geolocation.clearWatch(tripLocationWatchId);
        tripLocationWatchId = null;
    }
}

async function setDriverAvailability(available) {
    if (!viajes || viajes.state !== signalR.HubConnectionState.Connected) {
        throw new Error('No se puede cambiar la disponibilidad sin conexión al servidor.');
    }
    if (available && !puedeConducir(JSON.parse(localStorage.getItem('gps-user')))) {
        throw new Error('Tus documentos están vencidos o pendientes de aprobación. Actualízalos antes de conectarte.');
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
    syncTripLocationTracking();
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
    document.getElementById('passenger-sos').hidden = true;
    document.getElementById('passenger-share-trip').hidden = true;
    document.getElementById('cancel-ride').hidden = true;
    document.getElementById('driver-cancel-ride').hidden = true;
    document.getElementById('driver-trip').hidden = true;
    document.getElementById('payment-summary').hidden = true;
    const account = JSON.parse(localStorage.getItem('gps-user'));
    document.getElementById('driver-availability').disabled =
        !puedeConducir(account) && !driverConnected;
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
    for (const prefix of [...routeStops]) {
        removeRouteStop(prefix);
    }
    removeLiveMarkers();
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
    syncTripLocationTracking();
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
    const orderedStops = [...(trip.paradas || [])]
        .sort((first, second) => first.orden - second.orden)
        .map((stop) => L.latLng(stop.latitud, stop.longitud));
    const waypoints = [start, ...orderedStops, end];
    routeWaypointCount = waypoints.length;
    if (!routeControl) {
        routeControl = L.Routing.control({
            waypoints,
            addWaypoints: false,
            draggableWaypoints: false,
            fitSelectedRoutes: true,
            position: 'bottomright',
            show: true,
            router: L.Routing.osrmv1({ language: 'es' }),
            lineOptions: { styles: [{ color: '#00b4d8', opacity: 0.95, weight: 8 }] },
            createMarker: (index, waypoint) => {
                const label = index === 0
                    ? 'Origen'
                    : index === routeWaypointCount - 1 ? 'Destino' : `Parada ${index}`;
                return L.marker(waypoint.latLng, { icon: telemetryMarkerIcon }).bindPopup(label);
            }
        }).addTo(map);
    } else {
        routeControl.setWaypoints(waypoints);
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
    const form = event.currentTarget;
    const values = formValues(form);
    try {
        await chat.invoke('EnviarMensaje', activeTrip.id, values.texto);
        if (form) {
            form.reset();
        }
    } catch (error) {
        showMessage(appMessage, error.message);
    }
});

const promoCodeInput = document.getElementById('promo-code');
const promoMessage = document.getElementById('promo-message');
const promoEstimate = document.getElementById('promo-estimate');
const promoEstimatedPrice = document.getElementById('promo-estimated-price');

promoCodeInput.addEventListener('input', () => {
    appliedPromo = null;
    promoMessage.className = 'message';
    promoMessage.textContent = '';
    promoEstimate.hidden = true;
});

document.getElementById('apply-promo').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const codigo = promoCodeInput.value.trim();
    if (!codigo) {
        promoMessage.className = 'message promo-feedback-error';
        promoMessage.textContent = 'Escribe un código de descuento.';
        return;
    }

    button.disabled = true;
    promoMessage.className = 'message';
    promoMessage.textContent = 'Validando cupón...';
    try {
        const result = await api('/api/viajes/validar-promo', {
            method: 'POST',
            body: JSON.stringify({ codigo })
        });
        appliedPromo = { codigo, porcentajeDescuento: result.porcentajeDescuento };
        promoMessage.className = 'message promo-feedback-success';
        promoMessage.textContent =
            `¡Cupón aplicado! ${result.porcentajeDescuento}% de descuento`;

        const estimate = calculatePromoEstimate(result.porcentajeDescuento);
        promoEstimate.hidden = estimate === null;
        if (estimate !== null) {
            promoEstimatedPrice.textContent = new Intl.NumberFormat('es-CO', {
                style: 'currency',
                currency: 'COP',
                maximumFractionDigits: 2
            }).format(estimate);
        }
    } catch (error) {
        appliedPromo = null;
        promoEstimate.hidden = true;
        promoMessage.className = 'message promo-feedback-error';
        promoMessage.textContent = error.message;
    } finally {
        button.disabled = false;
    }
});

function calculatePromoEstimate(porcentajeDescuento) {
    const coordinateInputs = [
        document.getElementById('origin-lat').value,
        document.getElementById('origin-lng').value,
        document.getElementById('destination-lat').value,
        document.getElementById('destination-lng').value
    ];
    if (coordinateInputs.some((coordinate) => !coordinate.trim())) return null;

    const coordinates = coordinateInputs.map(Number);
    if (coordinates.some((coordinate) => !Number.isFinite(coordinate))) return null;

    const stops = readRouteStops();
    if (stops.some((stop) =>
        !stop.input.value.trim()
        || !stop.latitude.trim()
        || !stop.longitude.trim()
        || !Number.isFinite(Number(stop.latitude))
        || !Number.isFinite(Number(stop.longitude)))) return null;

    const [origenLat, origenLng, destinoLat, destinoLng] = coordinates;
    const paradas = stops.map((stop, index) => ({
        orden: index + 1,
        latitud: Number(stop.latitude),
        longitud: Number(stop.longitude)
    }));
    const distanceKm = estimatedTripDistance({ origenLat, origenLng, destinoLat, destinoLng, paradas });
    const basePrice = Math.ceil((5000 + distanceKm * 1800) / 500) * 500;
    return Math.round(basePrice * (100 - porcentajeDescuento)) / 100;
}

document.getElementById('request-ride').addEventListener('click', async () => {
    const button = document.getElementById('request-ride');
    const originInput = addressSearchFields.origin.input;
    const originLat = document.getElementById('origin-lat').value;
    const originLng = document.getElementById('origin-lng').value;
    const destinationLat = document.getElementById('destination-lat').value;
    const destinationLng = document.getElementById('destination-lng').value;
    const stops = readRouteStops();
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
    const incompleteStop = stops.find((stop) =>
        !stop.input.value.trim() || !stop.latitude.trim() || !stop.longitude.trim()
        || !Number.isFinite(Number(stop.latitude)) || !Number.isFinite(Number(stop.longitude)));
    if (incompleteStop) {
        showMessage(appMessage, 'Selecciona una dirección sugerida para cada parada.');
        incompleteStop.input.focus();
        return;
    }
    const request = {
        origenLat: Number(originLat),
        origenLng: Number(originLng),
        destinoLat: Number(destinationLat),
        destinoLng: Number(destinationLng),
        metodoPago: document.getElementById('ride-payment-method').value
    };
    if (stops.length) {
        request.paradas = stops.map((stop) => ({
            latitud: Number(stop.latitude),
            longitud: Number(stop.longitude)
        }));
    }
    if (appliedPromo) request.codigoPromo = appliedPromo.codigo;
    button.disabled = true;
    try {
        const trip = await api('/api/viajes/solicitar', {
            method: 'POST',
            body: JSON.stringify(request)
        });
        appliedPromo = null;
        promoCodeInput.value = '';
        promoMessage.className = 'message';
        promoMessage.textContent = '';
        promoEstimate.hidden = true;
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
        const account = JSON.parse(localStorage.getItem('gps-user'));
        const hasCurrentTrip = Boolean(activeTrip
            && ['Aceptado', 'Llegando', 'EnCurso', 'PendientePago'].includes(activeTrip.estado));
        button.disabled = (!puedeConducir(account) && !driverConnected) || hasCurrentTrip;
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
        if (activeTrip.estado === 'Finalizado') {
            finalizationSummary = null;
            showMessage(appMessage, 'Pago electrónico registrado. El viaje quedó cerrado.');
        } else {
            showMessage(appMessage, 'Revisa el resumen y confirma cuando recibas el pago.');
        }
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
            addressMarkers.origin = L.marker([coords.latitude, coords.longitude], { icon: telemetryMarkerIcon })
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
            if (!call) return;
            document.getElementById('call-status').textContent =
                call.connectionState === 'connected' ? 'Llamada conectada' : `Llamada: ${call.connectionState}`;
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
    if (call || pendingCallOffer) {
        await calls.invoke('RechazarLlamada', activeTrip.id);
        return;
    }
    pendingCallOffer = signal;
    document.getElementById('incoming-call-modal').hidden = false;
    document.getElementById('call-status').textContent = 'Llamada entrante';
}

document.getElementById('accept-incoming-call').addEventListener('click', async () => {
    if (!pendingCallOffer || !activeTrip || !calls) return;
    const offer = pendingCallOffer;
    pendingCallOffer = null;
    document.getElementById('incoming-call-modal').hidden = true;
    try {
        await prepareCall();
        await call.setRemoteDescription({ type: 'offer', sdp: offer.valor });
        remoteDescriptionSet = true;
        await flushCandidates();
        const answer = await call.createAnswer();
        await call.setLocalDescription(answer);
        await calls.invoke('EnviarRespuesta', activeTrip.id, answer.sdp);
        document.getElementById('call-status').textContent = 'Conectando llamada...';
    } catch (error) {
        endCall(`No se pudo responder la llamada: ${error.message}`);
        showMessage(appMessage, error.message);
    }
});

document.getElementById('reject-incoming-call').addEventListener('click', async () => {
    if (!pendingCallOffer || !activeTrip || !calls) return;
    pendingCallOffer = null;
    queuedCandidates = [];
    remoteDescriptionSet = false;
    document.getElementById('incoming-call-modal').hidden = true;
    try {
        await calls.invoke('RechazarLlamada', activeTrip.id);
        document.getElementById('call-status').textContent = 'Llamada rechazada';
    } catch (error) {
        showMessage(appMessage, error.message);
    }
});

async function receiveAnswer(signal) {
    if (!call || call.signalingState !== 'have-local-offer') return;
    await call.setRemoteDescription({ type: 'answer', sdp: signal.valor });
    remoteDescriptionSet = true;
    await flushCandidates();
}

async function receiveCandidate(signal) {
    const candidate = new RTCIceCandidate(JSON.parse(signal.valor));
    if (!call || !remoteDescriptionSet) queuedCandidates.push(candidate);
    else await call.addIceCandidate(candidate);
}

async function flushCandidates() {
    for (const candidate of queuedCandidates) await call.addIceCandidate(candidate);
    queuedCandidates = [];
}

document.getElementById('end-call').addEventListener('click', endCall);

function endCall(status = 'Llamada finalizada') {
    pendingCallOffer = null;
    document.getElementById('incoming-call-modal').hidden = true;
    call?.close();
    call = null;
    localStream?.getTracks().forEach((track) => track.stop());
    localStream = null;
    remoteDescriptionSet = false;
    queuedCandidates = [];
    document.getElementById('remote-audio').srcObject = null;
    document.getElementById('end-call').hidden = true;
    document.getElementById('call-status').textContent = status;
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
    syncTripLocationTracking();
    removeLiveMarkers();
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
        navigator.serviceWorker.register('/sw.js')
            .catch((error) => console.error('No se pudo registrar el Service Worker de la app:', error));
    });
}

const installAppSection = document.getElementById('install-app');
const installAndroidButton = document.getElementById('install-android');
const installAppleButton = document.getElementById('install-apple');
const isIos = /iPad|iPhone|iPod/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = window.matchMedia('(display-mode: standalone)').matches
    || navigator.standalone === true;

if (isStandalone) {
    installAppSection.hidden = true;
} else if (isIos) {
    installAppSection.hidden = false;
    installAppleButton.hidden = false;
} else {
    installAppSection.hidden = true;
}

window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event;
    if (!isStandalone && !isIos) {
        installAppSection.hidden = false;
        installAndroidButton.hidden = false;
    }
});

installAndroidButton.addEventListener('click', async () => {
    if (!deferredPrompt) return;

    const installPrompt = deferredPrompt;
    deferredPrompt = null;
    try {
        await installPrompt.prompt();
        await installPrompt.userChoice;
    } finally {
        installAndroidButton.hidden = true;
        installAppSection.hidden = true;
    }
});

installAppleButton.addEventListener('click', () => {
    window.alert('Para instalar en iPhone: Toca el botón Compartir en Safari y selecciona Añadir a la pantalla de inicio');
});

window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    installAppSection.hidden = true;
});
