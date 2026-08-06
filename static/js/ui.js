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
    const statusEl = document.getElementById('connection-status');
    const icon = statusEl?.querySelector('i');
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
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        const statusEl = document.getElementById('push-status');
        if (statusEl) statusEl.classList.add('disabled');
        return;
    }
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    const statusEl = document.getElementById('push-status');
    if (!statusEl) return;
    if (subscription) {
        statusEl.classList.add('active');
        statusEl.classList.remove('disabled');
    } else {
        statusEl.classList.add('disabled');
        statusEl.classList.remove('active');
    }
}

export function setSendButtonLoading(loading) {
    const sendBtn = document.getElementById('send-btn');
    if (loading) {
        sendBtn.disabled = true;
        sendBtn.innerHTML = '<div class="spinner"></div>';
    } else {
        sendBtn.disabled = false;
        sendBtn.innerHTML = '<i class="fas fa-paper-plane"></i>';
    }
}

export function toggleSidebar() {
    const panel = document.getElementById('chats-panel');
    const overlay = document.getElementById('panel-overlay');
    panel.classList.toggle('open');
    overlay.style.display = panel.classList.contains('open') ? 'block' : 'none';
}

export function closeSidebar() {
    const panel = document.getElementById('chats-panel');
    const overlay = document.getElementById('panel-overlay');
    panel.classList.remove('open');
    overlay.style.display = 'none';
}

export function getAutoDownloadSetting() {
    return localStorage.getItem('auto_download') || 'always';
}
export function getImagePreviewSetting() {
    return localStorage.getItem('image_preview') || 'always';
}
export function isWiFi() {
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (connection && connection.type !== undefined) {
        return connection.type === 'wifi';
    }
    return true;
}

export function loadProfileForm() {}

export async function saveProfile() {
    let nickname = document.getElementById('profile-nickname').value.trim();
    if (nickname === '') nickname = null;
    const firstName = document.getElementById('profile-first-name').value;
    const lastName = document.getElementById('profile-last-name').value;
    const birthYear = document.getElementById('profile-birth-year').value;
    const resp = await fetch('/api/user/me', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ first_name: firstName, last_name: lastName, nickname, birth_year: birthYear ? parseInt(birthYear) : null })
    });
    if (resp.ok) {
        alert('Профиль обновлён');
        const userResp = await fetch('/api/user/me', { headers: { 'Authorization': `Bearer ${token}` } });
        const user = await userResp.json();
        const displayName = user.nickname || user.username;
        document.getElementById('display-name').textContent = displayName;
        const nicknameDisplay = document.getElementById('nickname-display');
        if (user.nickname && user.nickname !== user.username) {
            nicknameDisplay.textContent = `@${user.username}`;
        } else {
            nicknameDisplay.textContent = '';
        }
        document.getElementById('profile-modal').style.display = 'none';
    } else {
        alert('Ошибка обновления');
    }
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