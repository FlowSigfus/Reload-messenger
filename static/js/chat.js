import { token, currentChatId, currentUserId, setCurrentChatId } from './config.js';
import { checkAuth } from './auth.js';
import { sendWebSocketMessage } from './websocket.js';
import { closeSidebar, setSendButtonLoading, getImagePreviewSetting, isWiFi } from './ui.js';

export let hasMoreMessages = true;
export let loadingMessages = false;
export let oldestMessageId = null;
export let selectedFiles = [];
export let isSending = false;

const messagesArea = document.getElementById('messages-area');
const filePreviewDiv = document.getElementById('file-preview');
const messageText = document.getElementById('message-text');

const MAX_FILE_SIZE = 100 * 1024 * 1024;

let audioPlayerModule = null;
async function getAudioPlayer() {
    if (!audioPlayerModule) audioPlayerModule = await import('./audioPlayer.js');
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
    return decodeURIComponent(url.split('/').pop() || 'file');
}

function cleanupAudio(root) {
    root.querySelectorAll('.message').forEach(m => m.audioCleanup?.());
}

export async function loadChats() {
    const resp = await fetch('/api/chats', { headers: { 'Authorization': `Bearer ${token}` } });
    if (!await checkAuth(resp)) return;
    if (!resp.ok) return;
    const chats = await resp.json();
    const listDiv = document.getElementById('chats-list');
    const fragment = document.createDocumentFragment();
    for (const chat of chats) fragment.appendChild(createChatElement(chat));
    listDiv.innerHTML = '';
    listDiv.appendChild(fragment);
}

function createChatElement(chat) {
    const div = document.createElement('div');
    div.className = 'chat-item';
    if (chat.id === currentChatId) div.classList.add('active');
    div.dataset.chatId = chat.id;

    const nameStr = chat.is_group ? (chat.name || 'Группа') : (chat.other_user || '?');
    const avatar = document.createElement('div');
    avatar.className = 'chat-avatar';
    avatar.textContent = (nameStr.charAt(0) || '?').toUpperCase();

    const info = document.createElement('div');
    info.className = 'chat-info';
    const name = document.createElement('div');
    name.className = 'chat-name';
    name.textContent = chat.is_group ? (chat.name || 'Группа') : `Чат с ${chat.other_user || '?'}`;
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
    if (!chatItem) {
        loadChats();
        return;
    }
    const lastMsgDiv = chatItem.querySelector('.chat-last-message');
    if (lastMsgDiv) lastMsgDiv.textContent = lastMessage;
    if (hasUnread && chatId !== currentChatId) {
        let unreadSpan = chatItem.querySelector('.chat-unread');
        if (!unreadSpan) {
            unreadSpan = document.createElement('span');
            unreadSpan.className = 'chat-unread';
            unreadSpan.textContent = '0';
            chatItem.appendChild(unreadSpan);
        }
        const cur = parseInt(unreadSpan.textContent) || 0;
        unreadSpan.textContent = cur + 1;
    }
}

export async function selectChat(chatId) {
    setCurrentChatId(chatId);
    cleanupAudio(messagesArea);
    messagesArea.innerHTML = '';
    document.getElementById('message-input-area').style.display = 'flex';
    hasMoreMessages = true;
    loadingMessages = false;
    oldestMessageId = null;

    await loadLatestMessages(chatId);
    if (currentChatId !== chatId) return;

    markRead(chatId);

    document.querySelectorAll('.chat-item').forEach(el => el.classList.remove('active'));
    const activeChat = document.querySelector(`.chat-item[data-chat-id="${chatId}"]`);
    if (activeChat) {
        activeChat.classList.add('active');
        document.getElementById('chat-title').textContent = activeChat.querySelector('.chat-name').textContent;
    } else {
        document.getElementById('chat-title').textContent = 'Чат';
    }

    document.getElementById('delete-chat-btn').style.display = 'inline-block';
    document.getElementById('search-messages-btn').style.display = 'inline-block';
    document.getElementById('export-chat-btn').style.display = 'inline-block';

    if (window.matchMedia('(max-width: 768px)').matches) {
        document.body.classList.add('chat-open');
    } else {
        closeSidebar();
    }
}

