import { token } from './config.js';

const savedTheme = localStorage.getItem('theme') || 'light';

export function applyTheme(theme) {
    document.body.classList.remove('light-theme', 'dark-theme', 'cyberpunk-theme', 'retro-theme', 'oled-theme');
    if (theme === 'dark') document.body.classList.add('dark-theme');
    else if (theme === 'cyberpunk') document.body.classList.add('cyberpunk-theme');
    else if (theme === 'retro') document.body.classList.add('retro-theme');
    else if (theme === 'oled') document.body.classList.add('oled-theme');
}
applyTheme(savedTheme);

export function updateConnectionStatus(connected) {
    const el = document.getElementById('connection-status');
    const icon = el?.querySelector('i');
    if (!icon) return;
    if (connected) {
        icon.style.color = '#2c7be5';
        icon.style.animation = 'none';
    } else {
        icon.style.color = '#dc3545';
        icon.style.animation = 'pulse 1s infinite';
    }
}

export async function updatePushStatus() {
    const statusEl = document.getElementById('push-status');
    if (!statusEl) return;
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        statusEl.classList.add('disabled');
        statusEl.classList.remove('active');
        return;
    }
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) {
        statusEl.classList.add('disabled');
        statusEl.classList.remove('active');
        return;
    }
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
        statusEl.classList.add('active');
        statusEl.classList.remove('disabled');
    } else {
        statusEl.classList.add('disabled');
        statusEl.classList.remove('active');
    }
}

export function setSendButtonLoading(loading) {
    const btn = document.getElementById('send-btn');
    if (!btn) return;
    if (loading) {
        btn.disabled = true;
        btn.innerHTML = '<div class="spinner"></div>';
    } else {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-paper-plane"></i>';
    }
}

export function toggleSidebar() {
    const panel = document.getElementById('chats-panel');
    const overlay = document.getElementById('panel-overlay');
    if (!panel || !overlay) return;
    panel.classList.toggle('open');
    overlay.style.display = panel.classList.contains('open') ? 'block' : 'none';
}

export function closeSidebar() {
    const panel = document.getElementById('chats-panel');
    const overlay = document.getElementById('panel-overlay');
    if (panel) panel.classList.remove('open');
    if (overlay) overlay.style.display = 'none';
}

export function getAutoDownloadSetting() {
    return localStorage.getItem('auto_download') || 'always';
}
export function getImagePreviewSetting() {
    return localStorage.getItem('image_preview') || 'always';
}
export function isWiFi() {
    const c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (c && c.type !== undefined) return c.type === 'wifi';
    return true;
}

export async function saveProfile() {
    const username = document.getElementById('profile-username').value.trim();
    const email = document.getElementById('profile-email').value.trim() || null;
    const firstName = document.getElementById('profile-first-name').value;
    const lastName = document.getElementById('profile-last-name').value;
    const birthYear = document.getElementById('profile-birth-year').value;

    if (!/^[a-zA-Z0-9_]{3,32}$/.test(username)) {
        alert('Имя: 3–32 символа, только латиница, цифры и _');
        return false;
    }

    const resp = await fetch('/api/user/me', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
            username,
            email,
            first_name: firstName,
            last_name: lastName,
            birth_year: birthYear ? parseInt(birthYear) : null
        })
    });
    if (resp.ok) {
        alert('Профиль обновлён');
        document.getElementById('profile-modal').style.display = 'none';
        return true;
    }
    const data = await resp.json().catch(() => ({}));
    alert('Ошибка: ' + (data.detail || 'не удалось обновить профиль'));
    return false;
}

export function importTheme(cssText) {
    let style = document.getElementById('custom-theme');
    if (!style) {
        style = document.createElement('style');
        style.id = 'custom-theme';
        document.head.appendChild(style);
    }
    style.textContent = cssText;
}
