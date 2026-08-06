import { setVapidPublicKey, setToken, setCurrentUserId, token, setCurrentChatId } from './config.js';
import { checkAuth } from './auth.js';
import { connectWebSocket } from './websocket.js';
import {
    loadChats, selectChat, sendMessageWithFiles, handleFileSelection,
    loadMoreMessages, hasMoreMessages, loadingMessages, deleteChat,
    searchMessages, editMessage, deleteMessage
} from './chat.js';
import { updatePushStatus, applyTheme, toggleSidebar, closeSidebar, loadProfileForm, saveProfile } from './ui.js';
import { subscribeToPush } from './push.js';
import { openGroupModal, searchUsers, createGroup } from './groups.js';
import { toggleRecording } from './voice.js';

let stateManager, terminalModule;

async function loadStateManager() {
    if (!stateManager) {
        stateManager = await import('./stateManager.js');
    }
    return stateManager;
}

async function loadTerminal() {
    if (!terminalModule) {
        terminalModule = await import('./terminal.js');
        terminalModule.initTerminal();
    }
    return terminalModule;
}

window.auth = {
    register: async () => {
        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;
        const nickname = document.getElementById('nickname').value.trim();
        if (!nickname) {
            alert('Пожалуйста, укажите отображаемое имя (никнейм)');
            return;
        }
        const firstName = document.getElementById('first-name')?.value || '';
        const lastName = document.getElementById('last-name')?.value || '';
        const birthYear = document.getElementById('birth-year')?.value || null;
        const resp = await fetch('/api/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password, nickname, first_name: firstName, last_name: lastName, birth_year: birthYear })
        });
        const data = await resp.json();
        if (resp.ok) alert('Регистрация успешна! Теперь войдите.');
        else alert('Ошибка: ' + (data.detail || 'Неизвестная ошибка'));
    },
    login: async () => {
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
    },
    logout: () => {
        localStorage.removeItem('token');
        window.location.href = '/static/index.html?reload=' + Date.now();
    }
};

