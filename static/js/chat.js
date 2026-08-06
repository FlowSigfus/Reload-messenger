import { token, currentChatId, currentUserId, setCurrentChatId } from './config.js';
import { checkAuth } from './auth.js';
import { sendWebSocketMessage } from './websocket.js';
import { closeSidebar, setSendButtonLoading } from './ui.js';
import { getImagePreviewSetting, isWiFi } from './ui.js';

export let hasMoreMessages = true;
export let loadingMessages = false;
export let oldestMessageId = null;
export let selectedFiles = [];
export let isSending = false;

const messagesArea = document.getElementById('messages-area');
const filePreviewDiv = document.getElementById('file-preview');
const messageText = document.getElementById('message-text');

let audioPlayerModule = null;
async function getAudioPlayer() {
    if (!audioPlayerModule) {
        audioPlayerModule = await import('./audioPlayer.js');
    }
    return audioPlayerModule;
}

function getFileIcon(fileType, fileName) {
    const ext = fileName.split('.').pop().toLowerCase();
    if (fileType === 'image') return 'fa-image';
    if (fileType === 'audio') return 'fa-music';
    if (['pdf'].includes(ext)) return 'fa-file-pdf';
    if (['doc', 'docx'].includes(ext)) return 'fa-file-word';
    if (['xls', 'xlsx'].includes(ext)) return 'fa-file-excel';
    if (['zip', 'rar', '7z'].includes(ext)) return 'fa-file-archive';
    return 'fa-file';
}

function getFileNameFromUrl(url) {
    return decodeURIComponent(url.split('/').pop());
}

export async function loadChats() {
    const resp = await fetch('/api/chats', { headers: { 'Authorization': `Bearer ${token}` } });
    if (!await checkAuth(resp)) return;
    const chats = await resp.json();
    const listDiv = document.getElementById('chats-list');
    const fragment = document.createDocumentFragment();
    chats.forEach(chat => {
        const el = createChatElement(chat);
        fragment.appendChild(el);
    });
    listDiv.innerHTML = '';
    listDiv.appendChild(fragment);
}

function createChatElement(chat) {
    const div = document.createElement('div');
    div.className = 'chat-item';
    if (chat.id === currentChatId) div.classList.add('active');
    div.dataset.chatId = chat.id;

    const avatar = document.createElement('div');
    avatar.className = 'chat-avatar';
    avatar.textContent = (chat.is_group ? chat.name : chat.other_user).charAt(0).toUpperCase();

    const info = document.createElement('div');
    info.className = 'chat-info';
    const name = document.createElement('div');
    name.className = 'chat-name';
    name.textContent = chat.is_group ? chat.name : `Чат с ${chat.other_user}`;
    const lastMsg = document.createElement('div');
    lastMsg.className = 'chat-last-message';
    lastMsg.textContent = chat.last_message || 'Нет сообщений';
    info.appendChild(name);
    info.appendChild(lastMsg);

    div.appendChild(avatar);
    div.appendChild(info);

    if (chat.unread_count > 0) {
        const unread = document.createElement('span');
        unread.className = 'chat-unread';
        unread.textContent = chat.unread_count;
        div.appendChild(unread);
    }

    div.onclick = () => selectChat(chat.id);
    return div;
}

export function updateChatInList(chatId, lastMessage, hasUnread = false) {
    const chatItem = document.querySelector(`.chat-item[data-chat-id="${chatId}"]`);
    if (chatItem) {
        const lastMsgDiv = chatItem.querySelector('.chat-last-message');
        lastMsgDiv.textContent = lastMessage;
        if (hasUnread && chatId !== currentChatId) {
            let unreadSpan = chatItem.querySelector('.chat-unread');
            if (!unreadSpan) {
                unreadSpan = document.createElement('span');
                unreadSpan.className = 'chat-unread';
                chatItem.appendChild(unreadSpan);
            }
            const current = parseInt(unreadSpan.textContent) || 0;
            unreadSpan.textContent = current + 1;
        }
    }
}

