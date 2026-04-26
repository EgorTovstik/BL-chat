import json

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends, Security

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models import User as AuthUser, Attachment
from app.api.deps import get_current_user_ws
from app.services import ChatService, MessageService, WebSocketService
from app.schemas import MessageRead, AttachmentRead
from app.core.ws_manager import manager, ConnectionManager

router = APIRouter(tags=["ws"])

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
                if evt.get("client_msg_id"):
                    out["client_msg_id"] = evt["client_msg_id"]

                if created:
                    # 🔥 1️⃣ Рассылаем полное сообщение всем подписчикам
                    for subscriber_id in manager.chat_subscribers.get(chat_id, set()):
                        await manager.send_to_user(subscriber_id, out)

                    # 🔥 2️⃣ Апдейт сайдбара ВСЕМ участникам
                    await WebSocketService._send_chat_list_update(db, chat_id, msg, user_id, manager)

            # Сообщение с вложением
            elif typ == "message_with_attachment":
                chat_id = evt.get("chat_id")
                text = evt.get("text", "").strip()
                attachment_data = evt.get("attachment")
                
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
                    # 🔥 Подгружаем вложения, чтобы они попали в ответ
                    await db.refresh(msg, attribute_names=['attachments'])
                
                # 3. Формируем ответ с вложением
                out = MessageRead.model_validate(msg).model_dump()
                out["type"] = "new_message"
                
                if evt.get("client_msg_id"):
                    out["client_msg_id"] = evt["client_msg_id"]
                
                if hasattr(msg, 'attachments') and msg.attachments:
                    out["attachments"] = [
                        AttachmentRead.model_validate(a).model_dump() 
                        for a in msg.attachments
                    ]
                
                if created:
                    # 🔥 1️⃣ Рассылаем полное сообщение всем подписчикам
                    for subscriber_id in manager.chat_subscribers.get(chat_id, set()):
                        await manager.send_to_user(subscriber_id, out)

                    # 🔥 2️⃣ Апдейт сайдбара ВСЕМ участникам (с вложениями!)
                    await WebSocketService._send_chat_list_update(db, chat_id, msg, user_id, manager)
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
