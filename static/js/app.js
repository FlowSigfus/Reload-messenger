import { setVapidPublicKey, setToken, setCurrentUserId, token, setCurrentChatId, currentChatId } from './config.js';
import { checkAuth } from './auth.js';
import { connectWebSocket } from './websocket.js';
import {
    loadChats, selectChat, sendMessageWithFiles, handleFileSelection,
    loadMoreMessages, hasMoreMessages, loadingMessages, deleteChat,
    searchMessages, editMessage, deleteMessage
} from './chat.js';
import { updatePushStatus, applyTheme, toggleSidebar, closeSidebar, saveProfile, importTheme } from './ui.js';
import { subscribeToPush } from './push.js';
import { openGroupModal, searchUsers, createGroup } from './groups.js';
import { toggleRecording } from './voice.js';

let stateManager;
let authMode = 'login';

// 2FA login state
let preAuthToken = null;
let available2FAMethods = [];

function debounce(fn, ms) {
    let t;
    return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

// ---------- AUTH ----------
function setupAuthListeners() {
    const showRegisterBtn = document.getElementById('show-register-fields');
    const registerFields = document.getElementById('register-fields');
    const loginBtn = document.getElementById('login-btn');
    const forgotForm = document.getElementById('forgot-password-form');
    const resetForm = document.getElementById('reset-password-form');
    const showForgotLink = document.getElementById('show-forgot-password');
    const cancelForgotBtn = document.getElementById('cancel-forgot-btn');
    const sendResetBtn = document.getElementById('send-reset-btn');
    const resetPasswordBtn = document.getElementById('reset-password-btn');

    const urlParams = new URLSearchParams(window.location.search);
    const resetToken = urlParams.get('reset_token');
    if (resetToken && resetForm) {
        resetForm.style.display = 'block';
        resetForm.dataset.token = resetToken;
        document.getElementById('login-title').textContent = 'Восстановление пароля';
        document.getElementById('login-main').style.display = 'none';
    }

    if (showRegisterBtn) {
        showRegisterBtn.onclick = () => {
            const show = !registerFields.style.display || registerFields.style.display === 'none';
            registerFields.style.display = show ? 'block' : 'none';
            authMode = show ? 'register' : 'login';
            showRegisterBtn.textContent = show ? 'Скрыть поля' : 'Регистрация';
            if (loginBtn) loginBtn.textContent = show ? 'Зарегистрироваться' : 'Войти';
            if (forgotForm) forgotForm.style.display = 'none';
        };
    }
    if (loginBtn) loginBtn.onclick = () => authMode === 'register' ? doRegister() : doLogin();

    if (showForgotLink) {
        showForgotLink.onclick = (e) => {
            e.preventDefault();
            if (forgotForm) forgotForm.style.display = 'block';
            if (registerFields) registerFields.style.display = 'none';
            authMode = 'login';
            if (loginBtn) loginBtn.textContent = 'Войти';
            if (showRegisterBtn) showRegisterBtn.textContent = 'Регистрация';
        };
    }
    if (cancelForgotBtn) cancelForgotBtn.onclick = () => { forgotForm.style.display = 'none'; };
    if (sendResetBtn) sendResetBtn.onclick = () => sendPasswordReset();
    if (resetPasswordBtn) resetPasswordBtn.onclick = () => submitNewPassword();

    // 2FA step 2
    document.getElementById('login-2fa-submit').onclick = submit2FACode;
    document.getElementById('login-2fa-cancel').onclick = () => {
        preAuthToken = null;
        available2FAMethods = [];
        document.getElementById('login-2fa').style.display = 'none';
        document.getElementById('login-main').style.display = 'block';
        document.getElementById('login-title').textContent = 'Вход / Регистрация';
        document.getElementById('login-2fa-code').value = '';
    };
    document.getElementById('login-2fa-send-email').onclick = send2FAEmail;
    document.getElementById('login-2fa-code').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') submit2FACode();
    });
}

async function doRegister() {
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;
    const email = document.getElementById('register-email').value.trim();
    if (!/^[a-zA-Z0-9_]{3,32}$/.test(username)) return alert('Имя: 3–32 символа, латиница/цифры/_');
    if (password.length < 8) return alert('Пароль минимум 8 символов');
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return alert('Укажите email');

    const resp = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, email })
    });
    const data = await resp.json();
    if (resp.ok) {
        alert('Регистрация успешна! Теперь войдите.');
        authMode = 'login';
        document.getElementById('register-fields').style.display = 'none';
        document.getElementById('show-register-fields').textContent = 'Регистрация';
        document.getElementById('login-btn').textContent = 'Войти';
    } else {
        alert('Ошибка: ' + (data.detail || 'Неизвестная ошибка'));
    }
}

