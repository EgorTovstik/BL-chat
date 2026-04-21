import json

from typing import Dict, List, Optional, Set

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends, status, Security
from fastapi.encoders import jsonable_encoder

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models import User as AuthUser
from app.api.deps import get_current_user_ws
from app.services import ChatService, MessageService
from app.schemas import MessageRead

router = APIRouter(tags=["ws"])

# Сокеты на пользователя при авторизации
class ConnectionManager:
    def __init__(self):
        self.user_sockets: Dict[int, List[WebSocket]] = {}  # user_id -> [ws]
        self.chat_subscribers: Dict[int, Set[int]] = {}     # chat_id -> {user_ids}

    async def connect(self, user_id: int, ws: WebSocket):
        await ws.accept()
        self.user_sockets.setdefault(user_id, []).append(ws)

    def disconnect(self, user_id: int, ws: WebSocket):
        sockets = self.user_sockets.get(user_id, [])
        if ws in sockets:
            sockets.remove(ws)
            if not sockets:
                del self.user_sockets[user_id]
                # Очищаем подписки ушедшего юзера
                for subscribers in self.chat_subscribers.values():
                    subscribers.discard(user_id)

    async def send_to_user(self, user_id: int, data: dict):
        payload = jsonable_encoder(data)
        dead_ws = []
        for ws in self.user_sockets.get(user_id, []):
            try:
                await ws.send_json(payload)
            except Exception:
                dead_ws.append(ws)
        for ws in dead_ws:
            self.disconnect(user_id, ws)

    async def subscribe(self, user_id: int, chat_id: int):
        self.chat_subscribers.setdefault(chat_id, set()).add(user_id)

    async def unsubscribe(self, user_id: int, chat_id: int):
        if chat_id in self.chat_subscribers:
            self.chat_subscribers[chat_id].discard(user_id)

manager = ConnectionManager()

@router.websocket("/")
async def ws_main(
    ws: WebSocket,
    db: AsyncSession = Depends(get_db),
    current_user: AuthUser = Security(
        get_current_user_ws,
        scopes=["chats:read", "messages:write"]
    )
):
    user_id = current_user.id
    await manager.connect(user_id, ws)

    try:
        while True:
            raw = await ws.receive_text()
            evt = json.loads(raw)
            typ = evt.get("type")

            if typ == "subscribe_chat":
                chat_id = evt.get("chat_id")
                # Проверяем доступ к чату
                await ChatService.get_chat(chat_id, db, user_id=user_id)
                await manager.subscribe(user_id, chat_id)

            elif typ == "message":
                chat_id = evt.get("chat_id")
                await ChatService.get_chat(chat_id, db, user_id=user_id)

                msg, created = await MessageService.send_message(
                    db,
                    chat_id=chat_id,
                    sender_id=user_id,
                    text=evt["text"],
                    client_msg_id=evt.get("client_msg_id"),
                )

                out = MessageRead.model_validate(msg).model_dump()
                out["type"] = "new_message"

                if created:
                    # 🔥 1️⃣ Полное сообщение ВСЕМ подписчикам (включая отправителя!)
                    # Отправителю это нужно для замены оптимистичного сообщения на реальное
                    for subscriber_id in manager.chat_subscribers.get(chat_id, set()):
                        await manager.send_to_user(subscriber_id, out)

                    # 🔥 2️⃣ Апдейт сайдбара ВСЕМ участникам
                    participant_ids = await ChatService.get_chat_participant_ids(
                        chat_id, db, exclude_user_id=None
                    )
                    chat_update = {
                        "type": "chat_list_update",
                        "chat_id": chat_id,
                        "last_message_text": msg.text[:100],
                        "last_message_at": msg.timestamp.isoformat(),
                        "sender_id": msg.sender_id,
                        "unread_increment": 1
                    }
                    for uid in participant_ids:
                        await manager.send_to_user(uid, chat_update)
                        

    except WebSocketDisconnect:
        manager.disconnect(user_id, ws)

# Сокеты на чат
# class ConnectionManager:
#     def __init__(self):
#         # chat_id -> список сокетов
#         self.active: Dict[int, List[WebSocket]] = {}

#     async def connect(self, chat_id: int, ws: WebSocket):
#         await ws.accept()
#         self.active.setdefault(chat_id, []).append(ws)

#     def disconnect(self, chat_id: int, ws: WebSocket):
#         if chat_id not in self.active:
#             return
        
#         try:
#             self.active[chat_id].remove(ws)
#             if not self.active[chat_id]:
#                 del self.active[chat_id]
#         except ValueError:
#             pass  # сокет уже удалён

#     async def broadcast(self, chat_id: int, data: dict):
#         payload = jsonable_encoder(data)
#         if chat_id not in self.active:
#             return

#         # Копируем список, чтобы безопасно удалять битые сокеты в цикле
#         for ws in list(self.active[chat_id]):
#             try:
#                 await ws.send_json(payload)
#             except Exception as e:
#                 self.disconnect(chat_id, ws)


# manager = ConnectionManager()

# @router.websocket("/{chat_id}")
# async def ws_chat(
#     chat_id: int,
#     ws: WebSocket,
#     db: AsyncSession = Depends(get_db),
#     current_user: AuthUser = Security(
#         get_current_user_ws,
#         scopes=["chats:read", "messages:write"]
#     )
# ):
#     user_id = current_user.id
#     if current_user is None:
#         await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
#         return

#     # Проверим доступ к чату
#     try:
#         await ChatService.get_chat(chat_id, db, user_id=current_user.id)
#     except ValueError:
#         await ws.close(code=status.WS_1008_POLICY_VIOLATION, reason="Access denied")
#         return
    
#     await manager.connect(chat_id, ws)

#     try:
#         while True:
#             raw = await ws.receive_text()
#             try:
#                 evt = json.loads(raw)
#             except json.JSONDecodeError:
#                 continue

#             typ = evt.get("type")

#             if typ == "message":
#                 msg, created = await MessageService.send_message(
#                     db,
#                     chat_id=chat_id,
#                     sender_id=user_id,
#                     text=evt["text"],
#                     client_msg_id=evt.get("client_msg_id"),
#                 )

#                 out = MessageRead.model_validate(msg).model_dump()
#                 out["type"] = "message"
                
#                 if created:
#                     await manager.broadcast(chat_id, out)
#                 else:
#                     payload = jsonable_encoder(out)
#                     await ws.send_json(payload) 

#     except WebSocketDisconnect:
#         manager.disconnect(chat_id, ws)