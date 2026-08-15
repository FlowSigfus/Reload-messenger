import os
import shutil
import uuid
import asyncio
from datetime import datetime, timedelta
from typing import List, Optional
from collections import defaultdict

from fastapi import FastAPI, HTTPException, Depends, UploadFile, File, Form, WebSocket, WebSocketDisconnect, Header, BackgroundTasks
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, RedirectResponse
from sqlalchemy.orm import Session
from sqlalchemy import select, or_, and_
from pydantic import BaseModel

from database import SessionLocal, User, Chat, ChatMember, Message, MessageRead, PushSubscription, MessageHistory, ConnectionLog
from auth import verify_password, get_password_hash, create_access_token, decode_token
from websocket_manager import manager
from push_utils import send_push_notification
from dotenv import load_dotenv
from weasyprint import HTML
import tempfile

load_dotenv()

app = FastAPI()

app.mount("/static", StaticFiles(directory="static"), name="static")

UPLOAD_DIR = os.getenv("UPLOAD_DIR", "uploads")
EXPORT_DIR = os.getenv("EXPORT_DIR", "exports")

os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(EXPORT_DIR, exist_ok=True)

app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")

@app.get("/")
async def root():
    return RedirectResponse(url="/static/index.html")

# ---------- Pydantic модели ----------
class UserCreate(BaseModel):
    username: str
    password: str
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    nickname: Optional[str] = None
    birth_year: Optional[int] = None

class UserUpdate(BaseModel):
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    nickname: Optional[str] = None
    birth_year: Optional[int] = None

class UserLogin(BaseModel):
    username: str
    password: str

class ChatOut(BaseModel):
    id: int
    name: Optional[str]
    is_group: bool
    other_user: Optional[str]
    last_message: Optional[str]
    unread_count: int = 0

class MessageOut(BaseModel):
    id: int
    user_id: int
    username: str
    text: Optional[str]
    file_url: Optional[str]
    file_type: Optional[str]
    created_at: str
    edited_at: Optional[str] = None
    is_deleted: bool = False

class GroupCreate(BaseModel):
    name: str
    member_usernames: List[str]

class PushSubscriptionIn(BaseModel):
    endpoint: str
    keys: dict

class MessageHistoryOut(BaseModel):
    old_text: str
    edited_at: str

# ---------- Dependency ----------
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

async def get_current_user(token: str = Header(..., alias="Authorization"), db: Session = Depends(get_db)):
    if not token.startswith("Bearer "):
        raise HTTPException(401, "Invalid token format")
    token_str = token.split(" ")[1]
    payload = decode_token(token_str)
    if not payload:
        raise HTTPException(401, "Invalid token")
    user_id = int(payload["sub"])
    user = db.query(User).get(user_id)
    if not user:
        raise HTTPException(404, "User not found")
    return user

# ---------- Auth ----------
@app.post("/api/register")
def register(user: UserCreate, db: Session = Depends(get_db)):
    if db.query(User).filter(User.username == user.username).first():
        raise HTTPException(400, "Username already exists")
    if user.nickname and db.query(User).filter(User.nickname == user.nickname).first():
        raise HTTPException(400, "Nickname already exists")
    hashed = get_password_hash(user.password)
    new_user = User(
        username=user.username,
        password_hash=hashed,
        first_name=user.first_name,
        last_name=user.last_name,
        nickname=user.nickname,
        birth_year=user.birth_year
    )
    db.add(new_user)
    db.commit()
    return {"message": "User created"}

@app.post("/api/login")
def login(user: UserLogin, db: Session = Depends(get_db)):
    db_user = db.query(User).filter(User.username == user.username).first()
    if not db_user or not verify_password(user.password, db_user.password_hash):
        raise HTTPException(401, "Invalid credentials")
    token = create_access_token({"sub": str(db_user.id)})
    return {"access_token": token, "token_type": "bearer"}

@app.get("/api/user/me")
def get_me(current_user: User = Depends(get_current_user)):
    return {
        "id": current_user.id,
        "username": current_user.username,
        "first_name": current_user.first_name,
        "last_name": current_user.last_name,
        "nickname": current_user.nickname,
        "birth_year": current_user.birth_year,
        "created_at": current_user.created_at.isoformat(),
        "avatar_url": current_user.avatar_url
    }