export async function selectChat(chatId) {
    setCurrentChatId(chatId);
    messagesArea.innerHTML = '';
    document.getElementById('message-input-area').style.display = 'flex';
    hasMoreMessages = true;
    loadingMessages = false;
    oldestMessageId = null;

    await loadLatestMessages();

    document.querySelectorAll('.chat-item').forEach(el => el.classList.remove('active'));
    const activeChat = document.querySelector(`.chat-item[data-chat-id="${chatId}"]`);
    if (activeChat) activeChat.classList.add('active');
    const chatName = activeChat ? activeChat.querySelector('.chat-name').textContent : 'Чат';
    document.getElementById('chat-title').textContent = chatName;

    const deleteBtn = document.getElementById('delete-chat-btn');
    const searchBtn = document.getElementById('search-messages-btn');
    if (deleteBtn) deleteBtn.style.display = 'inline-block';
    if (searchBtn) searchBtn.style.display = 'inline-block';

    const isMobile = window.matchMedia('(max-width: 768px)').matches;
    if (isMobile) {
        document.body.classList.add('chat-open');
    } else {
        closeSidebar();
    }
}

export async function loadLatestMessages() {
    if (!currentChatId || loadingMessages) return;
    loadingMessages = true;
    hasMoreMessages = true;
    oldestMessageId = null;

    try {
        const isMobile = window.matchMedia('(max-width: 768px)').matches;
        const limit = isMobile ? 10 : 20;
        const url = `/api/messages/${currentChatId}?limit=${limit}`;
        const resp = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
        if (!await checkAuth(resp)) return;
        const messages = await resp.json();

        if (messages.length === 0) {
            hasMoreMessages = false;
            loadingMessages = false;
            return;
        }

        oldestMessageId = messages[0]?.id;

        const fragment = document.createDocumentFragment();
        for (const msg of messages) {
            const msgElement = await createMessageElement(msg);
            fragment.appendChild(msgElement);
        }
        messagesArea.appendChild(fragment);

        requestAnimationFrame(() => {
            messagesArea.scrollTop = messagesArea.scrollHeight;
        });

        if (messages.length < limit) hasMoreMessages = false;
    } catch (e) {
        console.error('Error loading latest messages:', e);
    } finally {
        loadingMessages = false;
    }
}

export async function loadMoreMessages() {
    if (!currentChatId || loadingMessages || !hasMoreMessages || !oldestMessageId) {
        console.log('Cannot load more:', { currentChatId, loadingMessages, hasMoreMessages, oldestMessageId });
        return;
    }
    loadingMessages = true;

    try {
        let url = `/api/messages/${currentChatId}?limit=20&before=${oldestMessageId}`;
        const resp = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
        if (!await checkAuth(resp)) return;
        const messages = await resp.json();

        if (messages.length === 0) {
            hasMoreMessages = false;
            loadingMessages = false;
            return;
        }

        const oldScrollHeight = messagesArea.scrollHeight;
        const oldScrollTop = messagesArea.scrollTop;

        const fragment = document.createDocumentFragment();
        for (let i = messages.length - 1; i >= 0; i--) {
            const msgElement = await createMessageElement(messages[i]);
            fragment.appendChild(msgElement);
        }
        messagesArea.insertBefore(fragment, messagesArea.firstChild);

        oldestMessageId = messages[0]?.id;

        if (oldestMessageId) {
            const newScrollHeight = messagesArea.scrollHeight;
            messagesArea.scrollTop = oldScrollTop + (newScrollHeight - oldScrollHeight);
        }

        if (messages.length < 20) hasMoreMessages = false;
    } catch (e) {
        console.error('Error loading more messages:', e);
    } finally {
        loadingMessages = false;
    }
}

export async function markRead(chatId) {
    const resp = await fetch(`/api/mark_read/${chatId}`, { method: 'POST', headers: { 'Authorization': `Bearer ${token}` } });
    await checkAuth(resp);
    const unreadSpan = document.querySelector(`.chat-item[data-chat-id="${chatId}"] .chat-unread`);
    if (unreadSpan) unreadSpan.remove();
}

