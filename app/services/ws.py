from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Message
from app.core.ws_manager import ConnectionManager


class WebSocketService:
    @staticmethod
    async def _send_chat_list_update(
        db: AsyncSession,
        chat_id: int,
        msg: Message,
        sender_id: int,
        manager: ConnectionManager,
    ):
        """
        Рассылает обновление списка чатов всем участникам.
        Автоматически добавляет вложения в превью, если текст пустой.
        """
        from app.services import ChatService
        from app.schemas import AttachmentRead
        
        # 🔥 Формируем текст превью
        preview_text = msg.text[:100] if msg.text and msg.text.strip() else None
        
        # Если текста нет, но есть вложения — генерируем текстовое превью
        if not preview_text and hasattr(msg, 'attachments') and msg.attachments:
            first = msg.attachments[0]
            count = len(msg.attachments)
            
            # Лейблы без иконок
            labels = {
                "image": "Фото" if count == 1 else f"Фото ({count})",
                "document": "Документ" if count == 1 else f"Документы ({count})",
                "audio": "Аудио" if count == 1 else f"Аудио ({count})",
                "video": "Видео" if count == 1 else f"Видео ({count})",
                "other": "Файл" if count == 1 else f"Файлы ({count})",
            }
            
            # Если все вложения одного типа — показываем общий лейбл
            all_same = all(a.file_type == first.file_type for a in msg.attachments)
            if all_same:
                preview_text = labels.get(first.file_type, "Файл")
            else:
                preview_text = f"{count} вложений"
        
        # 🔥 Базовая структура обновления
        chat_update_base = {
            "type": "chat_list_update",
            "chat_id": chat_id,
            "last_message_text": preview_text or "",
            "last_message_at": msg.timestamp.isoformat(),
            "sender_id": msg.sender_id,
        }
        
        # 🔥 Добавляем вложения для фронтенда (чтобы утилита могла сгенерировать превью)
        if hasattr(msg, 'attachments') and msg.attachments:
            chat_update_base["attachments"] = [
                AttachmentRead.model_validate(a).model_dump() 
                for a in msg.attachments
            ]
        
        # 🔥 Получаем всех участников чата
        participant_ids = await ChatService.get_chat_participant_ids(
            chat_id, db, exclude_user_id=None
        )
        
        # 🔥 Рассылаем каждому участнику с персональным unread_increment
        for uid in participant_ids:
            # Своим сообщениям не увеличиваем счётчик непрочитанных
            unread_increment = 1 if uid != sender_id else 0
            chat_update = {**chat_update_base, "unread_increment": unread_increment}
            await manager.send_to_user(uid, chat_update)