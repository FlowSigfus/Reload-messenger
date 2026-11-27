import os
from datetime import datetime
from sqlalchemy import (
    create_engine, Column, Integer, String, DateTime, ForeignKey,
    Boolean, Text, Index, inspect, text
)
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, relationship
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./messenger.db")
engine = create_engine(DATABASE_URL, pool_size=10, max_overflow=20)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()
print("Using DATABASE_URL:", DATABASE_URL)


class User(Base):
    __tablename__ = 'users'
    id = Column(Integer, primary_key=True)
    username = Column(String(50), unique=True, nullable=False, index=True)
    password_hash = Column(String(128), nullable=False)
    email = Column(String(120), unique=True, nullable=True, index=True)
    first_name = Column(String(50), nullable=True)
    last_name = Column(String(50), nullable=True)
    nickname = Column(String(50), unique=True, nullable=True)
    birth_year = Column(Integer, nullable=True)
    avatar_url = Column(String(200), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    # 2FA
    totp_secret = Column(String(64), nullable=True)
    totp_enabled = Column(Boolean, default=False)
    email_otp_enabled = Column(Boolean, default=False)

    messages = relationship('Message', back_populates='author', foreign_keys='Message.user_id')
    chat_members = relationship('ChatMember', back_populates='user')
    push_subscriptions = relationship('PushSubscription', back_populates='user')


class Chat(Base):
    __tablename__ = 'chats'
    id = Column(Integer, primary_key=True)
    name = Column(String(100), nullable=True)
    is_group = Column(Boolean, default=False)
    owner_id = Column(Integer, ForeignKey('users.id'), nullable=True)
    avatar_url = Column(String(200), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    members = relationship('ChatMember', back_populates='chat')
    messages = relationship('Message', back_populates='chat')


class ChatMember(Base):
    __tablename__ = 'chat_members'
    id = Column(Integer, primary_key=True)
    chat_id = Column(Integer, ForeignKey('chats.id'), index=True)
    user_id = Column(Integer, ForeignKey('users.id'), index=True)
    role = Column(String(20), default='member')
    joined_at = Column(DateTime, default=datetime.utcnow)

    chat = relationship('Chat', back_populates='members')
    user = relationship('User', back_populates='chat_members')


class Message(Base):
    __tablename__ = 'messages'
    id = Column(Integer, primary_key=True)
    chat_id = Column(Integer, ForeignKey('chats.id'), index=True)
    user_id = Column(Integer, ForeignKey('users.id'), index=True)
    text = Column(Text, nullable=True)
    file_url = Column(String(200), nullable=True)
    file_type = Column(String(50), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    edited_at = Column(DateTime, nullable=True)
    is_deleted = Column(Boolean, default=False)

    chat = relationship('Chat', back_populates='messages')
    author = relationship('User', back_populates='messages', foreign_keys=[user_id])
    reads = relationship('MessageRead', back_populates='message', cascade='all, delete-orphan')


class MessageRead(Base):
    __tablename__ = 'message_reads'
    id = Column(Integer, primary_key=True)
    message_id = Column(Integer, ForeignKey('messages.id'), index=True)
    user_id = Column(Integer, ForeignKey('users.id'), index=True)
    read_at = Column(DateTime, nullable=True)

    message = relationship('Message', back_populates='reads')
    user = relationship('User')


class PushSubscription(Base):
    __tablename__ = 'push_subscriptions'
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey('users.id'), index=True)
    endpoint = Column(String(500), nullable=False)
    p256dh = Column(String(200), nullable=False)
    auth = Column(String(200), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship('User', back_populates='push_subscriptions')


class MessageHistory(Base):
    __tablename__ = 'message_history'
    id = Column(Integer, primary_key=True)
    message_id = Column(Integer, ForeignKey('messages.id'), index=True)
    old_text = Column(Text)
    edited_at = Column(DateTime, default=datetime.utcnow)


class ConnectionLog(Base):
    __tablename__ = 'connection_logs'
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey('users.id'), index=True)
    event_type = Column(String(20))
    reason = Column(String(255))
    timestamp = Column(DateTime, default=datetime.utcnow)


class PasswordResetToken(Base):
    __tablename__ = 'password_reset_tokens'
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey('users.id'), index=True)
    token = Column(String(64), unique=True, nullable=False, index=True)
    expires_at = Column(DateTime, nullable=False)
    used = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)


# ---------- 2FA ----------
class EmailOTPCode(Base):
    """Одноразовые коды на email для 2FA (login / setup)."""
    __tablename__ = 'email_otp_codes'
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey('users.id'), index=True)
    code_hash = Column(String(128), nullable=False)
    purpose = Column(String(20), nullable=False)  # 'login' | 'setup'
    expires_at = Column(DateTime, nullable=False)
    attempts = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)


class BackupCode(Base):
    """Резервные коды (на случай потери TOTP). Хранится хеш."""
    __tablename__ = 'backup_codes'
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey('users.id'), index=True)
    code_hash = Column(String(128), nullable=False)
    used = Column(Boolean, default=False)
    used_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class PreAuthToken(Base):
    """Короткоживущий токен между шагом 1 (пароль) и шагом 2 (2FA)."""
    __tablename__ = 'pre_auth_tokens'
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey('users.id'), index=True)
    token = Column(String(64), unique=True, nullable=False, index=True)
    expires_at = Column(DateTime, nullable=False)
    used = Column(Boolean, default=False)
    attempts = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)


Base.metadata.create_all(engine)


def ensure_columns():
    inspector = inspect(engine)
    with engine.begin() as conn:
        try:
            user_cols = {c['name'] for c in inspector.get_columns('users')}
            if 'email' not in user_cols:
                conn.execute(text("ALTER TABLE users ADD COLUMN email VARCHAR(120)"))
                try:
                    conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS ix_users_email ON users(email)"))
                except Exception as e:
                    print("Index on users.email not created:", e)
                print("✅ Migrated: users.email")
            if 'totp_secret' not in user_cols:
                conn.execute(text("ALTER TABLE users ADD COLUMN totp_secret VARCHAR(64)"))
                print("✅ Migrated: users.totp_secret")
            if 'totp_enabled' not in user_cols:
                conn.execute(text("ALTER TABLE users ADD COLUMN totp_enabled BOOLEAN DEFAULT FALSE"))
                print("✅ Migrated: users.totp_enabled")
            if 'email_otp_enabled' not in user_cols:
                conn.execute(text("ALTER TABLE users ADD COLUMN email_otp_enabled BOOLEAN DEFAULT FALSE"))
                print("✅ Migrated: users.email_otp_enabled")

            chat_cols = {c['name'] for c in inspector.get_columns('chats')}
            if 'owner_id' not in chat_cols:
                conn.execute(text("ALTER TABLE chats ADD COLUMN owner_id INTEGER"))
                print("✅ Migrated: chats.owner_id")
            if 'avatar_url' not in chat_cols:
                conn.execute(text("ALTER TABLE chats ADD COLUMN avatar_url VARCHAR(200)"))
                print("✅ Migrated: chats.avatar_url")

            member_cols = {c['name'] for c in inspector.get_columns('chat_members')}
            if 'role' not in member_cols:
                conn.execute(text("ALTER TABLE chat_members ADD COLUMN role VARCHAR(20) DEFAULT 'member'"))
                print("✅ Migrated: chat_members.role")
        except Exception as e:
            print("Migration warning:", e)


ensure_columns()
