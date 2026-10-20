# UbicacionGPS

Aplicación web para compartir ubicaciones en tiempo real, con panel de administración protegido, alertas SOS, geocercas con búsqueda de direcciones e historial de rutas. Los usuarios conectados comparten ubicación en una única sala global; los datos y las sesiones se mantienen en memoria mientras el servidor está activo.

## Ejecutar en local

1. Instala Node.js 18 o superior.
2. En la carpeta del proyecto, ejecuta `npm install`.
3. Ejecuta `npm start` (equivale a `node app.js`).
4. Abre `http://localhost:3000` y acepta el permiso de ubicación del navegador.

Para usar una clave de administración propia en local, configura `ADMIN_KEY` antes de iniciar el servidor. En PowerShell:

```powershell
$env:ADMIN_KEY = "una-clave-segura"
npm start
```

El servidor escucha en `process.env.PORT` cuando está definido y usa el puerto `3000` como valor predeterminado. El frontend y Socket.IO usan el mismo origen, por lo que no es necesario configurar una URL del backend aparte.

## Notificaciones push de alertas SOS

Genera las claves VAPID con `node generate-keys.js` y configura `VAPID_PUBLIC_KEY` y `VAPID_PRIVATE_KEY` como variables de entorno. Para desarrollo local puedes crear un archivo `.env` (no se sube a Git) con esas dos variables y `VAPID_SUBJECT=mailto:tu-correo@example.com`. El servidor carga `.env` automáticamente. Si no configuras ninguna clave, se genera un par temporal al iniciar, que deja de servir al reiniciar el servidor.

En el panel privado, pulsa **Activar notificaciones en este dispositivo** y concede permiso. Las notificaciones push requieren HTTPS (localhost también es válido para pruebas) y un navegador/dispositivo compatible. Las suscripciones se conservan en memoria y hay que activarlas de nuevo en cada reinicio del servidor.

## Publicar en GitHub

1. Crea un repositorio vacío en GitHub llamado `UbicacionGPS` (sin README, licencia ni `.gitignore` inicial).
2. Desde la carpeta del proyecto, si todavía no existe un repositorio Git local, ejecuta:

```bash
git init
git add .
git commit -m "Preparado para despliegue en Render con todas las funciones"
git branch -M main
git remote add origin https://github.com/TU-USUARIO/UbicacionGPS.git
git push -u origin main
```

Reemplaza `TU-USUARIO` por tu nombre de usuario u organización de GitHub. Para publicar cambios futuros:

```bash
git add .
git commit -m "Describe los cambios"
git push
```

## Desplegar en Render

1. Sube el repositorio a GitHub siguiendo los pasos anteriores.
2. En Render, selecciona **New + > Blueprint** y conecta el repositorio. Render detectará `render.yaml` y configurará el servicio web `ubicaciongps`, con `npm install`, `node app.js` y la comprobación de salud `/health`.
3. Configura `ADMIN_KEY`, `VAPID_PUBLIC_KEY` y `VAPID_PRIVATE_KEY` en Render cuando lo solicite el Blueprint o desde **Environment**. Genera el par VAPID con `node generate-keys.js`; mantén privada la clave privada y no guardes las claves en GitHub. Configura `VAPID_SUBJECT` como `mailto:tu-correo@example.com`.
4. Crea el servicio y espera a que finalice el despliegue. Render asigna `PORT` automáticamente.
5. Comprueba `https://TU-SERVICIO.onrender.com/health`; debe responder `{"status":"ok"}`. Abre `https://TU-SERVICIO.onrender.com` para la aplicación.

El panel de administración está en `https://TU-SERVICIO.onrender.com/panel-privado-gps` y usa el valor de `ADMIN_KEY`. Si no se configura la variable, la clave predeterminada es `gpsadmin2026`; no uses ese valor predeterminado en producción. La sesión se guarda en una cookie `HttpOnly` durante ocho horas. `/admin` y `/admin.html` devuelven 404.

El frontend, el panel y Socket.IO se sirven desde el mismo origen. Fuera de localhost, el navegador requiere HTTPS para acceder a la geolocalización. Los usuarios, las geocercas, el historial y las sesiones se almacenan en memoria y se pierden al reiniciar el servidor.

## Aplicación móvil Capacitor y rastreo en segundo plano

La app nativa usa un servicio de ubicación propio en Android y Core Location en iOS. En [public/native-config.js](./public/native-config.js), configura `window.UBICACIONGPS_BACKEND_URL` con el origen HTTPS real del backend (por ejemplo, `https://mi-servicio.onrender.com`, sin `/` final). No uses una IP pública con HTTP: el tráfico contiene coordenadas precisas y el código nativo rechaza endpoints que no sean HTTPS. Hasta configurar una URL HTTPS, el rastreo móvil permanece desactivado; el sitio web sigue usando su comportamiento normal. Capacitor 8 requiere Node.js 22 o superior para sincronizar y compilar los proyectos móviles.

Al iniciar la app móvil se muestra una confirmación antes de pedir el permiso de ubicación permanente. En Android 11 o superior, el sistema requiere que el usuario habilite **Permitir siempre** desde los ajustes de la app; Android también muestra una notificación permanente mientras el servicio está activo. En iOS se solicitan permisos Always y el modo de ubicación en segundo plano. El usuario puede detener el rastreo desde el botón de la app. Las decisiones del sistema operativo, el cierre forzado, la revocación de permisos, la batería y la conexión pueden interrumpir las actualizaciones; no se puede garantizar rastreo después de forzar el cierre.

El endpoint `POST /update-location` valida `deviceId`, `lat` y `lng`, actualiza el mismo historial en memoria, emite los eventos de ubicación y evalúa las geocercas existentes. El identificador aleatorio del dispositivo se conserva localmente para mantener la identidad del usuario al reconectar.

### Compilar y probar Android

Instala Android Studio, el Android SDK y un JDK compatible; habilita la depuración USB en el teléfono y conéctalo al ordenador. Después de configurar una URL HTTPS en `public/native-config.js`, ejecuta:

```bash
npm install
npx cap sync android
npx cap run android
```

También puedes abrir el proyecto `android` en Android Studio y ejecutar la app en el dispositivo. `npx cap run android` requiere que Android SDK/ADB y Java estén instalados y configurados en `PATH`.

### iOS

La carpeta `ios` queda preparada, pero compilar o ejecutar iOS requiere macOS, Xcode y un dispositivo/certificado Apple; no se puede compilar desde Windows. En un Mac, ejecuta `npm install`, `npx cap sync ios` y `npx cap run ios`.