async function doLogin() {
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    const resp = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
    });
    const data = await resp.json();
    if (!resp.ok) {
        alert('Ошибка входа: ' + (data.detail || 'Неверные данные'));
        return;
    }

    if (data.needs_2fa) {
        preAuthToken = data.pre_auth_token;
        available2FAMethods = data.methods || [];
        show2FAForm();
        return;
    }

    setToken(data.access_token);
    localStorage.setItem('token', data.access_token);
    await initApp();
}

function show2FAForm() {
    document.getElementById('login-main').style.display = 'none';
    document.getElementById('login-2fa').style.display = 'block';
    document.getElementById('login-title').textContent = 'Двухфакторная аутентификация';
    document.getElementById('login-2fa-code').value = '';
    document.getElementById('login-2fa-code').focus();
    const sendEmailBtn = document.getElementById('login-2fa-send-email');
    sendEmailBtn.style.display = available2FAMethods.includes('email') ? 'inline-block' : 'none';
}

function detect2FAMethod(code) {
    // backup-код: xxxx-xxxx или 8 hex символов
    if (/^[a-f0-9]{4}-?[a-f0-9]{4}$/i.test(code.replace(/\s/g, ''))) return 'backup';
    // 6 цифр → totp (если включён) или email
    if (/^\d{6}$/.test(code)) {
        if (available2FAMethods.includes('totp')) return 'totp';
        if (available2FAMethods.includes('email')) return 'email';
    }
    return null;
}

async function submit2FACode() {
    const code = document.getElementById('login-2fa-code').value.trim();
    if (!code) return;
    if (!preAuthToken) return alert('Сессия входа истекла, начните заново');

    const method = detect2FAMethod(code);
    if (!method) return alert('Неверный формат кода');

    const resp = await fetch('/api/login/2fa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pre_auth_token: preAuthToken, code, method })
    });
    const data = await resp.json();
    if (!resp.ok) {
        alert('Ошибка: ' + (data.detail || 'Неверный код'));
        return;
    }
    setToken(data.access_token);
    localStorage.setItem('token', data.access_token);
    preAuthToken = null;
    available2FAMethods = [];
    document.getElementById('login-2fa').style.display = 'none';
    await initApp();
}

async function send2FAEmail() {
    if (!preAuthToken) return;
    const resp = await fetch('/api/login/2fa/send_email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pre_auth_token: preAuthToken })
    });
    if (resp.ok) alert('Код отправлен на email');
    else {
        const data = await resp.json().catch(() => ({}));
        alert('Ошибка: ' + (data.detail || 'Не удалось отправить код'));
    }
}

async function sendPasswordReset() {
    const email = document.getElementById('forgot-email').value.trim();
    if (!email) return alert('Введите email');
    const resp = await fetch('/api/forgot_password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
    });
    if (resp.ok) {
        alert('Если такой email зарегистрирован, мы отправили ссылку.');
        document.getElementById('forgot-password-form').style.display = 'none';
        document.getElementById('forgot-email').value = '';
    } else {
        const data = await resp.json().catch(() => ({}));
        alert('Ошибка: ' + (data.detail || 'Не удалось отправить'));
    }
}

async function submitNewPassword() {
    const resetForm = document.getElementById('reset-password-form');
    const resetToken = resetForm.dataset.token;
    const pwd = document.getElementById('reset-new-password').value;
    const pwdConfirm = document.getElementById('reset-confirm-password').value;
    if (!pwd || pwd.length < 8) return alert('Пароль должен быть не короче 8 символов');
    if (pwd !== pwdConfirm) return alert('Пароли не совпадают');
    const resp = await fetch('/api/reset_password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: resetToken, new_password: pwd })
    });
    const data = await resp.json().catch(() => ({}));
    if (resp.ok) {
        alert('Пароль изменён!');
        const u = new URL(window.location.href);
        u.searchParams.delete('reset_token');
        window.location.href = u.toString();
    } else {
        alert('Ошибка: ' + (data.detail || 'Не удалось сменить пароль'));
    }
}

