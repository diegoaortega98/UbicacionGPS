(() => {
    const status = document.getElementById('dashboard-status');
    const refreshButton = document.getElementById('refresh-dashboard');
    const promoForm = document.getElementById('promo-form');
    const promoStatus = document.getElementById('promo-status');
    const pendingDriversStatus = document.getElementById('pending-drivers-status');
    const pendingDriversList = document.getElementById('pending-drivers-list');
    const refreshPendingDriversButton = document.getElementById('refresh-pending-drivers');
    const currencyFormat = new Intl.NumberFormat('es-CO', {
        style: 'currency',
        currency: 'COP',
        maximumFractionDigits: 0
    });

    async function loadStatistics() {
        const token = localStorage.getItem('gps-token');
        if (!token) {
            window.location.replace('/');
            return;
        }

        refreshButton.disabled = true;
        status.textContent = 'Cargando estadísticas...';
        try {
            const response = await fetch('/api/admin/estadisticas', {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (response.status === 401) {
                window.location.replace('/');
                return;
            }
            if (response.status === 403) {
                throw new Error('Tu cuenta no tiene acceso al panel de administración.');
            }
            if (!response.ok) {
                throw new Error(`No se pudieron cargar las estadísticas (HTTP ${response.status}).`);
            }

            const statistics = await response.json();
            document.getElementById('total-viajes').textContent =
                Number(statistics.totalViajes).toLocaleString('es-CO');
            document.getElementById('comisiones-totales').textContent =
                currencyFormat.format(statistics.comisionesTotales);
            document.getElementById('viajes-hoy').textContent =
                Number(statistics.viajesHoy).toLocaleString('es-CO');
            document.getElementById('conductores-activos').textContent =
                Number(statistics.conductoresActivos).toLocaleString('es-CO');
            document.getElementById('recaudado-hoy').textContent =
                currencyFormat.format(statistics.recaudadoHoy);
            status.textContent = `Actualizado: ${new Date().toLocaleString('es-CO')}`;
        } catch (error) {
            status.textContent = error.message;
        } finally {
            refreshButton.disabled = false;
        }
    }

    function showPendingDriversTab(showPendingDrivers) {
        document.getElementById('dashboard-view').hidden = showPendingDrivers;
        document.getElementById('pending-drivers-view').hidden = !showPendingDrivers;
        document.getElementById('dashboard-tab-button').setAttribute('aria-selected', String(!showPendingDrivers));
        document.getElementById('pending-drivers-tab-button').setAttribute('aria-selected', String(showPendingDrivers));
        if (showPendingDrivers) loadPendingDrivers();
    }

    async function downloadDocument(url, label, button) {
        const token = localStorage.getItem('gps-token');
        if (!token) {
            window.location.replace('/');
            return;
        }

        button.disabled = true;
        try {
            const response = await fetch(url, {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (response.status === 401) {
                window.location.replace('/');
                return;
            }
            if (!response.ok) {
                throw new Error(`No se pudo descargar ${label} (HTTP ${response.status}).`);
            }

            const documentBlob = await response.blob();
            const extension = documentBlob.type === 'application/pdf'
                ? '.pdf'
                : documentBlob.type === 'image/png' ? '.png' : '.jpg';
            const objectUrl = URL.createObjectURL(documentBlob);
            const link = document.createElement('a');
            link.href = objectUrl;
            link.download = `${label.toLowerCase().replaceAll(' ', '-')}${extension}`;
            document.body.append(link);
            link.click();
            link.remove();
            window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30000);
        } catch (error) {
            pendingDriversStatus.className = 'error';
            pendingDriversStatus.textContent = error.message;
        } finally {
            button.disabled = false;
        }
    }

    async function verifyDriver(driverId, approved, reason) {
        const token = localStorage.getItem('gps-token');
        if (!token) {
            window.location.replace('/');
            return;
        }

        pendingDriversStatus.className = '';
        pendingDriversStatus.textContent = approved
            ? 'Aprobando conductor...'
            : 'Rechazando conductor...';
        try {
            const response = await fetch(`/api/admin/verificar-conductor/${encodeURIComponent(driverId)}`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ aprobado: approved, motivoRechazo: reason })
            });
            if (response.status === 401) {
                window.location.replace('/');
                return;
            }
            if (!response.ok) {
                const problem = await response.json().catch(() => null);
                throw new Error(problem?.detail || problem?.title || 'No se pudo actualizar la verificación.');
            }

            await loadPendingDrivers();
        } catch (error) {
            pendingDriversStatus.className = 'error';
            pendingDriversStatus.textContent = error.message;
        }
    }

    function createPendingDriverCard(driver) {
        const card = document.createElement('article');
        card.className = 'pending-driver-card';
        const heading = document.createElement('h3');
        heading.textContent = driver.nombre || driver.email;
        const contact = document.createElement('p');
        contact.textContent = `${driver.email} · ${driver.telefono}`;
        card.append(heading, contact);

        const documents = document.createElement('div');
        documents.className = 'pending-driver-documents';
        for (const [label, url] of [
            ['Licencia', driver.urlLicencia],
            ['SOAT', driver.urlSOAT],
            ['Tarjeta de propiedad', driver.urlTarjetaPropiedad]
        ]) {
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = `Descargar ${label}`;
            button.addEventListener('click', () => downloadDocument(url, label, button));
            documents.append(button);
        }
        card.append(documents);

        const actions = document.createElement('div');
        actions.className = 'pending-driver-actions';
        const approveButton = document.createElement('button');
        approveButton.type = 'button';
        approveButton.className = 'approve-driver';
        approveButton.textContent = 'Aprobar';
        approveButton.addEventListener('click', () => verifyDriver(driver.id, true, null));
        const rejectButton = document.createElement('button');
        rejectButton.type = 'button';
        rejectButton.className = 'reject-driver';
        rejectButton.textContent = 'Rechazar';
        rejectButton.addEventListener('click', () => {
            const reason = window.prompt('Indica el motivo del rechazo:');
            if (reason === null) return;
            if (!reason.trim()) {
                pendingDriversStatus.className = 'error';
                pendingDriversStatus.textContent = 'El motivo del rechazo es obligatorio.';
                return;
            }
            verifyDriver(driver.id, false, reason.trim());
        });
        actions.append(approveButton, rejectButton);
        card.append(actions);
        return card;
    }

    async function loadPendingDrivers() {
        const token = localStorage.getItem('gps-token');
        if (!token) {
            window.location.replace('/');
            return;
        }

        refreshPendingDriversButton.disabled = true;
        pendingDriversList.replaceChildren();
        pendingDriversStatus.className = '';
        pendingDriversStatus.textContent = 'Cargando conductores pendientes...';
        try {
            const response = await fetch('/api/admin/conductores-pendientes', {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (response.status === 401) {
                window.location.replace('/');
                return;
            }
            if (!response.ok) {
                throw new Error(`No se pudieron cargar los conductores (HTTP ${response.status}).`);
            }

            const drivers = await response.json();
            if (!drivers.length) {
                pendingDriversStatus.textContent = 'No hay conductores pendientes de verificación.';
                return;
            }

            pendingDriversStatus.textContent = `${drivers.length} conductor(es) esperando revisión.`;
            for (const driver of drivers) {
                pendingDriversList.append(createPendingDriverCard(driver));
            }
        } catch (error) {
            pendingDriversStatus.className = 'error';
            pendingDriversStatus.textContent = error.message;
        } finally {
            refreshPendingDriversButton.disabled = false;
        }
    }

    refreshButton.addEventListener('click', loadStatistics);
    refreshPendingDriversButton.addEventListener('click', loadPendingDrivers);
    document.getElementById('dashboard-tab-button')
        .addEventListener('click', () => showPendingDriversTab(false));
    document.getElementById('pending-drivers-tab-button')
        .addEventListener('click', () => showPendingDriversTab(true));
    promoForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const token = localStorage.getItem('gps-token');
        if (!token) {
            window.location.replace('/');
            return;
        }

        const submitButton = promoForm.querySelector('button[type="submit"]');
        const values = new FormData(promoForm);
        const expiration = values.get('fechaExpiracion');
        submitButton.disabled = true;
        promoStatus.className = '';
        promoStatus.textContent = 'Creando cupón...';
        try {
            const response = await fetch('/api/admin/promos', {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    codigo: String(values.get('codigo')).trim().toUpperCase(),
                    porcentajeDescuento: Number(values.get('porcentajeDescuento')),
                    fechaExpiracion: expiration ? new Date(String(expiration)).toISOString() : null
                })
            });
            const result = await response.json();
            if (response.status === 401) {
                window.location.replace('/');
                return;
            }
            if (response.status === 403) {
                throw new Error('Tu cuenta no tiene acceso para crear promociones.');
            }
            if (!response.ok) {
                throw new Error(result.detail || result.title || 'No se pudo crear el cupón.');
            }

            promoStatus.className = 'success';
            promoStatus.textContent =
                `Cupón ${result.codigo} creado con ${result.porcentajeDescuento}% de descuento.`;
            promoForm.reset();
        } catch (error) {
            promoStatus.className = 'error';
            promoStatus.textContent = error.message;
        } finally {
            submitButton.disabled = false;
        }
    });
    document.getElementById('admin-logout').addEventListener('click', () => {
        localStorage.removeItem('gps-token');
        localStorage.removeItem('gps-user');
        window.location.assign('/');
    });
    loadStatistics();
})();