@app.put("/api/user/me")
def update_me(update: UserUpdate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if update.nickname and db.query(User).filter(User.nickname == update.nickname, User.id != current_user.id).first():
        raise HTTPException(400, "Nickname already taken")
    for key, value in update.dict(exclude_unset=True).items():
        setattr(current_user, key, value)
    if update.nickname == "":
        update.nickname = None
    db.commit()
    return {"message": "Profile updated"}

@app.post("/api/upload_avatar")
async def upload_avatar(file: UploadFile = File(...), current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    ext = os.path.splitext(file.filename)[1]
    filename = f"avatar_{current_user.id}_{uuid.uuid4().hex}{ext}"
    filepath = os.path.join(UPLOAD_DIR, filename)
    with open(filepath, "wb") as f:
        shutil.copyfileobj(file.file, f)
    if current_user.avatar_url:
        old_path = os.path.join(UPLOAD_DIR, os.path.basename(current_user.avatar_url))
        if os.path.exists(old_path):
            os.remove(old_path)
    current_user.avatar_url = f"/uploads/{filename}"
    db.commit()
    return {"avatar_url": current_user.avatar_url}

# ---------- Chats ----------
@app.get("/api/chats", response_model=List[ChatOut])
def get_chats(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    chats = db.query(Chat).join(ChatMember).filter(ChatMember.user_id == current_user.id).all()
    result = []
    for chat in chats:
        chat_out = ChatOut(
            id=chat.id,
            name=chat.name,
            is_group=chat.is_group,
            other_user=None,
            last_message=None,
            unread_count=0
        )
        if not chat.is_group:
            other_member = db.query(ChatMember).filter(
                ChatMember.chat_id == chat.id,
                ChatMember.user_id != current_user.id
            ).first()
            if other_member:
                other_user = db.query(User).get(other_member.user_id)
                chat_out.other_user = other_user.username
        last_msg = db.query(Message).filter(Message.chat_id == chat.id).order_by(Message.created_at.desc()).first()
        chat_out.last_message = last_msg.text if last_msg else None
        unread = db.query(MessageRead).join(Message).filter(
            Message.chat_id == chat.id,
            MessageRead.user_id == current_user.id,
            MessageRead.read_at.is_(None)
        ).count()
        chat_out.unread_count = unread
        result.append(chat_out)
    return result

@app.get("/api/messages/{chat_id}", response_model=List[MessageOut])
def get_messages(
    chat_id: int,
    before: Optional[int] = None,
    limit: int = 30,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    member = db.query(ChatMember).filter(ChatMember.chat_id == chat_id, ChatMember.user_id == current_user.id).first()
    if not member:
        raise HTTPException(403, "Not a member")

    query = db.query(Message).filter(Message.chat_id == chat_id)
    if before:
        query = query.filter(Message.id < before)
    messages = query.order_by(Message.id.desc()).limit(limit).all()
    messages.reverse()
    result = []
    for msg in messages:
        author = db.query(User).get(msg.user_id)
        result.append(MessageOut(
            id=msg.id,
            user_id=msg.user_id,
            username=author.username,
            text=msg.text if not msg.is_deleted else None,
            file_url=msg.file_url if not msg.is_deleted else None,
            file_type=msg.file_type if not msg.is_deleted else None,
            created_at=msg.created_at.isoformat(),
            edited_at=msg.edited_at.isoformat() if msg.edited_at else None,
            is_deleted=msg.is_deleted
        ))
    return result

@app.post("/api/groups")
def create_group(group: GroupCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    members = []
    for username in group.member_usernames:
        user = db.query(User).filter(User.username == username).first()
        if not user:
            raise HTTPException(400, f"User {username} not found")
        members.append(user)
    if current_user not in members:
        members.append(current_user)

    chat = Chat(name=group.name, is_group=True)
    db.add(chat)
    db.flush()
    for user in members:
        db.add(ChatMember(chat_id=chat.id, user_id=user.id))
    db.commit()
    return {"id": chat.id, "name": chat.name}

def is_admin(user_id: int, chat_id: int, db: Session) -> bool:
    chat = db.query(Chat).get(chat_id)
    if chat and chat.owner_id == user_id:
        return True
    member = db.query(ChatMember).filter(
        ChatMember.chat_id == chat_id,
        ChatMember.user_id == user_id,
        ChatMember.role == 'admin'
    ).first()
    return member is not None

@app.delete("/api/chat/{chat_id}")
def delete_chat(chat_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    member = db.query(ChatMember).filter(ChatMember.chat_id == chat_id, ChatMember.user_id == current_user.id).first()
    if not member:
        raise HTTPException(403, "Not a member")
    db.query(Message).filter(Message.chat_id == chat_id).delete()
    db.query(ChatMember).filter(ChatMember.chat_id == chat_id).delete()
    db.query(Chat).filter(Chat.id == chat_id).delete()
    db.commit()
    return {"status": "deleted"}

@app.get("/api/messages/{chat_id}/search")
def search_messages(
    chat_id: int,
    q: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    member = db.query(ChatMember).filter(ChatMember.chat_id == chat_id, ChatMember.user_id == current_user.id).first()
    if not member:
        raise HTTPException(403, "Not a member")
    messages = db.query(Message).filter(
        Message.chat_id == chat_id,
        Message.is_deleted == False,
        Message.text.ilike(f"%{q}%")
    ).order_by(Message.created_at.desc()).limit(50).all()
    result = []
    for msg in messages:
        result.append(MessageOut(
            id=msg.id,
            user_id=msg.user_id,
            username=db.query(User).get(msg.user_id).username,
            text=msg.text,
            file_url=msg.file_url,
            file_type=msg.file_type,
            created_at=msg.created_at.isoformat(),
            edited_at=msg.edited_at.isoformat() if msg.edited_at else None,
            is_deleted=False
        ))
    return result

# ---------- Upload ----------
@app.post("/api/upload")
async def upload_file(file: UploadFile = File(...), token: str = Form(...), db: Session = Depends(get_db)):
    payload = decode_token(token)
    if not payload:
        raise HTTPException(401, "Invalid token")
    user_id = int(payload["sub"])
    user = db.query(User).get(user_id)
    if not user:
        raise HTTPException(404, "User not found")

    ext = os.path.splitext(file.filename)[1]
    filename = f"{uuid.uuid4().hex}{ext}"
    filepath = os.path.join(UPLOAD_DIR, filename)
    with open(filepath, "wb") as f:
        shutil.copyfileobj(file.file, f)

    content_type = file.content_type
    if content_type.startswith("image/"):
        file_type = "image"
    elif content_type.startswith("audio/"):
        file_type = "audio"
    else:
        file_type = "document"

    return {"file_url": f"/uploads/{filename}", "file_type": file_type}

# ---------- WebSocket ----------
last_notification_time = defaultdict(dict)
pending_unread_counts = defaultdict(lambda: defaultdict(int))

@app.websocket("/ws/{token}")
async def websocket_endpoint(websocket: WebSocket, token: str, db: Session = Depends(get_db)):
    payload = decode_token(token)
    if not payload:
        await websocket.close(code=1008)
        return
    user_id = int(payload["sub"])
    current_user = db.query(User).get(user_id)
    if not current_user:
        await websocket.close(code=1008)
        return

    await manager.connect(websocket, user_id)
    log = ConnectionLog(user_id=user_id, event_type='connect', reason='user_connected', timestamp=datetime.utcnow())
    db.add(log)
    db.commit()

    user_chats = db.query(ChatMember.chat_id).filter(ChatMember.user_id == user_id).all()
    for chat in user_chats:
        await manager.broadcast_status(chat[0], user_id, True, db)

    try:
        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type")

            if msg_type == "ping":
                await websocket.send_json({"type": "pong"})
                continue

            if msg_type == "edit":
                message_id = data.get("message_id")
                new_text = data.get("text")
                msg = db.query(Message).filter(Message.id == message_id, Message.user_id == user_id).first()
                if msg and not msg.is_deleted:
                    history = MessageHistory(message_id=msg.id, old_text=msg.text, edited_at=datetime.utcnow())
                    db.add(history)
                    msg.text = new_text
                    msg.edited_at = datetime.utcnow()
                    db.commit()
                    await manager.broadcast_to_chat(msg.chat_id, {
                        "type": "edit",
                        "message_id": message_id,
                        "text": new_text
                    }, db)
                continue

            if msg_type == "delete":
                message_id = data.get("message_id")
                msg = db.query(Message).filter(Message.id == message_id).first()
                if msg and (msg.user_id == user_id or (msg.chat.is_group and is_admin(user_id, msg.chat_id, db))):
                    msg.is_deleted = True
                    db.commit()
                    await manager.broadcast_to_chat(msg.chat_id, {
                        "type": "delete",
                        "message_id": message_id
                    }, db)
                continue

            chat_id = data.get("chat_id")
            recipient_username = data.get("recipient_username")
            text = data.get("text", "")
            file_url = data.get("file_url", "")
            file_type = data.get("file_type", "")

            target_chat_id = None
            if chat_id:
                member = db.query(ChatMember).filter(ChatMember.chat_id == chat_id, ChatMember.user_id == user_id).first()
                if not member:
                    continue
                target_chat_id = chat_id
            elif recipient_username:
                recipient = db.query(User).filter(User.username == recipient_username).first()
                if not recipient:
                    continue
                subq = db.query(ChatMember.chat_id).filter(ChatMember.user_id == user_id).subquery()
                chat_ids = db.query(ChatMember.chat_id).filter(ChatMember.user_id == recipient.id, ChatMember.chat_id.in_(subq)).all()
                chat_ids = [c[0] for c in chat_ids]
                personal_chat = db.query(Chat).filter(Chat.id.in_(chat_ids), Chat.is_group == False).first()
                if personal_chat:
                    target_chat_id = personal_chat.id
                else:
                    new_chat = Chat(is_group=False)
                    db.add(new_chat)
                    db.flush()
                    db.add_all([
                        ChatMember(chat_id=new_chat.id, user_id=user_id),
                        ChatMember(chat_id=new_chat.id, user_id=recipient.id)
                    ])
                    db.commit()
                    target_chat_id = new_chat.id
            else:
                continue

            new_msg = Message(
                chat_id=target_chat_id,
                user_id=user_id,
                text=text if not file_url else None,
                file_url=file_url if file_url else None,
                file_type=file_type if file_url else None,
                created_at=datetime.utcnow()
            )
            db.add(new_msg)
            db.flush()

            chat_members = db.query(ChatMember).filter(ChatMember.chat_id == target_chat_id).all()

            for member in chat_members:
                if member.user_id != user_id and member.user_id not in manager.active_connections:
                    now = datetime.utcnow()
                    last = last_notification_time[member.user_id].get(target_chat_id)
                    if not last or (now - last) >= timedelta(minutes=1):
                        unread_count = db.query(Message).filter(
                            Message.chat_id == target_chat_id,
                            Message.created_at > now - timedelta(minutes=1),
                            Message.user_id != member.user_id
                        ).count()
                        if unread_count == 0:
                            unread_count = 1
                        body = f"{current_user.username}: {text or 'Новое сообщение'}"
                        if unread_count > 1:
                            body = f"{current_user.username}: {unread_count} новых сообщений"
                        send_push_notification(member.user_id, current_user.username, body, db)
                        last_notification_time[member.user_id][target_chat_id] = now
                    else:
                        pending_unread_counts[member.user_id][target_chat_id] += 1

            db.commit()

            msg_data = {
                "id": new_msg.id,
                "user_id": user_id,
                "username": current_user.username,
                "text": text if not file_url else None,
                "file_url": file_url if file_url else None,
                "file_type": file_type if file_url else None,
                "created_at": new_msg.created_at.isoformat(),
                "chat_id": target_chat_id
            }

            await manager.broadcast_to_chat(target_chat_id, msg_data, db)

    except WebSocketDisconnect:
        manager.disconnect(user_id)
        log = ConnectionLog(user_id=user_id, event_type='disconnect', reason='user_disconnected', timestamp=datetime.utcnow())
        db.add(log)
        db.commit()
        for chat in user_chats:
            await manager.broadcast_status(chat[0], user_id, False, db)

# ---------- Mark as read ----------
@app.post("/api/mark_read/{chat_id}")
def mark_read(chat_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    stmt = select(Message.id).where(Message.chat_id == chat_id)
    db.query(MessageRead).filter(
        MessageRead.message_id.in_(stmt),
        MessageRead.user_id == current_user.id,
        MessageRead.read_at.is_(None)
    ).update({'read_at': datetime.utcnow()}, synchronize_session=False)
    db.commit()
    return {"status": "ok"}

# ---------- История изменений ----------
@app.get("/api/message_history/{message_id}", response_model=List[MessageHistoryOut])
def get_message_history(message_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    msg = db.query(Message).get(message_id)
    if not msg:
        raise HTTPException(404, "Message not found")
    member = db.query(ChatMember).filter(ChatMember.chat_id == msg.chat_id, ChatMember.user_id == current_user.id).first()
    if not member:
        raise HTTPException(403, "Access denied")
    history = db.query(MessageHistory).filter(MessageHistory.message_id == message_id).order_by(MessageHistory.edited_at).all()
    return [{"old_text": h.old_text, "edited_at": h.edited_at.isoformat()} for h in history]

# ---------- Экспорт чата в PDF ----------
@app.get("/api/chat/{chat_id}/export")
async def export_chat(chat_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    member = db.query(ChatMember).filter(ChatMember.chat_id == chat_id, ChatMember.user_id == current_user.id).first()
    if not member:
        raise HTTPException(403, "Not a member")
    messages = db.query(Message).filter(Message.chat_id == chat_id, Message.is_deleted == False).order_by(Message.created_at).all()
    chat = db.query(Chat).get(chat_id)
    chat_name = chat.name if chat.is_group else f"Chat with {chat.members[0].user.username if chat.members[0].user_id != current_user.id else chat.members[1].user.username}"
    html_content = f"""
    <html>
    <head>
        <meta charset="utf-8">
        <title>Export - {chat_name}</title>
        <style>
            body {{ font-family: Arial, sans-serif; margin: 40px; }}
            .message {{ margin-bottom: 20px; padding: 10px; border-bottom: 1px solid #ccc; }}
            .author {{ font-weight: bold; color: #2c7be5; }}
            .date {{ font-size: 0.8em; color: #666; }}
            .text {{ margin-top: 5px; }}
            .file {{ margin-top: 5px; font-style: italic; }}
        </style>
    </head>
    <body>
        <h1>{chat_name}</h1>
    """
    for msg in messages:
        user = db.query(User).get(msg.user_id)
        html_content += f"""
        <div class="message">
            <div class="author">{user.username}</div>
            <div class="date">{msg.created_at}</div>
            <div class="text">{msg.text or ''}</div>
            {f'<div class="file">Файл: {msg.file_url}</div>' if msg.file_url else ''}
        </div>
        """
    html_content += "</body></html>"
    with tempfile.NamedTemporaryFile(delete=False, suffix='.pdf') as tmp:
        HTML(string=html_content).write_pdf(tmp.name)
        return FileResponse(tmp.name, filename=f"chat_{chat_id}_{datetime.now().strftime('%Y%m%d')}.pdf", media_type='application/pdf')

# ---------- Логи подключений ----------
@app.get("/api/connection_logs")
def get_connection_logs(limit: int = 50, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    logs = db.query(ConnectionLog).filter(ConnectionLog.user_id == current_user.id).order_by(ConnectionLog.timestamp.desc()).limit(limit).all()
    return [{"event_type": l.event_type, "reason": l.reason, "timestamp": l.timestamp.isoformat()} for l in logs]

# ---------- Push subscription ----------
@app.post("/api/subscribe")
def subscribe(subscription: PushSubscriptionIn, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    db.query(PushSubscription).filter(
        PushSubscription.user_id == current_user.id,
        PushSubscription.endpoint == subscription.endpoint
    ).delete()
    new_sub = PushSubscription(
        user_id=current_user.id,
        endpoint=subscription.endpoint,
        p256dh=subscription.keys.get("p256dh", ""),
        auth=subscription.keys.get("auth", "")
    )
    db.add(new_sub)
    db.commit()
    from push_utils import cleanup_duplicate_subscriptions
    cleanup_duplicate_subscriptions(current_user.id, db)
    print(f"DEBUG: Push subscription added for user {current_user.id}, endpoint: {subscription.endpoint[:50]}...")
    return {"status": "subscribed"}

@app.get("/api/vapid_public_key")
def get_vapid_public_key():
    from push_utils import VAPID_PUBLIC_KEY
    print("DEBUG: VAPID_PUBLIC_KEY =", VAPID_PUBLIC_KEY)
    return {"public_key": VAPID_PUBLIC_KEY}

@app.get("/uploads/{filename}")
async def get_uploaded_file(filename: str):
    filepath = os.path.join(UPLOAD_DIR, filename)
    if not os.path.exists(filepath):
        raise HTTPException(404, "File not found")
    return FileResponse(filepath)

@app.get("/api/users/search")
def search_users(q: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    users = db.query(User).filter(
        or_(
            User.username.ilike(f"%{q}%"),
            User.nickname.ilike(f"%{q}%")
        ),
        User.id != current_user.id
    ).limit(10).all()
    return [{"id": u.id, "username": u.username, "nickname": u.nickname} for u in users]

from fastapi.middleware.gzip import GZipMiddleware
from starlette.middleware.base import BaseHTTPMiddleware

app.add_middleware(GZipMiddleware, minimum_size=500)

class CacheControlMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        response = await call_next(request)
        if request.url.path.startswith('/static/'):
            response.headers['Cache-Control'] = 'public, max-age=31536000, immutable'
        return response

app.add_middleware(CacheControlMiddleware)
