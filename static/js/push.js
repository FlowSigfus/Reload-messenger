import { vapidPublicKey, token } from './config.js';
import { checkAuth } from './auth.js';
import { updatePushStatus } from './ui.js';

export function urlBase64ToUint8Array(base64String) {
    if (!base64String) return null;
    base64String = base64String.trim().replace(/-/g, '+').replace(/_/g, '/');
    while (base64String.length % 4) base64String += '=';
    try {
        const rawData = window.atob(base64String);
        const outputArray = new Uint8Array(rawData.length);
        for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
        return outputArray;
    } catch (e) {
        console.error('Ошибка декодирования VAPID ключа:', e);
        return null;
    }
}

export async function subscribeToPush(force = false) {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        console.warn('Push not supported');
        return;
    }
    if (!vapidPublicKey) {
        console.warn('VAPID public key not loaded');
        return;
    }
    try {
        const registration = await navigator.serviceWorker.ready;
        let subscription = await registration.pushManager.getSubscription();
        if (subscription && !force) {
            console.log('Already subscribed');
            return;
        }
        if (subscription && force) {
            await subscription.unsubscribe();
            console.log('Unsubscribed successfully');
        }
        const keyBuffer = urlBase64ToUint8Array(vapidPublicKey);
        if (!keyBuffer) return;
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') return;
        subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: keyBuffer
        });
        const resp = await fetch('/api/subscribe', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(subscription)
        });
        await checkAuth(resp);
        if (resp.ok) {
            console.log('Push subscription successful');
            await updatePushStatus();
        } else {
            const text = await resp.text();
            console.error('Push subscription failed with status', resp.status, text);
        }
    } catch (err) {
        console.error('Push subscription error:', err);
    }
}