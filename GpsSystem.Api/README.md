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