function doLogout() {
    localStorage.removeItem('token');
    window.location.href = '/static/index.html?reload=' + Date.now();
}

window.auth = { register: doRegister, login: doLogin, logout: doLogout };
setupAuthListeners();


// ---------- POPUP меню сообщения ----------
window.__openMsgMenu = (anchor, msg) => {
    const popup = document.getElementById('msg-action-popup');
    if (!popup) return;
    popup.querySelector('[data-action="edit"]').style.display = msg.own ? '' : 'none';
    popup.querySelector('[data-action="delete"]').style.display = msg.own ? '' : 'none';
    popup.querySelector('[data-action="copy"]').style.display = msg.text ? '' : 'none';
    popup.dataset.msgId = msg.id;
    popup.dataset.msgText = msg.text;

    popup.style.display = 'block';
    popup.style.visibility = 'hidden';
    const rect = anchor.getBoundingClientRect();
    const pw = popup.offsetWidth;
    const ph = popup.offsetHeight;
    let left = rect.left;
    let top = rect.bottom + 4;
    if (left + pw > window.innerWidth - 8) left = window.innerWidth - pw - 8;
    if (top + ph > window.innerHeight - 8) top = rect.top - ph - 4;
    popup.style.left = Math.max(8, left) + 'px';
    popup.style.top = Math.max(8, top) + 'px';
    popup.style.visibility = 'visible';
};

function setupMsgPopup() {
    const popup = document.getElementById('msg-action-popup');
    if (!popup) return;
    popup.querySelectorAll('button').forEach(btn => {
        btn.onclick = () => {
            const action = btn.dataset.action;
            const msgId = popup.dataset.msgId;
            const msgText = popup.dataset.msgText || '';
            if (action === 'edit') {
                const newText = prompt('Редактировать сообщение:', msgText);
                if (newText !== null && newText !== msgText) editMessage(msgId, newText);
            } else if (action === 'delete') {
                if (confirm('Удалить сообщение?')) deleteMessage(msgId);
            } else if (action === 'copy') {
                navigator.clipboard?.writeText(msgText).catch(() => {});
            }
            popup.style.display = 'none';
        };
    });
    document.addEventListener('click', (e) => {
        if (!popup.contains(e.target) && !e.target.closest('.msg-menu-btn')) {
            popup.style.display = 'none';
        }
    });
}


