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
3. Configura `ADMIN_KEY` cuando Render lo solicite para el Blueprint o desde **Environment** en la configuración del servicio. Usa una clave larga, única y privada; no la guardes en GitHub.
4. Crea el servicio y espera a que finalice el despliegue. Render asigna `PORT` automáticamente.
5. Comprueba `https://TU-SERVICIO.onrender.com/health`; debe responder `{"status":"ok"}`. Abre `https://TU-SERVICIO.onrender.com` para la aplicación.

El panel de administración está en `https://TU-SERVICIO.onrender.com/panel-privado-gps` y usa el valor de `ADMIN_KEY`. Si no se configura la variable, la clave predeterminada es `gpsadmin2026`; no uses ese valor predeterminado en producción. La sesión se guarda en una cookie `HttpOnly` durante ocho horas. `/admin` y `/admin.html` devuelven 404.

El frontend, el panel y Socket.IO se sirven desde el mismo origen. Fuera de localhost, el navegador requiere HTTPS para acceder a la geolocalización. Los usuarios, las geocercas, el historial y las sesiones se almacenan en memoria y se pierden al reiniciar el servidor.
