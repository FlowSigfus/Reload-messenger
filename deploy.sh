#!/bin/bash
# deploy.sh – обновление кода на сервере и перезапуск
SERVER_IP="192.168.1.41"           # IP Orange Pi в локальной сети
SERVER_USER="orangepi"
SERVER_DIR="/home/$SERVER_USER/reload-messenger"

echo "==> Отправка кода в GitHub (если используешь)..."
git push origin main

echo "==> Копируем .env на сервер (перезаписываем)..."
scp .env $SERVER_USER@$SERVER_IP:$SERVER_DIR/

echo "==> Подключаемся к серверу, обновляем код, зависимости и перезапускаем сервис..."
ssh $SERVER_USER@$SERVER_IP << EOF
    set -e
    cd $SERVER_DIR
    git pull origin main
    source venv/bin/activate
    pip install -r requirements.txt
    # Проводим миграции БД (если нужно создание таблиц)
    python -c "from database import Base, engine; Base.metadata.create_all(engine)"
    sudo systemctl daemon-reload
    sudo systemctl restart reload-messenger
    sudo systemctl status reload-messenger --no-pager
EOF

echo "==> Готово! Мессенджер обновлён."