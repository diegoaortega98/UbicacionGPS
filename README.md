# UbicacionGPS

Aplicación web para compartir ubicaciones en tiempo real, con panel de administración protegido, alertas SOS, geocercas con búsqueda de direcciones e historial de rutas. Los usuarios conectados comparten ubicación en una única sala global; los datos y las sesiones se mantienen en memoria mientras el servidor está activo.

## Ejecutar en local

1. Instala Node.js 22 o superior (el servidor usa Node.js 18+, pero Capacitor 8 requiere Node.js 22+).
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

El rastreo nativo usa `@bglocation/capacitor`; el navegador normal conserva `navigator.geolocation.watchPosition`. El bundle del plugin se actualiza con `npm run build:frontend`; `npm run cap:sync` lo compila y sincroniza con los proyectos nativos. La configuración del backend móvil está en [public/native-config.js](./public/native-config.js) y debe ser el origen HTTPS del servidor, sin `/` final. El valor configurado actualmente es `https://ubicaciongps.onrender.com`.

Al iniciar el rastreo, la app solicita primero el permiso de ubicación durante el uso y luego el permiso en segundo plano. En Android 11 o superior, el usuario debe habilitar **Permitir siempre** desde los ajustes de la app. Android muestra una notificación permanente mientras el servicio está activo. En iOS, se solicita autorización Always y se usa el modo de ubicación en segundo plano declarado en `Info.plist`. El botón permite detener el rastreo. El cierre forzado, la revocación de permisos, los ajustes de batería y la conectividad pueden interrumpir las actualizaciones; ningún sistema operativo garantiza el rastreo tras forzar el cierre.

El plugin envía mediante HTTPS un POST a `/update-location`, con las coordenadas en `location.latitude` y `location.longitude` y el ID estable del dispositivo en la cabecera `X-Device-Id`. El servidor también conserva compatibilidad con el formato anterior `deviceId`, `lat` y `lng`; ambos actualizan el mismo historial, emiten los eventos y evalúan las geocercas. La app conserva el ID del dispositivo en almacenamiento local.

**Limitación de licencia:** `@bglocation/capacitor` es un POC bajo Elastic License 2.0 y, sin clave de licencia válida del proveedor, aplica un período de prueba limitado (30 minutos de rastreo y una hora de espera). Revisa [la licencia incluida](./public/bglocation-license.md) y las condiciones del proveedor antes de distribuir la app o usarla como servicio. El plugin no debe considerarse una solución de producción fiable sin resolver esta limitación.

### Compilar y probar Android

Instala Android Studio, el Android SDK y un JDK compatible; habilita la depuración USB en el teléfono y conéctalo al ordenador. Después de configurar una URL HTTPS en `public/native-config.js`, ejecuta:

```bash
npm install
npm run cap:sync
npx cap run android
```

También puedes ejecutar `npx cap sync` después de `npm run build:frontend`, o abrir el proyecto `android` en Android Studio y ejecutar la app en el dispositivo. `npx cap run android` requiere que Android SDK/ADB y Java estén instalados y configurados en `PATH`.

### iOS

La carpeta `ios` queda preparada, pero compilar o ejecutar iOS requiere macOS, Xcode y un dispositivo/certificado Apple; no se puede compilar desde Windows. En un Mac, ejecuta `npm install`, `npm run cap:sync` y `npx cap run ios`.
