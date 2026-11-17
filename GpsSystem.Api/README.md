# GPS Ride: rastreo y viajes en tiempo real (.NET 8)

## Requisitos

- .NET 8 SDK
- PostgreSQL
- Python 3.9 o posterior para el simulador

Configura `DATABASE_URL` con una URL PostgreSQL (`postgresql://usuario:contraseña@host:5432/base?sslmode=require`) o una cadena de conexión Npgsql. Configura también `JWT_SECRET` como una cadena aleatoria de al menos 32 bytes. La aplicación aplica las migraciones al iniciar.

Para FCM servidor, en Render inyecta el JSON de cuenta de servicio como `FIREBASE_CREDENTIALS_JSON`; localmente puedes guardar el archivo como `firebase-adminsdk.json` en la raíz del repositorio o apuntar `GOOGLE_APPLICATION_CREDENTIALS` a un archivo fuera del repositorio. También se aceptan `FIREBASE_SERVICE_ACCOUNT` y `Firebase__ServiceAccountJson`. Si no hay credenciales, la aplicación inicia con FCM desactivado; credenciales presentes pero inválidas generan un error explícito. No copies la clave privada a `appsettings.json` ni la expongas al navegador. Para notificaciones web configura los valores públicos de Firebase (`Firebase__Web__ApiKey`, `AuthDomain`, `ProjectId`, `StorageBucket`, `MessagingSenderId`, `AppId` y `VapidKey`) desde la configuración web del proyecto Firebase. El `VapidKey` es la clave pública web push y no se obtiene del JSON de cuenta de servicio.

En PowerShell, para una base local:

```powershell
$env:DATABASE_URL = "Host=localhost;Port=5432;Database=gps;Username=postgres;Password=tu-clave"
$env:JWT_SECRET = "genera-una-clave-aleatoria-de-32-bytes-o-mas"
dotnet run --project .\GpsSystem.Api.csproj
```

Abre `http://localhost:5023` o la URL local que muestre `dotnet run`.

## Recuperación de contraseña por correo

Para obtener una API Key, crea una cuenta en [SendGrid](https://sendgrid.com/), abre **Settings > API Keys** y genera una clave con permiso **Mail Send**. Verifica también el remitente o dominio configurado en `Email:FromEmail`. No guardes la clave en Git.

En PowerShell local, configura la clave como variable de entorno antes de iniciar la API:

```powershell
$env:SENDGRID_API_KEY = "tu-api-key-de-sendgrid"
dotnet run --project .\GpsSystem.Api.csproj
```

También se puede usar `Email__SendGridApiKey` o `Email:SendGridApiKey` desde la configuración. En Render, configura `SENDGRID_API_KEY` en **Environment**. Si falta la clave en Desarrollo, la API imprime el código de recuperación en la consola; en otros entornos, el envío falla explícitamente.

## API

- `POST /api/ubicaciones`: guarda `{ "dispositivoId": "vehiculo-01", "latitud": 10.391, "longitud": -75.4794, "velocidad": 35 }` y publica `RecibirUbicacion` en `/gpsHub`.
- `GET /api/ubicaciones/actual`: devuelve la última ubicación de cada dispositivo.
- `GET /api/ubicaciones/historial/{id}`: devuelve el historial del dispositivo.

## Cuentas, viajes y tiempo real

- Registra `POST /api/auth/register` con `email`, `password` (mínimo 10 caracteres, mayúscula, minúscula, número y símbolo) y `rol` (`Pasajero` o `Conductor`). Los conductores deben incluir `vehiculo` y `placa`. El registro devuelve un JWT.
- `POST /api/auth/login` recibe correo y contraseña y devuelve un JWT.
- Las solicitudes autenticadas usan `Authorization: Bearer <token>`. Pasajeros solicitan con `POST /api/viajes/solicitar` y las coordenadas `origenLat`, `origenLng`, `destinoLat`, `destinoLng`. La respuesta contiene el PIN, que solo se entrega al pasajero.
- Conductores consultan `GET /api/viajes/disponibles`, aceptan con `POST /api/viajes/{id}/aceptar`, validan el PIN con `POST /api/viajes/{id}/iniciar` y finalizan con `POST /api/viajes/{id}/finalizar`.
- `GET /api/viajes/mios` lista los viajes propios. Los Hubs autenticados están en `/hubs/viajes`, `/hubs/chat` y `/hubs/llamada`.
- `GET /api/viajes/historial` devuelve los últimos 20 viajes finalizados o cancelados del usuario autenticado. El pasajero puede calificar una sola vez cada viaje finalizado con `POST /api/viajes/{id}/calificar` enviando `estrellas` (1–5) y un `comentario` opcional.
- `GET /api/auth/perfil` incluye el promedio y total de calificaciones del conductor; el perfil muestra esos valores y la interfaz permite revisar el historial y calificar al conductor al finalizar un viaje.
- `GET /api/admin/estadisticas` está reservado al rol `Admin` y devuelve métricas de viajes y comisiones. El rol se crea al iniciar la aplicación; para crear `admin@ubicaciongps.com`, configura `ADMIN_INITIAL_PASSWORD` con una contraseña segura que cumpla la política de Identity. No se incluye una contraseña administrativa predeterminada en el código.
- La interfaz permite seleccionar puntos en el mapa, ver la ruta, conversar en tiempo real y señalizar llamadas WebRTC. La llamada necesita HTTPS (localhost es válido) y permisos de micrófono.
- SignalR se mantiene como canal de coordenadas y actualizaciones continuas al reconectar la app. FCM se limita a avisos críticos: nuevas solicitudes para conductores, viaje aceptado y viaje finalizado; no se envía por cada cambio de estado. El botón **Activar notificaciones** solicita permiso, registra el token FCM bajo la cuenta autenticada y muestra mensajes en primer plano. En segundo plano, Firebase presenta las notificaciones que contienen `notification` y el service worker no genera una segunda notificación. Firebase sin configurar queda desactivado con un aviso en el log; las credenciales inválidas producen un error explícito.

La tarifa de demostración se estima con una base de 5.000 COP más 1.800 COP por kilómetro estimado (distancia geodésica ajustada × 1,3 y redondeada a 500 COP). Al finalizar se registra una comisión del 15% con estado `Pendiente`; no se procesa ningún pago real.

Para crear migraciones: `dotnet ef migrations add NombreMigracion`. La aplicación ejecuta `Database.Migrate()` al iniciar. La migración inicial conserva las tablas y datos GPS que una versión previa haya creado con `EnsureCreated`; se requiere una instancia PostgreSQL accesible.

Para simular movimiento contra el puerto 10000:

```powershell
python -m pip install -r .\requirements.txt
$env:GPS_API_URL = "http://localhost:10000/api/ubicaciones"
python .\simulador_gps.py
```

## Docker

Desde la raíz del repositorio, crea la imagen con `docker build -t gps-system .` y ejecútala pasando la URL de PostgreSQL:

```powershell
docker run --rm -p 10000:10000 -e DATABASE_URL="<URL-de-PostgreSQL>" gps-system
```
