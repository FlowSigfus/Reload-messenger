from fastapi import WebSocket
from typing import Dict
from sqlalchemy.orm import Session
from database import ChatMember

class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[int, WebSocket] = {}
        self.user_online: Dict[int, bool] = {}

    async def connect(self, websocket: WebSocket, user_id: int):
        await websocket.accept()
        self.active_connections[user_id] = websocket
        self.user_online[user_id] = True

    def disconnect(self, user_id: int):
        if user_id in self.active_connections:
            del self.active_connections[user_id]
        self.user_online[user_id] = False

    async def broadcast_to_chat(self, chat_id: int, message: dict, db: Session):
        members = db.query(ChatMember).filter(ChatMember.chat_id == chat_id).all()
        for member in members:
            ws = self.active_connections.get(member.user_id)
            if ws:
                try:
                    await ws.send_json(message)
                except Exception:
                    pass

    async def broadcast_status(self, chat_id: int, user_id: int, is_online: bool, db: Session):
        message = {"type": "status", "user_id": user_id, "online": is_online}
        members = db.query(ChatMember).filter(ChatMember.chat_id == chat_id).all()
        for member in members:
            ws = self.active_connections.get(member.user_id)
            if ws:
                try:
                    await ws.send_json(message)
                except Exception:
                    pass

    async def send_personal_message(self, message: dict, user_id: int):
        ws = self.active_connections.get(user_id)
        if ws:
            try:
                await ws.send_json(message)
            except Exception:
                pass

    def get_online_status(self, user_id: int) -> bool:
        return self.user_online.get(user_id, False)

manager = ConnectionManager()