// ---------- POPUP меню чата ----------
function setupChatPopup() {
    const menuBtn = document.getElementById('chat-menu-btn');
    const popup = document.getElementById('chat-action-popup');
    if (!menuBtn || !popup) return;

    menuBtn.onclick = (e) => {
        e.stopPropagation();
        const active = document.querySelector('.chat-item.active');
        const isGroup = active?.dataset.isGroup === '1';
        const isOwner = active?.dataset.isOwner === '1';
        popup.querySelector('[data-action="avatar"]').style.display = (isGroup && isOwner) ? '' : 'none';

        const rect = menuBtn.getBoundingClientRect();
        popup.style.display = 'block';
        popup.style.visibility = 'hidden';
        const pw = popup.offsetWidth;
        let left = rect.right - pw;
        let top = rect.bottom + 4;
        if (left < 8) left = 8;
        if (top + popup.offsetHeight > window.innerHeight - 8) {
            top = rect.top - popup.offsetHeight - 4;
        }
        popup.style.left = left + 'px';
        popup.style.top = top + 'px';
        popup.style.visibility = 'visible';
    };

    popup.querySelectorAll('button').forEach(btn => {
        btn.onclick = async () => {
            const action = btn.dataset.action;
            popup.style.display = 'none';
            if (action === 'search') {
                document.getElementById('search-modal').style.display = 'flex';
                document.getElementById('search-query').value = '';
                document.getElementById('search-results-list').innerHTML = '';
            } else if (action === 'export') {
                if (!currentChatId) return;
                const resp = await fetch(`/api/chat/${currentChatId}/export`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (!await checkAuth(resp)) return;
                if (!resp.ok) { alert('Ошибка экспорта'); return; }
                const blob = await resp.blob();
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `chat_${currentChatId}.pdf`;
                a.click();
                URL.revokeObjectURL(url);
            } else if (action === 'avatar') {
                openGroupAvatarModal(currentChatId);
            } else if (action === 'delete') {
                deleteChat();
            }
        };
    });

    document.addEventListener('click', (e) => {
        if (!popup.contains(e.target) && e.target !== menuBtn && !menuBtn.contains(e.target)) {
            popup.style.display = 'none';
        }
    });
}


// ---------- Групповой аватар ----------
async function openGroupAvatarModal(chatId) {
    const modal = document.getElementById('group-avatar-modal');
    modal.dataset.chatId = chatId;

    const resp = await fetch('/api/chats', { headers: { 'Authorization': `Bearer ${token}` } });
    const chats = await resp.json();
    const chat = chats.find(c => c.id === chatId);
    if (!chat || !chat.is_owner) {
        alert('Только владелец группы может менять аватар');
        return;
    }

    const img = document.getElementById('group-avatar-preview-img');
    const letter = document.getElementById('group-avatar-preview-letter');
    if (chat.avatar_url) {
        img.src = chat.avatar_url;
        img.style.display = 'block';
        letter.style.display = 'none';
    } else {
        img.style.display = 'none';
        letter.style.display = 'flex';
        letter.textContent = (chat.name || '?').charAt(0).toUpperCase();
    }

    document.getElementById('group-avatar-file').value = '';
    modal.style.display = 'flex';

    document.getElementById('group-avatar-file').onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        img.src = URL.createObjectURL(file);
        img.style.display = 'block';
        letter.style.display = 'none';
    };

    document.getElementById('save-group-avatar-btn').onclick = async () => {
        const file = document.getElementById('group-avatar-file').files[0];
        if (!file) return alert('Выберите файл');
        const fd = new FormData();
        fd.append('file', file);
        const r = await fetch(`/api/group/${chatId}/avatar`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body: fd
        });
        if (r.ok) {
            await loadChats();
            modal.style.display = 'none';
        } else {
            const err = await r.json().catch(() => ({}));
            alert('Ошибка: ' + (err.detail || 'не удалось'));
        }
    };

    document.getElementById('remove-group-avatar-btn').onclick = async () => {
        if (!confirm('Удалить аватар группы?')) return;
        const r = await fetch(`/api/group/${chatId}/avatar`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (r.ok) {
            await loadChats();
            modal.style.display = 'none';
        }
    };
}