export async function loadLatestMessages(expectedChatId = currentChatId) {
    if (!expectedChatId || loadingMessages) return;
    loadingMessages = true;
    hasMoreMessages = true;
    oldestMessageId = null;

    try {
        const limit = window.matchMedia('(max-width: 768px)').matches ? 10 : 20;
        const resp = await fetch(`/api/messages/${expectedChatId}?limit=${limit}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!await checkAuth(resp)) return;
        if (currentChatId !== expectedChatId) return;
        const messages = await resp.json();
        if (currentChatId !== expectedChatId) return;

        if (messages.length === 0) { hasMoreMessages = false; return; }
        oldestMessageId = messages[0].id;

        const fragment = document.createDocumentFragment();
        for (const msg of messages) fragment.appendChild(await createMessageElement(msg));
        messagesArea.appendChild(fragment);

        requestAnimationFrame(() => { messagesArea.scrollTop = messagesArea.scrollHeight; });
        if (messages.length < limit) hasMoreMessages = false;
    } catch (e) {
        console.error('loadLatestMessages:', e);
    } finally {
        loadingMessages = false;
    }
}

export async function loadMoreMessages() {
    if (!currentChatId || loadingMessages || !hasMoreMessages || !oldestMessageId) return;
    loadingMessages = true;
    const expectedChatId = currentChatId;

    try {
        const resp = await fetch(`/api/messages/${expectedChatId}?limit=20&before=${oldestMessageId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!await checkAuth(resp)) return;
        if (currentChatId !== expectedChatId) return;
        const messages = await resp.json();
        if (currentChatId !== expectedChatId) return;

        if (messages.length === 0) { hasMoreMessages = false; return; }

        const oldH = messagesArea.scrollHeight;
        const oldT = messagesArea.scrollTop;
        const fragment = document.createDocumentFragment();
        for (const msg of messages) fragment.appendChild(await createMessageElement(msg));
        messagesArea.insertBefore(fragment, messagesArea.firstChild);
        oldestMessageId = messages[0].id;

        const newH = messagesArea.scrollHeight;
        messagesArea.scrollTop = oldT + (newH - oldH);
        if (messages.length < 20) hasMoreMessages = false;
    } catch (e) {
        console.error('loadMoreMessages:', e);
    } finally {
        loadingMessages = false;
    }
}

export async function markRead(chatId) {
    const resp = await fetch(`/api/mark_read/${chatId}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
    });
    await checkAuth(resp);
    const unreadSpan = document.querySelector(`.chat-item[data-chat-id="${chatId}"] .chat-unread`);
    if (unreadSpan) unreadSpan.remove();
}

async function createMessageElement(msg) {
    const div = document.createElement('div');
    div.className = `message ${msg.user_id === currentUserId ? 'sent' : 'received'}`;
    div.dataset.msgId = msg.id;

    if (msg.is_deleted) {
        div.dataset.deleted = '1';
        const content = document.createElement('div');
        content.className = 'text';
        const inner = document.createElement('em');
        inner.textContent = 'Сообщение удалено';
        content.appendChild(inner);
        div.appendChild(content);
        return div;
    }

    if (msg.username && msg.user_id !== currentUserId) {
        const author = document.createElement('div');
        author.className = 'author';
        author.textContent = msg.username;
        div.appendChild(author);
    }

    const content = document.createElement('div');
    content.className = 'text';

    const textBody = document.createElement('div');
    textBody.className = 'text-body';
    textBody.setAttribute('dir', 'ltr');
    if (msg.text) {
        if (localStorage.getItem('markdown') === 'true') {
            try {
                const { marked } = await import('https://cdn.jsdelivr.net/npm/marked/lib/marked.esm.js');
                const dirty = marked.parse(msg.text);
                textBody.innerHTML = window.DOMPurify ? window.DOMPurify.sanitize(dirty) : msg.text;
            } catch {
                textBody.textContent = msg.text;
            }
        } else {
            textBody.textContent = msg.text;
        }
    }
    content.appendChild(textBody);

    if (msg.file_url) {
        const fileDiv = document.createElement('div');
        fileDiv.className = 'file';
        const fileName = getFileNameFromUrl(msg.file_url);
        const fileIcon = getFileIcon(msg.file_type, fileName);

        if (msg.file_type === 'image') {
            const setting = getImagePreviewSetting();
            const show = setting === 'always' || (setting === 'wifi' && isWiFi());
            if (show) {
                const img = document.createElement('img');
                img.src = msg.file_url;
                img.alt = fileName;
                img.loading = 'lazy';
                fileDiv.appendChild(img);
            } else {
                fileDiv.appendChild(makeFileLink(msg.file_url, fileName, fileIcon));
            }
            const caption = document.createElement('div');
            caption.className = 'file-caption';
            const capIcon = document.createElement('i');
            capIcon.className = `fas ${fileIcon}`;
            caption.appendChild(capIcon);
            caption.appendChild(document.createTextNode(' ' + fileName));
            fileDiv.appendChild(caption);
        } else if (msg.file_type === 'audio') {
            const { createAudioPlayer } = await getAudioPlayer();
            const player = createAudioPlayer(msg.file_url, msg.id);
            fileDiv.appendChild(player);
            const caption = document.createElement('div');
            caption.className = 'file-caption';
            const capIcon = document.createElement('i');
            capIcon.className = `fas ${fileIcon}`;
            caption.appendChild(capIcon);
            caption.appendChild(document.createTextNode(' ' + fileName));
            fileDiv.appendChild(caption);
            div.audioCleanup = () => player.cleanup();
        } else {
            fileDiv.appendChild(makeFileLink(msg.file_url, fileName, fileIcon));
        }
        content.appendChild(fileDiv);
    }

    div.appendChild(content);

    if (msg.user_id === currentUserId && window.innerWidth > 768) {
        const actions = document.createElement('div');
        actions.className = 'message-actions';
        const editBtn = document.createElement('button');
        editBtn.innerHTML = '<i class="fas fa-edit"></i>';
        editBtn.onclick = (e) => {
            e.stopPropagation();
            const newText = prompt('Редактировать сообщение:', msg.text || '');
            if (newText !== null && newText !== msg.text) editMessage(msg.id, newText);
        };
            const delBtn = document.createElement('button');
            delBtn.innerHTML = '<i class="fas fa-trash"></i>';
            delBtn.onclick = (e) => {
                e.stopPropagation();
                if (confirm('Удалить сообщение?')) deleteMessage(msg.id);
            };
                actions.appendChild(editBtn);
                actions.appendChild(delBtn);
                div.appendChild(actions);
    }

    if (msg.edited_at) {
        textBody.style.cursor = 'pointer';
        textBody.title = 'Показать историю изменений';
        textBody.addEventListener('click', async () => {
            const resp = await fetch(`/api/message_history/${msg.id}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!resp.ok) return;
            const history = await resp.json();
            if (history.length) {
                let text = 'История изменений:\n';
                history.forEach(h => { text += `${new Date(h.edited_at).toLocaleString()}: ${h.old_text}\n`; });
                alert(text);
            }
        });
    }

    return div;
}

