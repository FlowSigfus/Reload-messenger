#!/bin/bash
# backup.sh – скачиваем дамп БД и загруженные файлы с сервера
SERVER_IP="192.168.1.41"
SERVER_USER="orangepi"
SERVER_DIR="/home/$SERVER_USER/reload-messenger"
LOCAL_DIR="/home/mikhail/reload-messenger-backup/$(date +%Y%m%d_%H%M%S)"

mkdir -p $LOCAL_DIR

echo "==> Создаём дамп базы данных PostgreSQL на сервере и скачиваем..."
ssh $SERVER_USER@$SERVER_IP "pg_dump -U messenger_user messenger > /tmp/messenger_dump.sql"
scp $SERVER_USER@$SERVER_IP:/tmp/messenger_dump.sql $LOCAL_DIR/messenger_dump.sql
ssh $SERVER_USER@$SERVER_IP "rm /tmp/messenger_dump.sql"

echo "==> Скачиваем папку uploads (аватарки и файлы)..."
scp -r $SERVER_USER@$SERVER_IP:$SERVER_DIR/uploads $LOCAL_DIR/

echo "==> Бэкап завершён. Данные сохранены в $LOCAL_DIR"