// ---------- 2FA SETUP (в профиле) ----------
async function refresh2FAStatus() {
    const resp = await fetch('/api/2fa/status', {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!resp.ok) return;
    const s = await resp.json();
    const statusEl = document.getElementById('2fa-status');
    const totpBtn = document.getElementById('2fa-setup-totp-btn');
    const emailBtn = document.getElementById('2fa-enable-email-btn');
    const regenBtn = document.getElementById('2fa-regenerate-backup-btn');
    const disableBtn = document.getElementById('2fa-disable-btn');

    let text = [];
    if (s.totp_enabled) text.push('✅ TOTP включён');
    else text.push('❌ TOTP выключен');
    if (s.email_otp_enabled) text.push('✅ Email OTP включён');
    else text.push('❌ Email OTP выключен');
    if (s.backup_codes_remaining > 0) text.push(`🔑 Резервных кодов: ${s.backup_codes_remaining}`);
    statusEl.textContent = text.join(' · ');

    const anyEnabled = s.totp_enabled || s.email_otp_enabled;
    totpBtn.style.display = s.totp_enabled ? 'none' : 'block';
    emailBtn.style.display = s.email_otp_enabled ? 'none' : 'block';
    regenBtn.style.display = anyEnabled ? 'block' : 'none';
    disableBtn.style.display = anyEnabled ? 'block' : 'none';
}

function setup2FAListeners() {
    // --- TOTP setup ---
    document.getElementById('2fa-setup-totp-btn').onclick = async () => {
        const resp = await fetch('/api/2fa/totp/setup', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            alert('Ошибка: ' + (err.detail || 'не удалось'));
            return;
        }
        const data = await resp.json();
        document.getElementById('totp-qr-img').src = data.qr_code;
        document.getElementById('totp-secret-display').textContent = data.secret;
        document.getElementById('totp-confirm-code').value = '';
        document.getElementById('totp-setup-modal').style.display = 'flex';
    };

    document.getElementById('totp-confirm-btn').onclick = async () => {
        const code = document.getElementById('totp-confirm-code').value.trim();
        if (!code) return;
        const resp = await fetch('/api/2fa/totp/confirm', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ code })
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) {
            alert('Ошибка: ' + (data.detail || 'неверный код'));
            return;
        }
        document.getElementById('totp-setup-modal').style.display = 'none';
        if (data.backup_codes) showBackupCodes(data.backup_codes);
        await refresh2FAStatus();
    };

    // --- Email OTP ---
    document.getElementById('2fa-enable-email-btn').onclick = async () => {
        const resp = await fetch('/api/2fa/email/enable', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            alert('Ошибка: ' + (err.detail || 'не удалось'));
            return;
        }
        document.getElementById('email-2fa-code').value = '';
        document.getElementById('email-2fa-modal').style.display = 'flex';
    };

    document.getElementById('email-2fa-confirm-btn').onclick = async () => {
        const code = document.getElementById('email-2fa-code').value.trim();
        if (!code) return;
        const resp = await fetch('/api/2fa/email/confirm', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ code })
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) {
            alert('Ошибка: ' + (data.detail || 'неверный код'));
            return;
        }
        document.getElementById('email-2fa-modal').style.display = 'none';
        if (data.backup_codes) showBackupCodes(data.backup_codes);
        await refresh2FAStatus();
    };

    // --- Regenerate backup ---
    document.getElementById('2fa-regenerate-backup-btn').onclick = async () => {
        const password = prompt('Введите пароль:');
        if (!password) return;
        const code = prompt('Введите текущий код (TOTP / email / backup):');
        if (!code) return;
        const resp = await fetch('/api/2fa/backup_codes/regenerate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ password, code })
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) {
            alert('Ошибка: ' + (data.detail || 'не удалось'));
            return;
        }
        showBackupCodes(data.backup_codes);
        await refresh2FAStatus();
    };

    // --- Disable ---
    document.getElementById('2fa-disable-btn').onclick = async () => {
        if (!confirm('Отключить двухфакторную аутентификацию полностью?')) return;
        const password = prompt('Введите пароль:');
        if (!password) return;
        const code = prompt('Введите текущий код (TOTP / email / backup):');
        if (!code) return;
        const resp = await fetch('/api/2fa/disable', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ password, code })
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) {
            alert('Ошибка: ' + (data.detail || 'не удалось'));
            return;
        }
        alert('2FA отключён');
        await refresh2FAStatus();
    };
}

function showBackupCodes(codes) {
    const pre = document.getElementById('backup-codes-list');
    pre.textContent = codes.join('\n');
    document.getElementById('backup-codes-modal').style.display = 'flex';
    document.getElementById('backup-codes-copy-btn').onclick = () => {
        navigator.clipboard?.writeText(codes.join('\n')).then(
            () => alert('Коды скопированы'),
                                                              () => alert('Не удалось скопировать')
        );
    };
}


// ---------- APP ----------
async function loadStateManager() {
    if (!stateManager) stateManager = await import('./stateManager.js');
    return stateManager;
}

export async function initApp() {
    document.body.classList.remove('chat-open');
    setCurrentChatId(null);
    document.getElementById('login-form').style.display = 'none';
    document.getElementById('app').style.display = 'block';

    const loadingOverlay = document.getElementById('loading-overlay');
    if (loadingOverlay) loadingOverlay.style.display = 'flex';

    let resizeTimeout;
    function setViewportHeight() {
        document.documentElement.style.setProperty('--vh', `${window.innerHeight * 0.01}px`);
    }
    setViewportHeight();
    window.addEventListener('resize', () => {
        if (resizeTimeout) clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(setViewportHeight, 100);
    });

    setupEventListeners();
    setupMsgPopup();
    setupChatPopup();
    setup2FAListeners();
    connectWebSocket();

    const chatsPromise = loadChats().catch(err => console.error('Chats error', err));
    const profilePromise = loadProfile().catch(err => console.error('Profile error', err));
    const vapidPromise = loadVapidPublicKey().catch(err => console.error('Vapid error', err));

    await chatsPromise;
    if (loadingOverlay) loadingOverlay.style.display = 'none';
    await Promise.all([profilePromise, vapidPromise]);

    try {
        const { loadState } = await loadStateManager();
        const saved = loadState();
        if (saved.theme) applyTheme(saved.theme);
        if (saved.lastChatId) selectChat(saved.lastChatId).catch(() => {});
    } catch (e) { console.error(e); }

    if ('serviceWorker' in navigator) {
        const idle = window.requestIdleCallback || (cb => setTimeout(cb, 1));
        idle(() => {
            navigator.serviceWorker.register('/static/sw.js')
            .then(async () => { await subscribeToPush(); await updatePushStatus(); })
            .catch(err => console.error('SW registration failed', err));
        });
    }
}

