// Registra el puente nativo; en el navegador web se conserva la geolocalización estándar.
if (window.Capacitor?.registerPlugin) {
    window.BackgroundLocation = window.Capacitor.registerPlugin('BackgroundLocation');
}
