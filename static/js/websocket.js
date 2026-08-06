import { token, currentChatId, WS_RECONNECT_MAX_ATTEMPTS, WS_RECONNECT_DELAY_BASE } from './config.js';
import { updateConnectionStatus } from './ui.js';
import { displayMessage, updateChatInList, markRead } from './chat.js';

let wsInstance = null;
let wsReconnectTimer = null;
let wsReconnectAttempts = 0;
let connectionTimeout = null;

export function connectWebSocket() {
    if (wsInstance && wsInstance.readyState === WebSocket.OPEN) return;
    if (wsReconnectTimer) clearTimeout(wsReconnectTimer);
    if (connectionTimeout) clearTimeout(connectionTimeout);

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/${token}`;
    wsInstance = new WebSocket(wsUrl);

    connectionTimeout = setTimeout(() => {
        if (wsInstance && wsInstance.readyState !== WebSocket.OPEN) {
            console.warn('WebSocket connection timeout, closing...');
            wsInstance.close();
        }
    }, 5000);

    wsInstance.onopen = () => {
        console.log('✅ WebSocket connected');
        if (connectionTimeout) clearTimeout(connectionTimeout);
        updateConnectionStatus(true);
        wsReconnectAttempts = 0;
        if (wsInstance.heartbeatInterval) clearInterval(wsInstance.heartbeatInterval);
        wsInstance.heartbeatInterval = setInterval(() => {
            if (wsInstance.readyState === WebSocket.OPEN) {
                wsInstance.send(JSON.stringify({ type: 'ping' }));
            }
        }, 30000);
    };

    wsInstance.onclose = (event) => {
        console.log(`❌ WebSocket closed (${event.code})`, event.reason);
        if (connectionTimeout) clearTimeout(connectionTimeout);
        updateConnectionStatus(false);
        clearInterval(wsInstance.heartbeatInterval);
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

    wsInstance.onerror = (error) => {
        console.error('WebSocket error:', error);
    };

    wsInstance.onmessage = (event) => {
        try {
            const msg = JSON.parse(event.data);
            if (msg.type === 'pong') return;
            if (msg.type === 'edit') {
                const msgDiv = document.querySelector(`.message[data-msg-id="${msg.message_id}"]`);
                if (msgDiv) {
                    const textDiv = msgDiv.querySelector('.text');
                    if (textDiv) textDiv.innerHTML = msg.text;
                }
                return;
            }
            if (msg.type === 'delete') {
                const msgDiv = document.querySelector(`.message[data-msg-id="${msg.message_id}"]`);
                if (msgDiv) msgDiv.remove();
                return;
            }
            if (msg.type === 'status') return;
            displayMessage(msg);
            if (msg.chat_id === currentChatId) markRead(msg.chat_id);
            updateChatInList(msg.chat_id, msg.text || 'Медиафайл', true);
        } catch (e) {
            console.error('Ошибка обработки сообщения WebSocket', e);
        }
    };
}

export function sendWebSocketMessage(data) {
    if (wsInstance && wsInstance.readyState === WebSocket.OPEN) {
        wsInstance.send(JSON.stringify(data));
    }
}