async function loadProfile() {
    try {
        const resp = await fetch('/api/user/me', { headers: { 'Authorization': `Bearer ${token}` } });
        if (!await checkAuth(resp)) return;
        if (!resp.ok) return;
        const user = await resp.json();
        document.getElementById('display-name').textContent = user.username;
        document.getElementById('nickname-display').textContent = `@${user.username}`;
        updateAvatarDisplay(user.avatar_url);
        setCurrentUserId(user.id);
        fillProfileForm(user);
    } catch (e) { console.error(e); }
}

function fillProfileForm(user) {
    const fields = {
        'profile-username': user.username || '',
        'profile-email': user.email || '',
        'profile-first-name': user.first_name || '',
        'profile-last-name': user.last_name || '',
        'profile-birth-year': user.birth_year || ''
    };
    for (const [id, val] of Object.entries(fields)) {
        const el = document.getElementById(id);
        if (el) el.value = val;
    }
}

async function loadVapidPublicKey() {
    try {
        const resp = await fetch('/api/vapid_public_key');
        const data = await resp.json();
        setVapidPublicKey(data.public_key);
    } catch (err) {
        console.error('VAPID key:', err);
    }
}

function updateAvatarDisplay(avatarUrl) {
    const avatarIcon = document.getElementById('avatar-icon');
    const avatarImg = document.getElementById('avatar-img');
    const profileAvatarImg = document.getElementById('profile-avatar-img');
    if (avatarUrl) {
        avatarIcon.style.display = 'none';
        avatarImg.style.display = 'block';
        avatarImg.src = avatarUrl;
        if (profileAvatarImg) profileAvatarImg.src = avatarUrl;
    } else {
        avatarIcon.style.display = 'block';
        avatarImg.style.display = 'none';
        if (profileAvatarImg) profileAvatarImg.src = '';
    }
}

