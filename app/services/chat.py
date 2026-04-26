from typing import List
from datetime import datetime, timezone

from sqlalchemy import select, func, and_
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import User as AuthUser, Chat, Message, chat_members
from app.schemas import ChatRead, MessageRead

class ChatService:
    @staticmethod
    async def get_chat(chat_id: int, db: AsyncSession, user_id: int) -> Chat:
        from app.models import chat_members

        result = await db.execute(
            select(Chat)
            .where(Chat.id == chat_id)
            .join(chat_members, Chat.id == chat_members.c.chat_id)
            .where(chat_members.c.user_id == user_id)
            .options(selectinload(Chat.participants))
        )

        chat = result.scalar_one_or_none()
        if not chat:
            raise ValueError("Chat not found or access denied")
        return chat
    
    @staticmethod
    async def get_chat_participant_ids(
        chat_id: int,
        db: AsyncSession,
        exclude_user_id: int = None
    ) -> List[int]:
        """Возвращает ID участников чата. Опционально исключает отправителя."""
        stmt = (
            select(AuthUser.id)
            .join(chat_members, AuthUser.id == chat_members.c.user_id)
            .where(chat_members.c.chat_id == chat_id)
        )
        if exclude_user_id:
            stmt = stmt.where(AuthUser.id != exclude_user_id)

        result = await db.execute(stmt)
        return result.scalars().all()
    
    @staticmethod
    async def get_chats_with_metadata(
        db: AsyncSession,
        chats: List[Chat],
        current_user_id: int
    ) -> List[dict]:
        """
        Добавляет к списку чатов:
        - last_message (валидированный через MessageRead)
        - unread_count
        - сортировку по времени последнего сообщения
        
        Возвращает список dict, готовый к возврату в API.
        """
        if not chats:
            return []
        
        chat_ids = [chat.id for chat in chats]

        # Загружаем ПОСЛЕДНИЕ сообщения для всех чатов одним запросом
        last_msg_query = (
            select(Message)
            .where(Message.chat_id.in_(chat_ids))
            .order_by(Message.chat_id, Message.timestamp.desc())
            .options(selectinload(Message.sender))
        )
        msg_result = await db.execute(last_msg_query)
        all_messages = msg_result.scalars().all()

        # Строим мапу: chat_id -> последнее сообщение
        last_msg_map = {}
        for msg in all_messages:
            if msg.chat_id not in last_msg_map:
                last_msg_map[msg.chat_id] = msg

        # Сортируем чаты по времени последнего сообщения
        chats.sort(
            key=lambda c: (
                last_msg_map.get(c.id).timestamp 
                if last_msg_map.get(c.id) 
                else datetime.min.replace(tzinfo=timezone.utc)
            ),
            reverse=True
        )

        # Считаем unread_count для всех чатов одним запросом (оптимизация!)
        unread_counts_query = (
            select(Message.chat_id, func.count(Message.id))
            .where(
                and_(
                    Message.chat_id.in_(chat_ids),
                    Message.sender_id != current_user_id,
                    Message.read == False
                )
            )
            .group_by(Message.chat_id)
        )
        unread_result = await db.execute(unread_counts_query)
        unread_map = {row[0]: row[1] for row in unread_result.all()}

        # 🔥 5. Собираем финальный ответ
        response_data = []
        for chat in chats:
            # Валидируем чат через Pydantic
            chat_dict = ChatRead.model_validate(chat).model_dump()
            
            # Добавляем последнее сообщение (если есть)
            raw_msg = last_msg_map.get(chat.id)
            if raw_msg:
                chat_dict["last_message"] = MessageRead.model_validate(raw_msg).model_dump()
            else:
                chat_dict["last_message"] = None
            
            # Добавляем unread_count (дефолт 0)
            chat_dict['unread_count'] = unread_map.get(chat.id, 0)
            
            response_data.append(chat_dict)
        
        return response_data