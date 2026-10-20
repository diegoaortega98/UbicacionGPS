const webpush = require('web-push');

// Genera un par VAPID; guarda estos valores en variables de entorno y no los publiques.
const vapidKeys = webpush.generateVAPIDKeys();
console.log(`VAPID_PUBLIC_KEY=${vapidKeys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${vapidKeys.privateKey}`);
