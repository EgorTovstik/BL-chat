from typing import List

from sqlalchemy import select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import User as AuthUser, Chat, Message, chat_members

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