function setupEventListeners() {
    document.getElementById('send-btn').onclick = sendMessageWithFiles;
    const messageText = document.getElementById('message-text');
    messageText.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.isComposing) {
            e.preventDefault();
            sendMessageWithFiles();
        }
    });
    document.getElementById('mic-btn').onclick = toggleRecording;
    document.getElementById('file-input').onchange = handleFileSelection;
    document.getElementById('new-group-btn').onclick = openGroupModal;

    document.getElementById('settings-btn').onclick = () => {
        const themeSelect = document.getElementById('theme-select');
        if (themeSelect) themeSelect.value = localStorage.getItem('theme') || 'light';
        document.getElementById('settings-modal').style.display = 'flex';
        fetch('/api/user/me', { headers: { 'Authorization': `Bearer ${token}` } })
        .then(r => r.ok ? r.json() : null)
        .then(u => { if (u) fillProfileForm(u); });
    };

    const menuToggle = document.getElementById('menu-toggle-btn');
    if (menuToggle) menuToggle.onclick = toggleSidebar;
    document.getElementById('panel-overlay').onclick = closeSidebar;

    document.querySelectorAll('.close-modal').forEach(btn => {
        btn.onclick = () => {
            ['group-modal', 'settings-modal', 'search-modal', 'profile-modal',
            'timeline-modal', 'group-avatar-modal', 'totp-setup-modal',
            'backup-codes-modal', 'email-2fa-modal'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.style.display = 'none';
            });
        };
    });

    window.onclick = (e) => {
        ['group-modal', 'settings-modal', 'search-modal', 'profile-modal',
        'timeline-modal', 'group-avatar-modal', 'totp-setup-modal',
        'backup-codes-modal', 'email-2fa-modal'].forEach(id => {
            const el = document.getElementById(id);
            if (e.target === el) el.style.display = 'none';
        });
    };

    const themeSelect = document.getElementById('theme-select');
    if (themeSelect) {
        themeSelect.onchange = (e) => {
            applyTheme(e.target.value);
            localStorage.setItem('theme', e.target.value);
            loadStateManager().then(({ saveState }) => saveState({ theme: e.target.value }));
        };
    }

    const autoDownloadSelect = document.getElementById('auto-download');
    if (autoDownloadSelect) {
        autoDownloadSelect.value = localStorage.getItem('auto_download') || 'always';
        autoDownloadSelect.onchange = (e) => localStorage.setItem('auto_download', e.target.value);
    }
    const imagePreviewSelect = document.getElementById('image-preview');
    if (imagePreviewSelect) {
        imagePreviewSelect.value = localStorage.getItem('image_preview') || 'always';
        imagePreviewSelect.onchange = (e) => localStorage.setItem('image_preview', e.target.value);
    }
    const markdownToggle = document.getElementById('markdown-toggle');
    if (markdownToggle) {
        markdownToggle.checked = localStorage.getItem('markdown') === 'true';
        markdownToggle.onchange = (e) => localStorage.setItem('markdown', e.target.checked);
    }

    document.getElementById('user-search').oninput = debounce(searchUsers, 300);
    document.getElementById('create-group-confirm').onclick = createGroup;

    document.getElementById('request-push-btn').onclick = async () => {
        await subscribeToPush(true);
        await updatePushStatus();
    };

    const searchInput = document.getElementById('search-query');
    if (searchInput) {
        searchInput.addEventListener('input', debounce(e => {
            if (e.target.value.length > 2) searchMessages(e.target.value);
        }, 300));
    }

    const messagesArea = document.getElementById('messages-area');
    let scrollTimeout = null;
    messagesArea.addEventListener('scroll', () => {
        if (scrollTimeout) clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(() => {
            if (messagesArea.scrollTop <= 1 && !loadingMessages && hasMoreMessages) {
                loadMoreMessages();
            }
        }, 100);
    });

    document.getElementById('back-to-chats-btn').onclick = () => {
        document.body.classList.remove('chat-open');
        setCurrentChatId(null);
        document.getElementById('message-input-area').style.display = 'none';
        document.getElementById('chat-title').textContent = 'Выберите чат';
        messagesArea.querySelectorAll('.message').forEach(m => m.audioCleanup?.());
        messagesArea.innerHTML = '';
        document.querySelectorAll('.chat-item').forEach(el => el.classList.remove('active'));
        document.getElementById('chat-menu-btn').style.display = 'none';
        loadStateManager().then(({ saveState }) => saveState({ lastChatId: null }));
    };

    document.getElementById('logout-btn').onclick = doLogout;
    document.getElementById('save-profile-btn').onclick = async () => {
        const ok = await saveProfile();
        if (ok) await loadProfile();
    };

        document.getElementById('timeline-btn').onclick = async () => {
            document.getElementById('timeline-modal').style.display = 'flex';
            const resp = await fetch('/api/connection_logs', { headers: { 'Authorization': `Bearer ${token}` } });
            if (!await checkAuth(resp)) return;
            const logs = await resp.json();
            document.getElementById('timeline-list').innerHTML = logs.map(
                log => `<div>${new Date(log.timestamp).toLocaleString()} — ${log.event_type} (${log.reason})</div>`
            ).join('');
        };

        ['user-avatar-clickable', 'username-clickable'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.onclick = async () => {
                document.getElementById('profile-modal').style.display = 'flex';
                await loadProfile();
                await refresh2FAStatus();
            };
        });

        const avatarUpload = document.getElementById('avatar-upload');
        const uploadAvatarBtn = document.getElementById('upload-avatar-btn');
        if (uploadAvatarBtn && avatarUpload) {
            uploadAvatarBtn.onclick = async () => {
                const file = avatarUpload.files[0];
                if (!file) return;
                const formData = new FormData();
                formData.append('file', file);
                const resp = await fetch('/api/upload_avatar', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${token}` },
                    body: formData
                });
                if (resp.ok) {
                    const data = await resp.json();
                    updateAvatarDisplay(data.avatar_url);
                    alert('Аватар обновлён');
                } else {
                    alert('Ошибка загрузки');
                }
            };
        }

        const importThemeBtn = document.getElementById('import-theme-btn');
        const themeFile = document.getElementById('theme-file');
        if (importThemeBtn && themeFile) {
            importThemeBtn.onclick = () => {
                const file = themeFile.files[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = () => importTheme(reader.result);
                reader.readAsText(file);
            };
        }
}

window.onload = () => {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('reset_token')) return;
    const saved = localStorage.getItem('token');
    if (saved) { setToken(saved); initApp(); }
};