function makeFileLink(url, fileName, fileIcon) {
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.className = 'file-download-link';
    const icon = document.createElement('i');
    icon.className = `fas ${fileIcon}`;
    a.appendChild(icon);
    a.appendChild(document.createTextNode(' ' + fileName + ' '));
    const dl = document.createElement('i');
    dl.className = 'fas fa-download';
    a.appendChild(dl);
    return a;
}

export async function displayMessage(msg) {
    const el = await createMessageElement(msg);
    const nearBottom = (messagesArea.scrollHeight - messagesArea.scrollTop - messagesArea.clientHeight) < 120;
    messagesArea.appendChild(el);
    if (nearBottom) requestAnimationFrame(() => { messagesArea.scrollTop = messagesArea.scrollHeight; });
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
            const ok = sendWebSocketMessage({ type: 'message', chat_id: currentChatId, text });
            if (ok) messageText.value = '';
            else alert('Нет соединения. Попробуйте ещё раз.');
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
        const data = await resp.json().catch(() => ({}));
        if (resp.ok) {
            sendWebSocketMessage({
                type: 'file',
                chat_id: currentChatId,
                file_url: data.file_url,
                file_type: data.file_type
            });
        }
        await new Promise(r => setTimeout(r, 200));
    }
}

export function handleFileSelection(e) {
    const files = Array.from(e.target.files);
    for (const file of files) {
        if (file.size > MAX_FILE_SIZE) {
            alert(`${file.name} больше 100 МБ`);
            continue;
        }
        selectedFiles.push(file);
    }
    updateFilePreview();
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
    const el = document.querySelector(`.message[data-msg-id="${msgId}"]`);
    el?.audioCleanup?.();
    sendWebSocketMessage({ type: 'delete', message_id: msgId });
}

export async function deleteChat() {
    if (!currentChatId) return;
    if (!confirm('Удалить этот чат? Все сообщения будут удалены.')) return;
    const resp = await fetch(`/api/chat/${currentChatId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
    });
    if (resp.ok) {
        cleanupAudio(messagesArea);
        setCurrentChatId(null);
        document.getElementById('message-input-area').style.display = 'none';
        document.getElementById('chat-title').textContent = 'Выберите чат';
        messagesArea.innerHTML = '';
        await loadChats();
        ['delete-chat-btn', 'search-messages-btn', 'export-chat-btn'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });
    } else if (resp.status === 403) {
        alert('Удалить группу может только её создатель');
    }
}

export async function searchMessages(query) {
    if (!currentChatId) return;
    const resp = await fetch(
        `/api/messages/${currentChatId}/search?q=${encodeURIComponent(query)}`,
                             { headers: { 'Authorization': `Bearer ${token}` } }
    );
    if (!await checkAuth(resp)) return;
    const results = await resp.json();
    const list = document.getElementById('search-results-list');
    list.innerHTML = '';
    results.forEach(msg => {
        const el = document.createElement('div');
        el.className = 'search-result-item';
        el.textContent = msg.text || '(медиа)';
        el.onclick = () => {
            const target = document.querySelector(`.message[data-msg-id="${msg.id}"]`);
            if (target) target.scrollIntoView({ behavior: 'smooth' });
            document.getElementById('search-modal').style.display = 'none';
        };
        list.appendChild(el);
    });
}
