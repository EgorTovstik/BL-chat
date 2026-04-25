import json
import asyncio

from typing import Dict, List, Set

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends, status, Security
from fastapi.encoders import jsonable_encoder

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models import User as AuthUser, Attachment
from app.api.deps import get_current_user_ws
from app.services import ChatService, MessageService
from app.schemas import MessageRead, AttachmentRead

router = APIRouter(tags=["ws"])


class ConnectionManager:
    def __init__(self):
        self.user_sockets: Dict[int, List[WebSocket]] = {}
        self.chat_subscribers: Dict[int, Set[int]] = {}
        self.online_users: Set[int] = set()
        self.typing_users: Dict[int, Set[int]] = {}

    async def connect(self, user_id: int, ws: WebSocket):
        await ws.accept()
        self.user_sockets.setdefault(user_id, []).append(ws)

        # Первый сокет → переход в онлайн
        if len(self.user_sockets[user_id]) == 1:
            self.online_users.add(user_id)
            # Сообщение всем, что пользователь зашел в сеть
            await self.broadcast_status_update(user_id, "online")

            # Текущему пользователю отправляем список текущих пользователей в сети
            online_list = [uid for uid in self.online_users if uid != user_id]
            await self.send_to_user(user_id, {
                "type": "initial_online_list",
                "user_ids": online_list
            })

    # 🔥 Сделали асинхронным для корректного await
    async def disconnect(self, user_id: int, ws: WebSocket):
        sockets = self.user_sockets.get(user_id, [])
        if ws in sockets:
            sockets.remove(ws)
            if not sockets:
                del self.user_sockets[user_id]
                for subscribers in self.chat_subscribers.values():
                    subscribers.discard(user_id)

        # Если сокетов не осталось → оффлайн
        if not self.user_sockets.get(user_id):
            self.online_users.discard(user_id)
            await self.broadcast_status_update(user_id, "offline")

    async def send_to_user(self, user_id: int, data: dict):
        payload = jsonable_encoder(data)
        dead_ws = []
        for ws in self.user_sockets.get(user_id, []):
            try:
                await ws.send_json(payload)
            except Exception:
                dead_ws.append(ws)
        
        # 🔥 await, так как disconnect теперь async
        for ws in dead_ws:
            await self.disconnect(user_id, ws)

    async def subscribe(self, user_id: int, chat_id: int):
        self.chat_subscribers.setdefault(chat_id, set()).add(user_id)

    async def unsubscribe(self, user_id: int, chat_id: int):
        if chat_id in self.chat_subscribers:
            self.chat_subscribers[chat_id].discard(user_id)

    async def broadcast_status_update(self, user_id: int, status: str):
        payload = {"type": "user_status_update", "user_id": user_id, "status": status}
        
        # Это гарантирует, что сообщение получат только реально активные пользователи
        for uid in list(self.online_users):
            if uid != user_id:
                await self.send_to_user(uid, payload)

    def set_typing(self, user_id: int, chat_id: int):
        """Добавляет пользователя в список печатающих для конкретного чата"""
        if chat_id not in self.typing_users:
            self.typing_users[chat_id] = set()
        self.typing_users[chat_id].add(user_id)

    def clear_typing(self, user_id: int, chat_id: int):
        """Убирает пользователя из списка печатающих"""
        if chat_id in self.typing_users:
            self.typing_users[chat_id].discard(user_id)
            
            # Если в чате больше никто не печатает, удаляем запись о чате
            if not self.typing_users[chat_id]:
                del self.typing_users[chat_id]

    def get_typing_users(self, chat_id: int) -> Set[int]:
        """Возвращает копию множества ID печатающих в чате"""
        return self.typing_users.get(chat_id, set()).copy()

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
            # Проверка на открытие чата
            if typ == "subscribe_chat":
                chat_id = evt.get("chat_id")
                # Проверяем доступ к чату
                await ChatService.get_chat(chat_id, db, user_id=user_id)
                await manager.subscribe(user_id, chat_id)
            # Отправка сообщения
            elif typ == "message":
                chat_id = evt.get("chat_id")
                text = evt.get("text", "").strip()

                # не обробатываем пустые сообщения
                if not text:
                    continue

                await ChatService.get_chat(chat_id, db, user_id=user_id)

                msg, created = await MessageService.send_message(
                    db,
                    chat_id=chat_id,
                    sender_id=user_id,
                    text=text,
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
            elif typ == "message_with_attachment":
                chat_id = evt.get("chat_id")
                text = evt.get("text", "").strip()
                attachment_data = evt.get("attachment")  # Метаданные из upload-эндпоинта
                
                await ChatService.get_chat(chat_id, db, user_id=user_id)
                
                # 1. Создаём сообщение
                msg, created = await MessageService.send_message(
                    db,
                    chat_id=chat_id,
                    sender_id=user_id,
                    text=text,
                    client_msg_id=evt.get("client_msg_id"),
                )
                
                # 2. Создаём запись вложения, если есть
                if attachment_data:
                    attachment = Attachment(
                        message_id=msg.id,
                        filename=attachment_data["filename"],
                        file_key=attachment_data["file_key"],
                        file_type=attachment_data["file_type"],
                        mime_type=attachment_data["mime_type"],
                        file_size=attachment_data["file_size"],
                        thumbnail_key=attachment_data.get("thumbnail_key"),
                    )
                    db.add(attachment)
                    await db.commit()
                    await db.refresh(msg, attribute_names=['attachments'])
                
                # 3. Формируем ответ с вложением
                out = MessageRead.model_validate(msg).model_dump()
                out["type"] = "new_message"
                
                # 🔥 ВАЖНО: добавь client_msg_id, если он был в запросе
                if evt.get("client_msg_id"):
                    out["client_msg_id"] = evt["client_msg_id"]
                
                if hasattr(msg, 'attachments') and msg.attachments:
                    out["attachments"] = [
                        AttachmentRead.model_validate(a).model_dump() 
                        for a in msg.attachments
                    ]
                
                # 4. Рассылаем подписчикам
                for subscriber_id in manager.chat_subscribers.get(chat_id, set()):
                    await manager.send_to_user(subscriber_id, out)
            # Статус "Печатает"
            elif typ == "typing":
                chat_id = evt.get("chat_id")
                is_typing = evt.get("is_typing", True) # по умолчанию true

                await ChatService.get_chat(chat_id, db, user_id=user_id)

                if is_typing:
                    manager.set_typing(user_id, chat_id)
                else:
                    manager.clear_typing(user_id, chat_id)
                    
                # Рассылаем всем участникам чата, КРОМЕ самого печатающего
                participant_ids = await ChatService.get_chat_participant_ids(chat_id, db, exclude_user_id=user_id)
                payload = {
                    "type": "typing_update",
                    "chat_id": chat_id,
                    "user_id": user_id,
                    "is_typing": is_typing
                }
                for uid in participant_ids:
                    await manager.send_to_user(uid, payload)
            elif typ == "read":
                chat_id = evt.get("chat_id")
                up_to_message_id = evt.get("up_to_message_id")

                # Проверяем доступ к чату
                await ChatService.get_chat(chat_id, db, user_id=user_id)

                # Отмечаем сообщения как прочитанные
                count, last_read_at = await MessageService.mark_read(
                    db,
                    user_id=user_id,
                    chat_id=chat_id,
                    up_to_message_id=up_to_message_id,
                )

                # 🔥 Уведомляем ДРУГИХ участников чата — ТОЛЬКО о факте прочтения
                participant_ids = await ChatService.get_chat_participant_ids(
                    chat_id, db, exclude_user_id=user_id
                )
                
                # 🔥 Отправляем чистое событие без полей last_message_*
                payload = {
                    "type": "messages_read",
                    "chat_id": chat_id,
                    "reader_id": user_id,
                    "count": count,
                    "last_read_at": last_read_at.isoformat() if last_read_at else None,
                }
                
                for uid in participant_ids:
                    await manager.send_to_user(uid, payload)

    except WebSocketDisconnect:
        await manager.disconnect(user_id, ws)