async function createMessageElement(msg) {
    if (msg.is_deleted) {
        const div = document.createElement('div');
        div.className = `message ${msg.user_id === currentUserId ? 'sent' : 'received'}`;
        div.dataset.msgId = msg.id;
        const content = document.createElement('div');
        content.className = 'text';
        content.setAttribute('dir', 'ltr');
        content.innerHTML = '<em>Сообщение удалено</em>';
        div.appendChild(content);
        return div;
    }

    const div = document.createElement('div');
    div.className = `message ${msg.user_id === currentUserId ? 'sent' : 'received'}`;
    div.dataset.msgId = msg.id;

    if (msg.username && msg.user_id !== currentUserId) {
        const author = document.createElement('div');
        author.className = 'author';
        author.textContent = msg.username;
        div.appendChild(author);
    }

    const content = document.createElement('div');
    content.className = 'text';
    content.setAttribute('dir', 'ltr');

    if (msg.text) {
        const useMarkdown = localStorage.getItem('markdown') === 'true';
        if (useMarkdown) {
            const { marked } = await import('https://cdn.jsdelivr.net/npm/marked/lib/marked.esm.js');
            content.innerHTML = marked.parse(msg.text);
        } else {
            content.textContent = msg.text;
        }
    }

    if (msg.file_url) {
        const fileDiv = document.createElement('div');
        fileDiv.className = 'file';

        const fileName = getFileNameFromUrl(msg.file_url);
        const fileIcon = getFileIcon(msg.file_type, fileName);

        if (msg.file_type === 'image') {
            const autoSetting = getImagePreviewSetting();
            const shouldShowPreview = autoSetting === 'always' || (autoSetting === 'wifi' && isWiFi());
            if (shouldShowPreview) {
                const img = document.createElement('img');
                img.src = msg.file_url;
                img.alt = fileName;
                img.loading = 'lazy';
                fileDiv.appendChild(img);
            } else {
                const downloadLink = document.createElement('a');
                downloadLink.href = msg.file_url;
                downloadLink.download = fileName;
                downloadLink.className = 'file-download-link';
                downloadLink.innerHTML = `<i class="fas ${fileIcon}"></i> ${fileName} <i class="fas fa-download"></i>`;
                fileDiv.appendChild(downloadLink);
            }
            const caption = document.createElement('div');
            caption.className = 'file-caption';
            caption.innerHTML = `<i class="fas ${fileIcon}"></i> ${fileName}`;
            fileDiv.appendChild(caption);
        } else if (msg.file_type === 'audio') {
            const { createAudioPlayer } = await getAudioPlayer();
            const audioContainer = createAudioPlayer(msg.file_url, msg.id);
            fileDiv.appendChild(audioContainer);
            const caption = document.createElement('div');
            caption.className = 'file-caption';
            caption.innerHTML = `<i class="fas ${fileIcon}"></i> ${fileName}`;
            fileDiv.appendChild(caption);
            div.audioCleanup = () => audioContainer.cleanup();
        } else {
            const downloadLink = document.createElement('a');
            downloadLink.href = msg.file_url;
            downloadLink.download = fileName;
            downloadLink.className = 'file-download-link';
            downloadLink.innerHTML = `<i class="fas ${fileIcon}"></i> ${fileName} <i class="fas fa-download"></i>`;
            fileDiv.appendChild(downloadLink);
        }
        content.appendChild(fileDiv);
    }

    div.appendChild(content);

    if (msg.user_id === currentUserId && !msg.is_deleted && window.innerWidth > 768) {
        const actions = document.createElement('div');
        actions.className = 'message-actions';
        const editBtn = document.createElement('button');
        editBtn.innerHTML = '<i class="fas fa-edit"></i>';
        editBtn.onclick = (e) => {
            e.stopPropagation();
            const newText = prompt('Редактировать сообщение:', msg.text);
            if (newText) editMessage(msg.id, newText);
        };
        const deleteBtn = document.createElement('button');
        deleteBtn.innerHTML = '<i class="fas fa-trash"></i>';
        deleteBtn.onclick = (e) => {
            e.stopPropagation();
            if (confirm('Удалить сообщение?')) deleteMessage(msg.id);
        };
        actions.appendChild(editBtn);
        actions.appendChild(deleteBtn);
        div.appendChild(actions);
    }

    if (msg.edited_at) {
        div.addEventListener('click', async (e) => {
            if (e.target.closest('.message-actions')) return;
            const resp = await fetch(`/api/message_history/${msg.id}`, { headers: { 'Authorization': `Bearer ${token}` } });
            const history = await resp.json();
            if (history.length) {
                let historyText = 'История изменений:\n';
                history.forEach(h => historyText += `${new Date(h.edited_at).toLocaleString()}: ${h.old_text}\n`);
                alert(historyText);
            }
        });
    }

    return div;
}

