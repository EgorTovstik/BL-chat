from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status, Security, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from sqlalchemy.orm import selectinload
from asyncpg.exceptions import UniqueViolationError

from app.schemas import MessageCreate, MessageRead
from app.models import User as AuthUser, Chat, Message
from app.api.deps import get_current_user
from app.core.database import get_db


router = APIRouter(tags=["/messages"])

@router.post(
    "/{chat_id}/messages",
    response_model=MessageRead,
    summary="Send a new message to chat"
)
async def create_meassage(
    chat_id: int,
    data: MessageCreate,
    db: AsyncSession = Depends(get_db),
    current_user: AuthUser = Security(get_current_user, scopes=["messages:write"]),
):
    try:
        # проверим существование чата и доступ текущего пользователя к нему
        chat_query = (
            select(Chat)
            .join(Chat.participants)
            .where(
                and_(
                    Chat.id == chat_id,
                    AuthUser.id == current_user.id
                )
            )
        )
        result = await db.execute(chat_query)
        chat = result.scalars().first()

        if not chat:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Chat not found or access denied"
            )
        
        # Создадим сообщение
        msg = Message(
            chat_id=chat_id,
            sender_id=current_user.id,
            text=data.text,
            client_msg_id=data.client_msg_id,
            timestamp=datetime.now(timezone.utc),
            read=False
        )

        db.add(msg)
        await db.commit()
        await db.refresh(msg)

        # 3. Подгружаем sender для ответа (если нужно в MessageRead)
        # Если в MessageRead нет данных sender, этот шаг можно пропустить
        await db.refresh(msg, attribute_names=['sender'])

        return MessageRead.model_validate(msg)

    except Exception as e:
        await db.rollback() 

        # Обработка дубликата client_msg_id (идемпотентность)
        if "unique_chat_client_msg" in str(e) or isinstance(e, UniqueViolationError):
            # Возвращаем существующее сообщение вместо ошибки
            stmt = select(Message).where(
                and_(
                    Message.chat_id == chat_id,
                    Message.client_msg_id == data.client_msg_id,
                    Message.sender_id == current_user.id
                )
            )
            result = await db.execute(stmt)
            existing_msg = result.scalars().first()
            
            if existing_msg:
                return MessageRead.model_validate(existing_msg)
        
        # Другие ошибки
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to create message: {str(e)}"
        )
