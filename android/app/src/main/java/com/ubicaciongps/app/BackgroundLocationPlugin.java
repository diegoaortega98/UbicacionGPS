package com.ubicaciongps.app;

import android.Manifest;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

@CapacitorPlugin(
    name = "BackgroundLocation",
    permissions = {
        @Permission(
            alias = "location",
            strings = { Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION }
        ),
        @Permission(
            alias = "backgroundLocation",
            strings = { Manifest.permission.ACCESS_BACKGROUND_LOCATION }
        ),
        @Permission(
            alias = "notifications",
            strings = { Manifest.permission.POST_NOTIFICATIONS }
        )
    }
)
public class BackgroundLocationPlugin extends Plugin {
    private static BackgroundLocationPlugin activePlugin;

    @Override
    public void load() {
        activePlugin = this;
    }

    @PluginMethod
    public void checkPermissions(PluginCall call) {
        call.resolve(permissionStatus());
    }

    @PluginMethod
    public void requestPermissions(PluginCall call) {
        if (!hasForegroundLocationPermission()) {
            requestPermissionForAlias("location", call, "locationPermissionResult");
            return;
        }
        requestNotificationPermissionIfNeeded(call);
    }

    @PermissionCallback
    private void locationPermissionResult(PluginCall call) {
        if (!hasForegroundLocationPermission()) {
            call.reject("Se requiere permiso de ubicación para iniciar el rastreo.");
            return;
        }
        requestNotificationPermissionIfNeeded(call);
    }

    private void requestNotificationPermissionIfNeeded(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
            && ContextCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS)
                != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            requestPermissionForAlias("notifications", call, "notificationPermissionResult");
            return;
        }
        requestBackgroundPermissionIfNeeded(call);
    }

    @PermissionCallback
    private void notificationPermissionResult(PluginCall call) {
        requestBackgroundPermissionIfNeeded(call);
    }

    @PermissionCallback
    private void backgroundPermissionResult(PluginCall call) {
        call.resolve(permissionStatus());
    }

    private void requestBackgroundPermissionIfNeeded(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q || hasBackgroundLocationPermission()) {
            call.resolve(permissionStatus());
            return;
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            // Android 11+ exige que el usuario habilite "Permitir siempre" desde Ajustes.
            Intent settingsIntent = new Intent(
                Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                Uri.parse("package:" + getContext().getPackageName())
            );
            settingsIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(settingsIntent);
            JSObject status = permissionStatus();
            status.put("settingsRequired", true);
            call.resolve(status);
            return;
        }

        requestPermissionForAlias("backgroundLocation", call, "backgroundPermissionResult");
    }

    @PluginMethod
    public void openAppSettings(PluginCall call) {
        Intent settingsIntent = new Intent(
            Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
            Uri.parse("package:" + getContext().getPackageName())
        );
        settingsIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(settingsIntent);
        call.resolve();
    }

    @PluginMethod
    public void start(PluginCall call) {
        String endpoint = call.getString("url");
        String deviceId = call.getString("deviceId");
        if (endpoint == null || !endpoint.startsWith("https://")
            || deviceId == null || !deviceId.matches("[A-Za-z0-9_-]{16,80}")) {
            call.reject("Configura un endpoint HTTPS y un identificador de dispositivo válido.");
            return;
        }
        if (!hasForegroundLocationPermission() || !hasBackgroundLocationPermission()) {
            call.reject("Concede acceso a la ubicación mientras se usa la app y en segundo plano.");
            return;
        }

        Intent serviceIntent = new Intent(getContext(), LocationTrackingService.class);
        serviceIntent.putExtra(LocationTrackingService.EXTRA_URL, endpoint);
        serviceIntent.putExtra(LocationTrackingService.EXTRA_DEVICE_ID, deviceId);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            ContextCompat.startForegroundService(getContext(), serviceIntent);
        } else {
            getContext().startService(serviceIntent);
        }
        JSObject result = new JSObject();
        result.put("running", true);
        call.resolve(result);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        getContext().stopService(new Intent(getContext(), LocationTrackingService.class));
        JSObject result = new JSObject();
        result.put("running", false);
        call.resolve(result);
    }

    private boolean hasForegroundLocationPermission() {
        return ContextCompat.checkSelfPermission(getContext(), Manifest.permission.ACCESS_FINE_LOCATION)
                == android.content.pm.PackageManager.PERMISSION_GRANTED;
    }

    private boolean hasBackgroundLocationPermission() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.Q
            || ContextCompat.checkSelfPermission(getContext(), Manifest.permission.ACCESS_BACKGROUND_LOCATION)
                == android.content.pm.PackageManager.PERMISSION_GRANTED;
    }

    private JSObject permissionStatus() {
        JSObject status = new JSObject();
        status.put("location", hasForegroundLocationPermission());
        status.put("backgroundLocation", hasBackgroundLocationPermission());
        return status;
    }

    static void notifyLocation(double latitude, double longitude) {
        BackgroundLocationPlugin plugin = activePlugin;
        if (plugin == null) {
            return;
        }
        JSObject location = new JSObject();
        location.put("latitude", latitude);
        location.put("longitude", longitude);
        plugin.notifyListeners("location", location);
    }
}
