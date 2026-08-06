import { setToken, token } from './config.js';
import { initApp } from './app.js';

export async function register() {
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    const resp = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
    });
    const data = await resp.json();
    if (resp.ok) alert('Регистрация успешна! Теперь войдите.');
    else alert('Ошибка: ' + (data.detail || 'Неизвестная ошибка'));
}

export async function login() {
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

export function logout() {
    localStorage.removeItem('token');
    window.location.href = '/static/index.html?reload=' + Date.now();
}

export async function checkAuth(resp) {
    if (resp.status === 401) {
        localStorage.removeItem('token');
        alert('Сессия истекла. Пожалуйста, войдите заново.');
        window.location.href = '/static/index.html?reload=' + Date.now();
        return false;
    }
    return true;
}