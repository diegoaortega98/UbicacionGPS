import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';

// Expone el plugin nativo al cliente web empaquetado como script clásico.
window.CapacitorPushNotifications = {
    isNativePlatform: Capacitor.isNativePlatform(),
    platform: Capacitor.getPlatform(),
    addListener: (...args) => PushNotifications.addListener(...args),
    createChannel: (...args) => PushNotifications.createChannel(...args),
    requestPermissions: (...args) => PushNotifications.requestPermissions(...args),
    register: (...args) => PushNotifications.register(...args)
};
