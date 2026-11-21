import { setVapidPublicKey, setToken, setCurrentUserId, token, setCurrentChatId } from './config.js';
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
        document.querySelector('.login-card h2').textContent = 'Восстановление пароля';
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
}

async function doRegister() {
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;
    const email = document.getElementById('register-email').value.trim();

    if (!/^[a-zA-Z0-9_]{3,32}$/.test(username)) {
        return alert('Имя: 3–32 символа, только латиница, цифры и _');
    }
    if (password.length < 8) return alert('Пароль минимум 8 символов');
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return alert('Укажите корректный email');
    }

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
    if (resp.ok) {
        setToken(data.access_token);
        localStorage.setItem('token', data.access_token);
        await initApp();
    } else {
        alert('Ошибка входа: ' + (data.detail || 'Неверные данные'));
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
        alert('Если такой email зарегистрирован, мы отправили ссылку для сброса пароля.');
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
        alert('Пароль изменён! Войдите с новым паролем.');
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
            .then(async () => {
                await subscribeToPush();
                await updatePushStatus();
            })
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
        console.error('Failed to load VAPID key:', err);
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
    const sendBtn = document.getElementById('send-btn');
    if (sendBtn) sendBtn.onclick = sendMessageWithFiles;

    const messageText = document.getElementById('message-text');
    if (messageText) {
        messageText.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.isComposing) {
                e.preventDefault();
                sendMessageWithFiles();
            }
        });
    }

    const micBtn = document.getElementById('mic-btn');
    if (micBtn) micBtn.onclick = toggleRecording;

    const fileInput = document.getElementById('file-input');
    if (fileInput) fileInput.onchange = handleFileSelection;

    const newGroupBtn = document.getElementById('new-group-btn');
    if (newGroupBtn) newGroupBtn.onclick = openGroupModal;

    const settingsBtn = document.getElementById('settings-btn');
    if (settingsBtn) {
        settingsBtn.onclick = () => {
            const themeSelect = document.getElementById('theme-select');
            if (themeSelect) themeSelect.value = localStorage.getItem('theme') || 'light';
            document.getElementById('settings-modal').style.display = 'flex';
            fetch('/api/user/me', { headers: { 'Authorization': `Bearer ${token}` } })
            .then(r => r.ok ? r.json() : null)
            .then(u => { if (u) fillProfileForm(u); });
        };
    }

    const menuToggle = document.getElementById('menu-toggle-btn');
    if (menuToggle) menuToggle.onclick = toggleSidebar;

    const panelOverlay = document.getElementById('panel-overlay');
    if (panelOverlay) panelOverlay.onclick = closeSidebar;

    document.querySelectorAll('.close-modal').forEach(btn => {
        btn.onclick = () => {
            ['group-modal', 'settings-modal', 'search-modal', 'profile-modal', 'timeline-modal'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.style.display = 'none';
            });
        };
    });

    window.onclick = (e) => {
        ['group-modal', 'settings-modal', 'search-modal', 'profile-modal', 'timeline-modal'].forEach(id => {
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

    const userSearch = document.getElementById('user-search');
    if (userSearch) userSearch.oninput = debounce(searchUsers, 300);

    const createGroupConfirm = document.getElementById('create-group-confirm');
    if (createGroupConfirm) createGroupConfirm.onclick = createGroup;

    const requestPushBtn = document.getElementById('request-push-btn');
    if (requestPushBtn) {
        requestPushBtn.onclick = async () => {
            await subscribeToPush(true);
            await updatePushStatus();
        };
    }

    const deleteChatBtn = document.getElementById('delete-chat-btn');
    if (deleteChatBtn) deleteChatBtn.onclick = () => deleteChat();

    const searchMessagesBtn = document.getElementById('search-messages-btn');
    if (searchMessagesBtn) {
        searchMessagesBtn.onclick = () => {
            document.getElementById('search-modal').style.display = 'flex';
            document.getElementById('search-query').value = '';
            document.getElementById('search-results-list').innerHTML = '';
        };
    }

    const searchInput = document.getElementById('search-query');
    if (searchInput) {
        searchInput.addEventListener('input', debounce(e => {
            if (e.target.value.length > 2) searchMessages(e.target.value);
        }, 300));
    }

    const messagesArea = document.getElementById('messages-area');
    if (messagesArea) {
        let scrollTimeout = null;
        messagesArea.addEventListener('contextmenu', (e) => {
            const msgDiv = e.target.closest('.message');
            if (!msgDiv || msgDiv.dataset.deleted === '1') return;
            e.preventDefault();
            const contextMenu = document.getElementById('context-menu');
            if (!contextMenu) return;
            contextMenu.style.display = 'block';
            let left = e.clientX, top = e.clientY;
            const mw = contextMenu.offsetWidth, mh = contextMenu.offsetHeight;
            if (left + mw > window.innerWidth) left = window.innerWidth - mw - 10;
            if (top + mh > window.innerHeight) top = window.innerHeight - mh - 10;
            contextMenu.style.left = left + 'px';
            contextMenu.style.top = top + 'px';
            contextMenu.dataset.msgId = msgDiv.dataset.msgId;
        });
        document.addEventListener('click', () => {
            const cm = document.getElementById('context-menu');
            if (cm) cm.style.display = 'none';
        });
            messagesArea.addEventListener('scroll', () => {
                if (scrollTimeout) clearTimeout(scrollTimeout);
                scrollTimeout = setTimeout(() => {
                    if (messagesArea.scrollTop <= 1 && !loadingMessages && hasMoreMessages) {
                        loadMoreMessages();
                    }
                }, 100);
            });
    }

    const contextMenu = document.getElementById('context-menu');
    if (contextMenu) {
        const editItem = contextMenu.querySelector('.context-edit');
        if (editItem) editItem.onclick = () => {
            const msgId = contextMenu.dataset.msgId;
            const msgDiv = document.querySelector(`.message[data-msg-id="${msgId}"]`);
            const oldText = msgDiv?.querySelector('.text-body')?.innerText || '';
            const newText = prompt('Редактировать сообщение:', oldText);
            if (newText) editMessage(msgId, newText);
            contextMenu.style.display = 'none';
        };
        const deleteItem = contextMenu.querySelector('.context-delete');
        if (deleteItem) deleteItem.onclick = () => {
            const msgId = contextMenu.dataset.msgId;
            if (confirm('Удалить сообщение?')) deleteMessage(msgId);
            contextMenu.style.display = 'none';
        };
    }

    const backBtn = document.getElementById('back-to-chats-btn');
    if (backBtn) {
        backBtn.onclick = () => {
            document.body.classList.remove('chat-open');
            setCurrentChatId(null);
            const inputArea = document.getElementById('message-input-area');
            if (inputArea) inputArea.style.display = 'none';
            document.getElementById('chat-title').textContent = 'Выберите чат';
            const messagesArea = document.getElementById('messages-area');
            if (messagesArea) {
                messagesArea.querySelectorAll('.message').forEach(m => m.audioCleanup?.());
                messagesArea.innerHTML = '';
            }
            document.querySelectorAll('.chat-item').forEach(el => el.classList.remove('active'));
            ['delete-chat-btn', 'search-messages-btn', 'export-chat-btn'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.style.display = 'none';
            });
                loadStateManager().then(({ saveState }) => saveState({ lastChatId: null, scrollOffset: 0 }));
        };
    }

    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) logoutBtn.onclick = doLogout;

    const saveProfileBtn = document.getElementById('save-profile-btn');
    if (saveProfileBtn) saveProfileBtn.onclick = async () => {
        const ok = await saveProfile();
        if (ok) await loadProfile();
    };

        const timelineBtn = document.getElementById('timeline-btn');
        if (timelineBtn) {
            timelineBtn.onclick = async () => {
                document.getElementById('timeline-modal').style.display = 'flex';
                const resp = await fetch('/api/connection_logs', { headers: { 'Authorization': `Bearer ${token}` } });
                if (!await checkAuth(resp)) return;
                const logs = await resp.json();
                document.getElementById('timeline-list').innerHTML = logs.map(
                    log => `<div>${new Date(log.timestamp).toLocaleString()} — ${log.event_type} (${log.reason})</div>`
                ).join('');
            };
        }

        const exportChatBtn = document.getElementById('export-chat-btn');
        if (exportChatBtn) {
            exportChatBtn.onclick = async () => {
                const { currentChatId } = await import('./config.js');
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
            };
        }

        ['user-avatar-clickable', 'username-clickable'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.onclick = async () => {
                document.getElementById('profile-modal').style.display = 'flex';
                await loadProfile();
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
    if (saved) {
        setToken(saved);
        initApp();
    }
};
