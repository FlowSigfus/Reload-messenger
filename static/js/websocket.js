import { token, currentChatId, currentUserId, WS_RECONNECT_MAX_ATTEMPTS, WS_RECONNECT_DELAY_BASE } from './config.js';
import { updateConnectionStatus } from './ui.js';
import { displayMessage, updateChatInList, updateChatAvatar, markRead, loadChats, selectChat } from './chat.js';

let wsInstance = null;
let wsReconnectTimer = null;
let wsReconnectAttempts = 0;
let connectionTimeout = null;
let heartbeatTimer = null;
let everConnected = false;

export function connectWebSocket() {
    if (wsInstance && (wsInstance.readyState === WebSocket.OPEN
        || wsInstance.readyState === WebSocket.CONNECTING)) return;
    if (wsReconnectTimer) clearTimeout(wsReconnectTimer);

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    wsInstance = new WebSocket(`${protocol}//${window.location.host}/ws/${token}`);

    connectionTimeout = setTimeout(() => {
        if (wsInstance && wsInstance.readyState !== WebSocket.OPEN) wsInstance.close();
    }, 5000);

        wsInstance.onopen = async () => {
            clearTimeout(connectionTimeout);
            updateConnectionStatus(true);
            wsReconnectAttempts = 0;
            if (heartbeatTimer) clearInterval(heartbeatTimer);
            heartbeatTimer = setInterval(() => {
                if (wsInstance?.readyState === WebSocket.OPEN) {
                    wsInstance.send(JSON.stringify({ type: 'ping' }));
                }
            }, 30000);

            if (everConnected) {
                try {
                    await loadChats();
                    if (currentChatId) await selectChat(currentChatId);
                } catch (e) { console.error('resync:', e); }
            }
            everConnected = true;
        };

        wsInstance.onclose = (event) => {
            clearTimeout(connectionTimeout);
            if (heartbeatTimer) clearInterval(heartbeatTimer);
            updateConnectionStatus(false);

            if (event.code === 1008 || event.code === 403) {
                localStorage.removeItem('token');
                alert('Сессия истекла. Войдите заново.');
                window.location.href = '/static/index.html?reload=' + Date.now();
                return;
            }
            if (wsReconnectAttempts < WS_RECONNECT_MAX_ATTEMPTS) {
                const delay = Math.min(WS_RECONNECT_DELAY_BASE * Math.pow(1.5, wsReconnectAttempts), 60000);
                wsReconnectTimer = setTimeout(() => {
                    wsReconnectAttempts++;
                    connectWebSocket();
                }, delay);
            }
        };

        wsInstance.onerror = (e) => console.error('WS error:', e);

        wsInstance.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                if (msg.type === 'pong' || msg.type === 'status') return;

                if (msg.type === 'edit') {
                    const el = document.querySelector(`.message[data-msg-id="${msg.message_id}"]`);
                    if (el) {
                        const body = el.querySelector('.text-body');
                        if (body) body.textContent = msg.text;
                    }
                    return;
                }
                if (msg.type === 'delete') {
                    const el = document.querySelector(`.message[data-msg-id="${msg.message_id}"]`);
                    if (el) { el.audioCleanup?.(); el.remove(); }
                    return;
                }
                if (msg.type === 'chat_deleted') {
                    document.querySelector(`.chat-item[data-chat-id="${msg.chat_id}"]`)?.remove();
                    if (currentChatId === msg.chat_id) {
                        document.getElementById('messages-area').innerHTML = '';
                        document.getElementById('message-input-area').style.display = 'none';
                        document.getElementById('chat-title').textContent = 'Выберите чат';
                    }
                    return;
                }
                if (msg.type === 'group_avatar_updated') {
                    const item = document.querySelector(`.chat-item[data-chat-id="${msg.chat_id}"]`);
                    const nameEl = item?.querySelector('.chat-name');
                    updateChatAvatar(msg.chat_id, msg.avatar_url, nameEl?.textContent);
                    return;
                }

                const preview = msg.text || 'Медиафайл';
                if (msg.chat_id === currentChatId) {
                    displayMessage(msg);
                    markRead(msg.chat_id);
                    updateChatInList(msg.chat_id, preview, false);
                } else {
                    updateChatInList(msg.chat_id, preview, msg.user_id !== currentUserId);
                }
            } catch (e) {
                console.error('WS parse:', e);
            }
        };
}

export function sendWebSocketMessage(data) {
    if (wsInstance && wsInstance.readyState === WebSocket.OPEN) {
        wsInstance.send(JSON.stringify(data));
        return true;
    }
    return false;
}
