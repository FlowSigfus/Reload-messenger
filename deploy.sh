#!/bin/bash
# deploy.sh — коммит + push + деплой с проверками на каждом шаге

set -euo pipefail

SERVER_IP="192.168.1.41"
SERVER_USER="orangepi"
SERVER_DIR="/home/${SERVER_USER}/Reload-messenger"
BRANCH="main"

cd "$(dirname "$0")"

# ---------- 0. Мы в git-репе? ----------
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    echo "❌ Не git-репозиторий. Запусти из папки проекта."
    exit 1
fi

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [ "$CURRENT_BRANCH" != "$BRANCH" ]; then
    echo "❌ Сейчас ты на ветке '$CURRENT_BRANCH', а деплой идёт с '$BRANCH'."
    echo "   Переключись: git checkout $BRANCH"
    exit 1
fi

# ---------- 1. Показать состояние ----------
echo "==> git status"
git status --short || true

# ---------- 2. Коммит ----------
if [ -n "$(git status --porcelain)" ]; then
    echo ""
    echo "==> Есть незакоммиченные изменения. Сообщение коммита (пусто = отмена):"
    read -r COMMIT_MSG
    if [ -z "$COMMIT_MSG" ]; then
        echo "❌ Отменено пользователем."
        exit 1
    fi
    git add -A
    git commit -m "$COMMIT_MSG"
else
    echo "==> Локальных изменений нет, коммит не нужен."
fi

# ---------- 3. Push ----------
echo ""
echo "==> git push origin $BRANCH"
git push origin "$BRANCH"

# Проверка, что удалённая ветка действительно совпадает с локальной
LOCAL_SHA="$(git rev-parse "$BRANCH")"
REMOTE_SHA="$(git ls-remote origin "refs/heads/$BRANCH" | awk '{print $1}')"
if [ "$LOCAL_SHA" != "$REMOTE_SHA" ]; then
    echo "❌ Push не применился: local=$LOCAL_SHA remote=$REMOTE_SHA"
    exit 1
fi
echo "==> ✅ GitHub обновлён: $LOCAL_SHA"

# ---------- 4. Проверка .env ----------
if [ ! -f .env ]; then
    echo "❌ .env не найден локально — нечего копировать на сервер."
    exit 1
fi

# ---------- 5. Связь с сервером ----------
echo ""
echo "==> Проверка связи с $SERVER_USER@$SERVER_IP"
if ! ssh -o ConnectTimeout=5 -o BatchMode=yes "$SERVER_USER@$SERVER_IP" 'echo ok' >/dev/null 2>&1; then
    echo "❌ Не могу достучаться до сервера по SSH."
    echo "   Проверь: ping $SERVER_IP; ssh $SERVER_USER@$SERVER_IP"
    exit 1
fi

# ---------- 6. scp .env ----------
echo "==> scp .env"
scp -q .env "$SERVER_USER@$SERVER_IP:$SERVER_DIR/.env"

# ---------- 7. Обновление на сервере ----------
echo ""
echo "==> Деплой на сервере"
ssh "$SERVER_USER@$SERVER_IP" \
    SERVER_DIR="$SERVER_DIR" \
    BRANCH="$BRANCH" \
    bash -s << 'EOF_REMOTE'
set -euo pipefail

cd "$SERVER_DIR"

echo "--- git status"
git status --short || true

# Если есть локальные правки — не трогаем, ты рискуешь их потерять
if [ -n "$(git status --porcelain)" ]; then
    echo "⚠️  На сервере есть незакоммиченные изменения:"
    git status --short
    echo "❌ Прерываю. Разберись вручную (git stash / git reset), потом запусти деплой снова."
    exit 1
fi

echo "--- git fetch + reset --hard origin/$BRANCH"
git fetch --prune origin
git reset --hard "origin/$BRANCH"

echo "--- git log"
git log --oneline -3

echo "--- venv + pip install"
if [ ! -d venv ]; then
    python3 -m venv venv
fi
# shellcheck disable=SC1091
source venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt

echo "--- миграция БД (ensure_columns из database.py)"
python -c "import database"

echo "--- restart systemd"
sudo systemctl daemon-reload
sudo systemctl restart reload-messenger

echo "--- ждём 2 секунды и проверяем статус"
sleep 2
if sudo systemctl is-active --quiet reload-messenger; then
    echo "✅ reload-messenger активен"
    sudo systemctl --no-pager status reload-messenger | head -n 12 || true
else
    echo "❌ reload-messenger не поднялся. Логи:"
    sudo journalctl -u reload-messenger -n 50 --no-pager || true
    exit 1
fi
EOF_REMOTE

echo ""
echo "==> ✅ Готово. Деплой завершён."
