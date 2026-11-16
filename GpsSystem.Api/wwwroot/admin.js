(() => {
    const status = document.getElementById('dashboard-status');
    const refreshButton = document.getElementById('refresh-dashboard');
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

    refreshButton.addEventListener('click', loadStatistics);
    document.getElementById('admin-logout').addEventListener('click', () => {
        localStorage.removeItem('gps-token');
        localStorage.removeItem('gps-user');
        window.location.assign('/');
    });
    loadStatistics();
})();
