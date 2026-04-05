from typing import List

from sqlalchemy import select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Chat

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