export async function displayMessage(msg, prepend = false) {
    const msgElement = await createMessageElement(msg);
    if (prepend) {
        messagesArea.insertBefore(msgElement, messagesArea.firstChild);
    } else {
        messagesArea.appendChild(msgElement);
        requestAnimationFrame(() => msgElement.scrollIntoView({ behavior: 'smooth' }));
    }
}

export async function sendMessageWithFiles() {
    if (isSending) return;
    const text = messageText.value.trim();
    if ((!text && selectedFiles.length === 0) || !currentChatId) return;

    isSending = true;
    setSendButtonLoading(true);

    try {
        if (selectedFiles.length) {
            await sendMultipleFiles(selectedFiles);
            selectedFiles = [];
            updateFilePreview();
        }
        if (text) {
            sendWebSocketMessage({ type: 'message', chat_id: currentChatId, text });
            messageText.value = '';
        }
    } finally {
        isSending = false;
        setSendButtonLoading(false);
    }
}

async function sendMultipleFiles(files) {
    for (const file of files) {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('token', token);
        const resp = await fetch('/api/upload', { method: 'POST', body: formData });
        const data = await resp.json();
        if (resp.ok) {
            sendWebSocketMessage({ type: 'file', chat_id: currentChatId, file_url: data.file_url, file_type: data.file_type });
        }
        await new Promise(r => setTimeout(r, 200));
    }
}

export function handleFileSelection(e) {
    const files = Array.from(e.target.files);
    if (files.length) {
        selectedFiles.push(...files);
        updateFilePreview();
    }
    e.target.value = '';
}

function updateFilePreview() {
    filePreviewDiv.innerHTML = '';
    selectedFiles.forEach((file, index) => {
        const div = document.createElement('div');
        div.className = 'file-preview-item';
        if (file.type.startsWith('image/')) {
            const img = document.createElement('img');
            img.src = URL.createObjectURL(file);
            div.appendChild(img);
        } else {
            const icon = document.createElement('i');
            icon.className = 'fas fa-file';
            div.appendChild(icon);
        }
        const removeBtn = document.createElement('button');
        removeBtn.innerHTML = '×';
        removeBtn.className = 'remove-file';
        removeBtn.onclick = () => {
            selectedFiles.splice(index, 1);
            updateFilePreview();
        };
        div.appendChild(removeBtn);
        filePreviewDiv.appendChild(div);
    });
}

export async function editMessage(msgId, newText) {
    sendWebSocketMessage({ type: 'edit', message_id: msgId, text: newText });
}

export async function deleteMessage(msgId) {
    const msgElement = document.querySelector(`.message[data-msg-id="${msgId}"]`);
    if (msgElement && msgElement.audioCleanup) {
        msgElement.audioCleanup();
    }
    sendWebSocketMessage({ type: 'delete', message_id: msgId });
}

export async function deleteChat() {
    if (!currentChatId) return;
    if (!confirm('Удалить этот чат? Все сообщения будут удалены.')) return;
    const resp = await fetch(`/api/chat/${currentChatId}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
    if (resp.ok) {
        setCurrentChatId(null);
        document.getElementById('message-input-area').style.display = 'none';
        document.getElementById('chat-title').textContent = 'Выберите чат';
        messagesArea.innerHTML = '';
        await loadChats();
        document.getElementById('delete-chat-btn').style.display = 'none';
        document.getElementById('search-messages-btn').style.display = 'none';
    }
}

export async function searchMessages(query) {
    if (!currentChatId) return;
    const resp = await fetch(`/api/messages/${currentChatId}/search?q=${encodeURIComponent(query)}`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!await checkAuth(resp)) return;
    const results = await resp.json();
    const resultsDiv = document.getElementById('search-results-list');
    resultsDiv.innerHTML = '';
    results.forEach(msg => {
        const el = document.createElement('div');
        el.className = 'search-result-item';
        el.textContent = msg.text || '(медиа)';
        el.onclick = () => {
            const msgElement = document.querySelector(`.message[data-msg-id="${msg.id}"]`);
            if (msgElement) msgElement.scrollIntoView({ behavior: 'smooth' });
            document.getElementById('search-modal').style.display = 'none';
        };
        resultsDiv.appendChild(el);
    });
}