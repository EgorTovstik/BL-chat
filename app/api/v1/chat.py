from typing import List

from fastapi import APIRouter, Depends, HTTPException, status, Security
from sqlalchemy import select, and_, func, distinct
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.schemas import ChatRead, ChatCreate, MessageRead
from app.models import User as AuthUser, Chat, Message, chat_members
from app.api.deps import get_current_user
from app.core.database import get_db
from app.services import ChatService

router = APIRouter(tags=["chats"])

@router.post(
    "/",
    response_model=ChatRead,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new personal/group",
)
async def create_chat(
        data: ChatCreate,
        db: AsyncSession = Depends(get_db),
        current_user: AuthUser = Security(get_current_user, scopes=["chats:write"]),
):
    try:
        # формируем список пользователей, которые будут добавлены в чат
        participant_ids = set(data.participant_ids)
        participant_ids.add(current_user.id)
        participant_ids_list = list(participant_ids)
        
        # Проверка для личного чата на двух участников
        if data.type == "personal" and len(participant_ids_list) != 2:
            raise ValueError("Personal chat must have exactly 2 participants (including you)")
        
        # Проверим наличие пользователей в БД
        result = await db.execute(
            select(AuthUser).where(AuthUser.id.in_(participant_ids_list))
        )
        users = result.scalars().all()

        if len(users) != len(participant_ids_list):
            raise ValueError("Users not found")
        
        # Проверим наличие личного чата
        chat = None
        if data.type == "personal":
            query = (
                select(Chat).join(Chat.participants)
                .where(
                    and_(
                        Chat.type == "personal",
                        AuthUser.id.in_(participant_ids_list)
                    )
                )
                .group_by(Chat.id)
                .having(func.count(distinct(AuthUser.id)) == 2)
                .options(selectinload(Chat.participants))
            )
            result = await db.execute(query)
            chat = result.scalars().first()
        # Если чат не найден или это группа, создадим новый
        if not chat:
            chat = Chat(
                name = data.name if data.type == "group" else None,
                type = data.type
            )

            db.add(chat)
            chat.participants.extend(users)
            
            await db.commit()
            await db.refresh(chat)

            # Явно подгружаем участников для ответа, чтобы избежать проблем с lazy-loading в async
            await db.refresh(chat, attribute_names=['participants'])
            # Сделаю доп проверку для гарантии
            stmt = select(Chat).where(Chat.id == chat.id).options(selectinload(Chat.participants))
            result = await db.execute(stmt)
            chat = result.scalars().first()

    except ValueError as e:
        detail = str(e)
        code = status.HTTP_404_NOT_FOUND if detail.startswith("Users not found") else status.HTTP_400_BAD_REQUEST
        raise HTTPException(status_code=code, detail=detail)
    
    return ChatRead.model_validate(chat)

@router.get(
    "/"
    ,response_model=List[ChatRead]
    ,summary="List of current user`s chats"
)
async def list_chats(
    db: AsyncSession = Depends(get_db),
    current_user: AuthUser = Security(get_current_user, scopes=["chats:read"])
):
    try:
        query = (
            select(Chat)
            .join(Chat.participants)
            .where(AuthUser.id == current_user.id)
            .options(selectinload(Chat.participants))
        )
        result = await db.execute(query)
        chats = result.scalars().unique().all()

    except ValueError as e:
        detail = str(e)
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    
    return [ChatRead.model_validate(chat) for chat in chats]

@router.get(
    "/{chat_id}"
    ,response_model=ChatRead
    ,summary="Get chat by ID"
)
async def get_chat(
    chat_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: AuthUser = Security(get_current_user, scopes=["chats:read"])
):
    try:
        chat = await ChatService.get_chat(chat_id, db, user_id=current_user.id)
        # query = (
        #     select(Chat)
        #     .where(Chat.id == chat_id)
        #     .join(Chat.participants)
        #     .where(AuthUser.id == current_user.id)
        #     .options(selectinload(Chat.participants))
        # )

        # result = await db.execute(query)
        # chat = result.scalars().first()
    except ValueError as e:
        detail = str(e)
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    
    # проверим чтобы пользователь был в чате
    if current_user not in chat.participants:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You don't have access to this chat"
        )

    return ChatRead.model_validate(chat)

@router.get(
    "/{chat_id}/messages",
    response_model=List[MessageRead],
    summary="Message history for chat"
)
async def get_chat_history(
    chat_id: int,
    skip: int = 0,
    limit: int = 50,
    db: AsyncSession = Depends(get_db),
    current_user: AuthUser = Security(get_current_user, scopes=["chats:read"])
):
    try:
        query = (
            select(Message)
            .where(Message.chat_id == chat_id)
            .order_by(Message.timestamp.desc())
            .offset(skip)
            .limit(limit)
            .options(selectinload(Message.sender)) #подгрузим автора для распределения на фронте
        )

        result = await db.execute(query)
        msgs = result.scalars().all()
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    return msgs