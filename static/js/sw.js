self.addEventListener('push', event => {
    let data = {};
    try { data = event.data ? event.data.json() : {}; } catch {}
    event.waitUntil(
        self.registration.showNotification(data.title || 'Reload Messenger', {
            body: data.body || '',
            icon: '/static/icon.png',
            badge: '/static/badge.png',
            data: { url: data.url || '/static/index.html' }
        })
    );
});

self.addEventListener('notificationclick', event => {
    event.notification.close();
    const url = event.notification.data?.url || '/static/index.html';
    event.waitUntil((async () => {
        const list = await clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const c of list) {
            if (c.url.includes('/static/index.html')) { await c.focus(); return; }
        }
        await clients.openWindow(url);
    })());
});
