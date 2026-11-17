import { vapidPublicKey, token } from './config.js';
import { checkAuth } from './auth.js';
import { updatePushStatus } from './ui.js';

export function urlBase64ToUint8Array(base64String) {
    if (!base64String) return null;
    base64String = base64String.trim().replace(/-/g, '+').replace(/_/g, '/');
    while (base64String.length % 4) base64String += '=';
    try {
        const raw = window.atob(base64String);
        const out = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; ++i) out[i] = raw.charCodeAt(i);
        return out;
    } catch (e) {
        console.error('VAPID decode:', e);
        return null;
    }
}

export async function subscribeToPush(force = false) {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    if (!vapidPublicKey) return;
    try {
        const registration = await navigator.serviceWorker.ready;
        let subscription = await registration.pushManager.getSubscription();

        if (force && subscription) {
            await subscription.unsubscribe();
            subscription = null;
        }
        if (!subscription) {
            if (Notification.permission !== 'granted') {
                const permission = await Notification.requestPermission();
                if (permission !== 'granted') return;
            }
            const key = urlBase64ToUint8Array(vapidPublicKey);
            if (!key) return;
            subscription = await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: key
            });
        }
        // Всегда синхронизируем на сервер — идемпотентно
        const resp = await fetch('/api/subscribe', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(subscription)
        });
        await checkAuth(resp);
        if (resp.ok) await updatePushStatus();
    } catch (err) {
        console.error('Push subscription error:', err);
    }
}
