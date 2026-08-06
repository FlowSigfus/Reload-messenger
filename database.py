import os
from datetime import datetime
from sqlalchemy import create_engine, Column, Integer, String, DateTime, ForeignKey, Boolean, Text, Index
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
    first_name = Column(String(50), nullable=True)
    last_name = Column(String(50), nullable=True)
    nickname = Column(String(50), unique=True, nullable=True)
    birth_year = Column(Integer, nullable=True)
    avatar_url = Column(String(200), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    messages = relationship('Message', back_populates='author', foreign_keys='Message.user_id')
    chat_members = relationship('ChatMember', back_populates='user')
    push_subscriptions = relationship('PushSubscription', back_populates='user')

class Chat(Base):
    __tablename__ = 'chats'
    id = Column(Integer, primary_key=True)
    name = Column(String(100), nullable=True)
    is_group = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    members = relationship('ChatMember', back_populates='chat')
    messages = relationship('Message', back_populates='chat')

class ChatMember(Base):
    __tablename__ = 'chat_members'
    id = Column(Integer, primary_key=True)
    chat_id = Column(Integer, ForeignKey('chats.id'), index=True)
    user_id = Column(Integer, ForeignKey('users.id'), index=True)
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
    event_type = Column(String(20))  # 'connect', 'disconnect'
    reason = Column(String(255))
    timestamp = Column(DateTime, default=datetime.utcnow)

# Создание таблиц
Base.metadata.create_all(engine)