package com.ubicaciongps.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.IBinder;
import android.util.Log;
import androidx.core.app.NotificationCompat;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class LocationTrackingService extends Service implements LocationListener {
    static final String EXTRA_URL = "background_location_url";
    static final String EXTRA_DEVICE_ID = "background_location_device_id";
    private static final String TAG = "UbicacionGPS";
    private static final String CHANNEL_ID = "background_location";
    private static final int NOTIFICATION_ID = 7301;
    private final ExecutorService networkExecutor = Executors.newSingleThreadExecutor();
    private LocationManager locationManager;
    private String endpoint;
    private String deviceId;

    @Override
    public void onCreate() {
        super.onCreate();
        locationManager = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
        createNotificationChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null) {
            endpoint = intent.getStringExtra(EXTRA_URL);
            deviceId = intent.getStringExtra(EXTRA_DEVICE_ID);
            // Conserva la configuración para que START_STICKY pueda recrear el servicio.
            getSharedPreferences("background_location", MODE_PRIVATE)
                .edit()
                .putString(EXTRA_URL, endpoint)
                .putString(EXTRA_DEVICE_ID, deviceId)
                .apply();
        } else {
            endpoint = getSharedPreferences("background_location", MODE_PRIVATE).getString(EXTRA_URL, null);
            deviceId = getSharedPreferences("background_location", MODE_PRIVATE).getString(EXTRA_DEVICE_ID, null);
        }

        if (endpoint == null || !endpoint.startsWith("https://") || deviceId == null) {
            Log.e(TAG, "No se puede iniciar el rastreo: falta el endpoint HTTPS o el identificador.");
            stopSelf();
            return START_NOT_STICKY;
        }

        startForeground(NOTIFICATION_ID, buildNotification());
        try {
            locationManager.removeUpdates(this);
            if (locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                locationManager.requestLocationUpdates(LocationManager.GPS_PROVIDER, 5000L, 10f, this);
            }
            if (locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
                locationManager.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, 10000L, 25f, this);
            }
        } catch (SecurityException error) {
            Log.e(TAG, "Se revocó el permiso de ubicación.", error);
            stopSelf();
        }
        return START_STICKY;
    }

    @Override
    public void onLocationChanged(Location location) {
        double latitude = location.getLatitude();
        double longitude = location.getLongitude();
        BackgroundLocationPlugin.notifyLocation(latitude, longitude);
        networkExecutor.execute(() -> sendLocation(latitude, longitude));
    }

    private void sendLocation(double latitude, double longitude) {
        // El servicio solo acepta HTTPS para no transmitir coordenadas en texto plano.
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(endpoint).openConnection();
            connection.setRequestMethod("POST");
            connection.setConnectTimeout(10000);
            connection.setReadTimeout(10000);
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            String payload = String.format(
                Locale.US,
                "{\"deviceId\":\"%s\",\"lat\":%.7f,\"lng\":%.7f}",
                deviceId,
                latitude,
                longitude
            );
            byte[] body = payload.getBytes(StandardCharsets.UTF_8);
            connection.setFixedLengthStreamingMode(body.length);
            try (OutputStream output = connection.getOutputStream()) {
                output.write(body);
            }
            int responseCode = connection.getResponseCode();
            if (responseCode < 200 || responseCode >= 300) {
                Log.e(TAG, "El servidor rechazó una ubicación. HTTP " + responseCode);
            }
        } catch (Exception error) {
            Log.e(TAG, "No se pudo enviar una ubicación al servidor.", error);
        } finally {
            if (connection != null) {
                connection.disconnect();
            }
        }
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            "Rastreo de ubicación",
            NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription("Indica que UbicacionGPS comparte la ubicación en segundo plano.");
        NotificationManager manager = getSystemService(NotificationManager.class);
        manager.createNotificationChannel(channel);
    }

    private Notification buildNotification() {
        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setContentTitle("UbicacionGPS está compartiendo tu ubicación")
            .setContentText("El rastreo en segundo plano está activo.")
            .setOngoing(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .build();
    }

    @Override
    public void onDestroy() {
        if (locationManager != null) {
            locationManager.removeUpdates(this);
        }
        networkExecutor.shutdown();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
