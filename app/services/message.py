# app/services/message_service.py
from typing import Optional, Tuple
from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.exc import IntegrityError
from sqlalchemy.future import select
from sqlalchemy import and_

from fastapi import HTTPException, status

from app.models import User as AuthUser, Chat, Message
from app.schemas.message import MessageRead


class MessageService:
    """Сервис для работы с сообщениями"""

    @staticmethod
    async def send_message(
        db: AsyncSession,
        chat_id: int,
        sender_id: int,
        text: str,
        client_msg_id: Optional[str] = None,
    ) -> Tuple[Message, bool]:  # 🔥 Возвращаем кортеж (сообщение, создан_ли_он)
        """
        Создает сообщение в чате.
        
        Аргументы:
            - db: сессия БД
            - chat_id: ID чата
            - sender_id: ID отправителя
            - text: текст сообщения
            - client_msg_id: опциональный клиентский ID для идемпотентности
            
        Возвращает:
            (Message, bool): кортеж из объекта сообщения и флага, было ли оно создано сейчас
        """
        # 1. Проверяем доступ к чату
        chat = await MessageService._get_chat_or_404(db, chat_id, sender_id)
        if not chat:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Chat not found or access denied"
            )

        # 2. Создаём объект сообщения
        msg = Message(
            chat_id=chat_id,
            sender_id=sender_id,
            text=text,  # 🔥 Передаём напрямую, не через data.text
            client_msg_id=client_msg_id,  # 🔥 Тоже напрямую
            timestamp=datetime.now(timezone.utc),
            read=False
        )

        created = True  # Флаг: новое ли сообщение
        
        # 3. Пробуем сохранить с обработкой идемпотентности
        try:
            db.add(msg)
            await db.commit()
            await db.refresh(msg)
            
        except IntegrityError:
            # 🔥 Дубликат client_msg_id → возвращаем существующее сообщение
            created = False
            await db.rollback()
            
            existing = await MessageService._get_message_by_client_id(
                db, chat_id, sender_id, client_msg_id
            )
            if existing:
                return existing, created  # Возвращаем старое + флаг False
            
            # Если не нашли — пробрасываем ошибку
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Failed to create message due to uniqueness constraint"
            )

        # 4. Подгружаем отправителя для ответа (если нужно в схемах)
        await db.refresh(msg, attribute_names=['sender'])
        
        return msg, created  # 🔥 Возвращаем кортеж, как ты хотел

    # ===== Вспомогательные приватные методы =====

    @staticmethod
    async def _get_chat_or_404(
        db: AsyncSession, 
        chat_id: int, 
        user_id: int
    ) -> Optional[Chat]:
        """Проверяет существование чата и доступ пользователя"""
        query = (
            select(Chat)
            .join(Chat.participants)
            .where(
                and_(
                    Chat.id == chat_id,
                    AuthUser.id == user_id
                )
            )
        )
        result = await db.execute(query)
        return result.scalars().first()

    @staticmethod
    async def _get_message_by_client_id(
        db: AsyncSession,
        chat_id: int,
        sender_id: int,
        client_msg_id: Optional[str],
    ) -> Optional[Message]:
        """Ищет сообщение по client_msg_id для идемпотентности"""
        if not client_msg_id:
            return None
            
        query = select(Message).where(
            and_(
                Message.chat_id == chat_id,
                Message.sender_id == sender_id,
                Message.client_msg_id == client_msg_id
            )
        )
        result = await db.execute(query)
        return result.scalars().first()