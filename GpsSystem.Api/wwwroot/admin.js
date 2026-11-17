(() => {
    const status = document.getElementById('dashboard-status');
    const refreshButton = document.getElementById('refresh-dashboard');
    const promoForm = document.getElementById('promo-form');
    const promoStatus = document.getElementById('promo-status');
    const pendingDriversStatus = document.getElementById('pending-drivers-status');
    const pendingDriversList = document.getElementById('pending-drivers-list');
    const refreshPendingDriversButton = document.getElementById('refresh-pending-drivers');
    const expiredDriversStatus = document.getElementById('expired-drivers-status');
    const expiredDriversList = document.getElementById('expired-drivers-list');
    const refreshExpiredDriversButton = document.getElementById('refresh-expired-drivers');
    const expiredDriversNotice = document.getElementById('expired-drivers-notice');
    const driversWithDebtStatus = document.getElementById('drivers-with-debt-status');
    const driversWithDebtList = document.getElementById('drivers-with-debt-list');
    let totalComisiones = 0;
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
            totalComisiones = Number(statistics.comisionesRecibidas);
            document.getElementById('total-viajes').textContent =
                Number(statistics.totalViajes).toLocaleString('es-CO');
            document.getElementById('comisiones-recibidas').textContent =
                currencyFormat.format(statistics.comisionesRecibidas);
            document.getElementById('comisiones-por-cobrar').textContent =
                currencyFormat.format(statistics.comisionesPorCobrarEfectivo);
            document.getElementById('viajes-hoy').textContent =
                Number(statistics.viajesHoy).toLocaleString('es-CO');
            document.getElementById('conductores-activos').textContent =
                Number(statistics.conductoresActivos).toLocaleString('es-CO');
            document.getElementById('recaudado-hoy').textContent =
                currencyFormat.format(statistics.recaudadoHoy);
            document.getElementById('admin-withdraw-earnings').hidden = false;
            status.textContent = `Actualizado: ${new Date().toLocaleString('es-CO')}`;
        } catch (error) {
            status.textContent = error.message;
        } finally {
            refreshButton.disabled = false;
        }
    }

    async function loadDriversWithDebt() {
        const token = localStorage.getItem('gps-token');
        if (!token) {
            window.location.replace('/');
            return;
        }

        driversWithDebtStatus.className = '';
        driversWithDebtStatus.textContent = 'Cargando conductores con deuda...';
        driversWithDebtList.replaceChildren();
        try {
            const response = await fetch('/api/admin/conductores-con-deuda', {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (response.status === 401) {
                window.location.replace('/');
                return;
            }
            if (!response.ok) {
                throw new Error(`No se pudieron cargar los conductores con deuda (HTTP ${response.status}).`);
            }

            const drivers = await response.json();
            if (!drivers.length) {
                driversWithDebtStatus.textContent = 'No hay conductores con saldo pendiente.';
                return;
            }

            driversWithDebtStatus.textContent = `${drivers.length} conductor(es) con saldo pendiente.`;
            for (const driver of drivers) {
                const card = document.createElement('article');
                card.className = 'pending-driver-card';
                const name = document.createElement('h3');
                name.textContent = driver.nombre;
                const balance = document.createElement('p');
                balance.textContent = `Saldo pendiente: ${currencyFormat.format(driver.saldoPendiente)}`;
                const paidButton = document.createElement('button');
                paidButton.type = 'button';
                paidButton.textContent = 'Marcar como Pagado';
                paidButton.addEventListener('click', async () => {
                    paidButton.disabled = true;
                    try {
                        const paymentResponse = await fetch(
                            `/api/admin/conductores/${encodeURIComponent(driver.id)}/marcar-pagado`,
                            { method: 'POST', headers: { Authorization: `Bearer ${token}` } }
                        );
                        if (paymentResponse.status === 401) {
                            window.location.replace('/');
                            return;
                        }
                        if (!paymentResponse.ok) {
                            throw new Error(`No se pudo liquidar el saldo (HTTP ${paymentResponse.status}).`);
                        }
                        await Promise.all([loadDriversWithDebt(), loadStatistics()]);
                    } catch (error) {
                        driversWithDebtStatus.className = 'error';
                        driversWithDebtStatus.textContent = error.message;
                    } finally {
                        paidButton.disabled = false;
                    }
                });
                card.append(name, balance, paidButton);
                driversWithDebtList.append(card);
            }
        } catch (error) {
            driversWithDebtStatus.className = 'error';
            driversWithDebtStatus.textContent = error.message;
        }
    }

    function showPendingDriversTab(showPendingDrivers) {
        document.getElementById('dashboard-view').hidden = showPendingDrivers;
        document.getElementById('pending-drivers-view').hidden = !showPendingDrivers;
        document.getElementById('dashboard-tab-button').setAttribute('aria-selected', String(!showPendingDrivers));
        document.getElementById('pending-drivers-tab-button').setAttribute('aria-selected', String(showPendingDrivers));
        if (showPendingDrivers) loadPendingDrivers();
    }

    async function downloadDocument(url, label, button, statusTarget = pendingDriversStatus) {
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
            statusTarget.className = 'error';
            statusTarget.textContent = error.message;
        } finally {
            button.disabled = false;
        }
    }

    async function verifyDriver(driverId, approved, reason, expiryDate, expired = false) {
        const token = localStorage.getItem('gps-token');
        if (!token) {
            window.location.replace('/');
            return;
        }

        const statusTarget = expired ? expiredDriversStatus : pendingDriversStatus;
        statusTarget.className = '';
        statusTarget.textContent = approved
            ? 'Aprobando conductor...'
            : 'Rechazando conductor...';
        try {
            const response = await fetch(`/api/admin/verificar-conductor/${encodeURIComponent(driverId)}`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    aprobado: approved,
                    motivoRechazo: reason,
                    fechaVencimientoDocumentos: approved && expiryDate
                        ? `${expiryDate}T00:00:00.000Z`
                        : null
                })
            });
            if (response.status === 401) {
                window.location.replace('/');
                return;
            }
            if (!response.ok) {
                const problem = await response.json().catch(() => null);
                throw new Error(problem?.detail || problem?.title || 'No se pudo actualizar la verificación.');
            }

            await Promise.all([loadPendingDrivers(), loadExpiredDrivers()]);
        } catch (error) {
            statusTarget.className = 'error';
            statusTarget.textContent = error.message;
        }
    }

    function createDriverReviewCard(driver, expired = false) {
        const card = document.createElement('article');
        card.className = 'pending-driver-card';
        const heading = document.createElement('h3');
        heading.textContent = driver.nombre || driver.email;
        const contact = document.createElement('p');
        contact.textContent = `${driver.email} · ${driver.telefono}`;
        card.append(heading, contact);
        const statusTarget = expired ? expiredDriversStatus : pendingDriversStatus;
        if (expired) {
            const expiry = document.createElement('p');
            expiry.textContent = `Vencimiento registrado: ${driver.fechaVencimientoDocumentos
                ? new Date(driver.fechaVencimientoDocumentos).toLocaleDateString('es-CO')
                : 'Sin fecha registrada'}`;
            card.append(expiry);
        }

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
            button.addEventListener('click', () => downloadDocument(url, label, button, statusTarget));
            documents.append(button);
        }
        card.append(documents);

        const expiryLabel = document.createElement('label');
        expiryLabel.textContent = 'Fecha de vencimiento de los documentos';
        const expiryInput = document.createElement('input');
        expiryInput.type = 'date';
        expiryInput.min = new Date().toISOString().slice(0, 10);
        expiryInput.required = true;
        expiryLabel.append(expiryInput);
        card.append(expiryLabel);

        const actions = document.createElement('div');
        actions.className = 'pending-driver-actions';
        const approveButton = document.createElement('button');
        approveButton.type = 'button';
        approveButton.className = 'approve-driver';
        approveButton.textContent = 'Aprobar';
        approveButton.addEventListener('click', () => {
            if (!expiryInput.value) {
                statusTarget.className = 'error';
                statusTarget.textContent = 'Indica la fecha de vencimiento antes de aprobar.';
                return;
            }
            verifyDriver(driver.id, true, null, expiryInput.value, expired);
        });
        const rejectButton = document.createElement('button');
        rejectButton.type = 'button';
        rejectButton.className = 'reject-driver';
        rejectButton.textContent = 'Rechazar';
        rejectButton.addEventListener('click', () => {
            const reason = window.prompt('Indica el motivo del rechazo:');
            if (reason === null) return;
            if (!reason.trim()) {
                statusTarget.className = 'error';
                statusTarget.textContent = 'El motivo del rechazo es obligatorio.';
                return;
            }
            verifyDriver(driver.id, false, reason.trim(), null, expired);
        });
        actions.append(approveButton, rejectButton);
        card.append(actions);
        return card;
    }

    function createPendingDriverCard(driver) {
        return createDriverReviewCard(driver);
    }

    function createExpiredDriverCard(driver) {
        return createDriverReviewCard(driver, true);
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

    async function loadExpiredDrivers() {
        const token = localStorage.getItem('gps-token');
        if (!token) {
            window.location.replace('/');
            return;
        }

        refreshExpiredDriversButton.disabled = true;
        expiredDriversList.replaceChildren();
        expiredDriversNotice.hidden = true;
        expiredDriversStatus.className = '';
        expiredDriversStatus.textContent = 'Cargando conductores vencidos...';
        try {
            const response = await fetch('/api/admin/conductores-vencidos', {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (response.status === 401) {
                window.location.replace('/');
                return;
            }
            if (!response.ok) {
                throw new Error(`No se pudieron cargar los conductores vencidos (HTTP ${response.status}).`);
            }

            const drivers = await response.json();
            if (!drivers.length) {
                expiredDriversStatus.textContent = 'No hay conductores con documentos vencidos.';
                return;
            }

            expiredDriversNotice.hidden = false;
            expiredDriversNotice.textContent =
                `${drivers.length} conductor(es) tienen documentos vencidos y requieren revisión.`;
            expiredDriversStatus.textContent = `${drivers.length} conductor(es) requieren revisión.`;
            for (const driver of drivers) {
                expiredDriversList.append(createExpiredDriverCard(driver));
            }
        } catch (error) {
            expiredDriversStatus.className = 'error';
            expiredDriversStatus.textContent = error.message;
        } finally {
            refreshExpiredDriversButton.disabled = false;
        }
    }

    refreshButton.addEventListener('click', loadStatistics);
    refreshButton.addEventListener('click', loadDriversWithDebt);
    refreshPendingDriversButton.addEventListener('click', loadPendingDrivers);
    refreshExpiredDriversButton.addEventListener('click', loadExpiredDrivers);
    document.getElementById('admin-withdraw-earnings').addEventListener('click', () => {
        const withdrawStatus = document.getElementById('admin-withdraw-status');
        if (!Number.isFinite(totalComisiones) || totalComisiones <= 0) {
            withdrawStatus.textContent = 'No hay comisiones disponibles para retirar.';
            return;
        }
        if (!window.confirm(`¿Simular el retiro de ${currencyFormat.format(totalComisiones)}?`)) return;
        withdrawStatus.textContent =
            `Retiro simulado por ${currencyFormat.format(totalComisiones)}. No se realizó ninguna transferencia.`;
    });
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
    loadExpiredDrivers();
    loadDriversWithDebt();
})();
