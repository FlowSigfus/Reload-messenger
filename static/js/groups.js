import { token } from './config.js';
import { checkAuth } from './auth.js';
import { loadChats } from './chat.js';

let selectedUsers = [];

export function openGroupModal() {
    document.getElementById('group-modal').style.display = 'flex';
    document.getElementById('group-name').value = '';
    document.getElementById('user-search').value = '';
    document.getElementById('search-results').innerHTML = '';
    document.getElementById('selected-users-list').innerHTML = '';
    selectedUsers = [];
}

export async function searchUsers() {
    const query = document.getElementById('user-search').value.trim();
    if (query.length < 2) {
        document.getElementById('search-results').innerHTML = '';
        return;
    }
    const resp = await fetch(`/api/users/search?q=${encodeURIComponent(query)}`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!await checkAuth(resp)) return;
    const users = await resp.json();
    const resultsDiv = document.getElementById('search-results');
    resultsDiv.innerHTML = '';
    users.forEach(user => {
        if (!selectedUsers.some(u => u.id === user.id)) {
            const div = document.createElement('div');
            div.className = 'search-result-item';
            div.textContent = user.username;
            const addBtn = document.createElement('button');
            addBtn.textContent = 'Добавить';
            addBtn.className = 'add-user-btn';
            addBtn.onclick = () => addUserToGroup(user);
            div.appendChild(addBtn);
            resultsDiv.appendChild(div);
        }
    });
}

function addUserToGroup(user) {
    selectedUsers.push(user);
    renderSelectedUsers();
    document.getElementById('user-search').value = '';
    document.getElementById('search-results').innerHTML = '';
}

function renderSelectedUsers() {
    const container = document.getElementById('selected-users-list');
    container.innerHTML = '';
    selectedUsers.forEach(user => {
        const tag = document.createElement('div');
        tag.className = 'selected-user-tag';
        tag.textContent = user.username;
        const remove = document.createElement('span');
        remove.textContent = '×';
        remove.className = 'remove-user';
        remove.onclick = () => {
            selectedUsers = selectedUsers.filter(u => u.id !== user.id);
            renderSelectedUsers();
        };
        tag.appendChild(remove);
        container.appendChild(tag);
    });
}

export async function createGroup() {
    const name = document.getElementById('group-name').value.trim();
    if (!name) {
        alert('Введите название группы');
        return;
    }
    const memberUsernames = selectedUsers.map(u => u.username);
    const resp = await fetch('/api/groups', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, member_usernames: memberUsernames })
    });
    if (!await checkAuth(resp)) return;
    if (resp.ok) {
        document.getElementById('group-modal').style.display = 'none';
        await loadChats();
    } else {
        alert('Ошибка создания группы');
    }
}