export async function initApp() {
    document.body.classList.remove('chat-open');
    setCurrentChatId(null);

    document.getElementById('login-form').style.display = 'none';
    document.getElementById('app').style.display = 'block';

    const loadingOverlay = document.getElementById('loading-overlay');
    if (loadingOverlay) loadingOverlay.style.display = 'flex';

    let resizeTimeout;
    function setViewportHeight() {
        const vh = window.innerHeight * 0.01;
        document.documentElement.style.setProperty('--vh', `${vh}px`);
    }
    setViewportHeight();
    window.addEventListener('resize', () => {
        if (resizeTimeout) clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(setViewportHeight, 100);
    });

    const chatsPromise = loadChats().catch(err => console.error('Chats error', err));
    const profilePromise = loadProfile().catch(err => console.error('Profile error', err));
    const vapidPromise = loadVapidPublicKey().catch(err => console.error('Vapid error', err));
    connectWebSocket();

    await chatsPromise;
    if (loadingOverlay) loadingOverlay.style.display = 'none';

    setupEventListeners();

    Promise.all([profilePromise, vapidPromise]).then(() => {});

    if ('serviceWorker' in navigator) {
        requestIdleCallback(() => {
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
        if (resp.ok) {
            const user = await resp.json();
            const displayName = user.nickname || user.username;
            document.getElementById('display-name').textContent = displayName;
            const nicknameDisplay = document.getElementById('nickname-display');
            if (user.nickname && user.nickname !== user.username) {
                nicknameDisplay.textContent = `@${user.username}`;
            } else {
                nicknameDisplay.textContent = '';
            }
            updateAvatarDisplay(user.avatar_url);
            setCurrentUserId(user.id);
            if (document.getElementById('profile-nickname')) document.getElementById('profile-nickname').value = user.nickname || '';
            if (document.getElementById('profile-first-name')) document.getElementById('profile-first-name').value = user.first_name || '';
            if (document.getElementById('profile-last-name')) document.getElementById('profile-last-name').value = user.last_name || '';
            if (document.getElementById('profile-birth-year')) document.getElementById('profile-birth-year').value = user.birth_year || '';
        }
    } catch(e) { console.error(e); }
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

function setupEventListeners() {
    const sendBtn = document.getElementById('send-btn');
    if (sendBtn) sendBtn.onclick = sendMessageWithFiles;

    const messageText = document.getElementById('message-text');
    if (messageText) {
        messageText.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') sendMessageWithFiles();
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
            const modal = document.getElementById('settings-modal');
            const themeSelect = document.getElementById('theme-select');
            if (themeSelect) themeSelect.value = localStorage.getItem('theme') || 'light';
            if (modal) modal.style.display = 'flex';
            loadProfileForm();
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
    if (userSearch) userSearch.oninput = searchUsers;

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
            const modal = document.getElementById('search-modal');
            if (modal) modal.style.display = 'flex';
            const searchQuery = document.getElementById('search-query');
            if (searchQuery) searchQuery.value = '';
            const resultsList = document.getElementById('search-results-list');
            if (resultsList) resultsList.innerHTML = '';
        };
    }

    const searchInput = document.getElementById('search-query');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            if (e.target.value.length > 2) searchMessages(e.target.value);
        });
    }

    const messagesArea = document.getElementById('messages-area');
    let scrollTimeout = null;
    if (messagesArea) {
        messagesArea.addEventListener('contextmenu', (e) => {
            const msgDiv = e.target.closest('.message');
            if (!msgDiv) return;
            e.preventDefault();
            const contextMenu = document.getElementById('context-menu');
            if (contextMenu) {
                contextMenu.style.display = 'block';
                let left = e.clientX;
                let top = e.clientY;
                const menuWidth = contextMenu.offsetWidth;
                const menuHeight = contextMenu.offsetHeight;
                if (left + menuWidth > window.innerWidth) left = window.innerWidth - menuWidth - 10;
                if (top + menuHeight > window.innerHeight) top = window.innerHeight - menuHeight - 10;
                contextMenu.style.left = left + 'px';
                contextMenu.style.top = top + 'px';
                contextMenu.dataset.msgId = msgDiv.dataset.msgId;
            }
        });
        document.addEventListener('click', () => {
            const contextMenu = document.getElementById('context-menu');
            if (contextMenu) contextMenu.style.display = 'none';
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
        if (editItem) {
            editItem.onclick = () => {
                const msgId = contextMenu.dataset.msgId;
                const msgDiv = document.querySelector(`.message[data-msg-id="${msgId}"]`);
                const oldText = msgDiv?.querySelector('.text')?.innerText;
                const newText = prompt('Редактировать сообщение:', oldText);
                if (newText) editMessage(msgId, newText);
                contextMenu.style.display = 'none';
            };
        }
        const deleteItem = contextMenu.querySelector('.context-delete');
        if (deleteItem) {
            deleteItem.onclick = () => {
                const msgId = contextMenu.dataset.msgId;
                if (confirm('Удалить сообщение?')) deleteMessage(msgId);
                contextMenu.style.display = 'none';
            };
        }
    }

    const backBtn = document.getElementById('back-to-chats-btn');
    if (backBtn) {
        backBtn.onclick = () => {
            document.body.classList.remove('chat-open');
            setCurrentChatId(null);
            const inputArea = document.getElementById('message-input-area');
            if (inputArea) inputArea.style.display = 'none';
            const chatTitle = document.getElementById('chat-title');
            if (chatTitle) chatTitle.textContent = 'Выберите чат';
            const messagesArea = document.getElementById('messages-area');
            if (messagesArea) messagesArea.innerHTML = '';
            document.querySelectorAll('.chat-item').forEach(el => el.classList.remove('active'));
            const deleteBtn = document.getElementById('delete-chat-btn');
            const searchBtn = document.getElementById('search-messages-btn');
            if (deleteBtn) deleteBtn.style.display = 'none';
            if (searchBtn) searchBtn.style.display = 'none';
            loadStateManager().then(({ saveState }) => saveState({ lastChatId: null, scrollOffset: 0 }));
        };
    }

    const terminalToggle = document.getElementById('terminal-toggle');
    if (terminalToggle) {
        terminalToggle.onclick = async () => {
            await loadTerminal();
            window.toggleTerminal();
        };
    }

    const saveProfileBtn = document.getElementById('save-profile-btn');
    if (saveProfileBtn) saveProfileBtn.onclick = saveProfile;

    const timelineBtn = document.getElementById('timeline-btn');
    if (timelineBtn) {
        timelineBtn.onclick = async () => {
            const modal = document.getElementById('timeline-modal');
            if (modal) modal.style.display = 'flex';
            const resp = await fetch('/api/connection_logs', { headers: { 'Authorization': `Bearer ${token}` } });
            const logs = await resp.json();
            const list = document.getElementById('timeline-list');
            if (list) {
                list.innerHTML = logs.map(log => `<div>${new Date(log.timestamp).toLocaleString()} - ${log.event_type} (${log.reason})</div>`).join('');
            }
        };
    }

    const exportChatBtn = document.getElementById('export-chat-btn');
    if (exportChatBtn) {
        exportChatBtn.onclick = async () => {
            if (!currentChatId) return;
            window.open(`/api/chat/${currentChatId}/export`, '_blank');
        };
    }

    const userAvatarClickable = document.getElementById('user-avatar-clickable');
    const userNameClickable = document.getElementById('username-clickable');
    if (userAvatarClickable) {
        userAvatarClickable.onclick = () => {
            const modal = document.getElementById('profile-modal');
            if (modal) modal.style.display = 'flex';
            loadProfileForm();
        };
    }
    if (userNameClickable) {
        userNameClickable.onclick = () => {
            const modal = document.getElementById('profile-modal');
            if (modal) modal.style.display = 'flex';
            loadProfileForm();
        };
    }

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

    const showRegisterBtn = document.getElementById('show-register-fields');
    const registerFields = document.getElementById('register-fields');
    const loginBtn = document.getElementById('login-btn');
    if (showRegisterBtn && registerFields) {
        showRegisterBtn.onclick = () => {
            registerFields.style.display = registerFields.style.display === 'none' ? 'block' : 'none';
            showRegisterBtn.textContent = registerFields.style.display === 'none' ? 'Регистрация' : 'Скрыть поля';
        };
    }
    if (loginBtn) {
        loginBtn.onclick = () => window.auth.login();
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

window.onload = () => {
    const savedToken = localStorage.getItem('token');
    if (savedToken) {
        setToken(savedToken);
        initApp();
    }
};