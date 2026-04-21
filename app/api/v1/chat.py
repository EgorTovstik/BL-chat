from typing import List

from fastapi import APIRouter, Depends, HTTPException, status, Security
from sqlalchemy import select, and_, func, distinct
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from datetime import datetime, timezone

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
    "/",
    response_model=List[ChatRead],
    summary="List of current user's chats with last message"
)
async def list_chats(
    db: AsyncSession = Depends(get_db),
    current_user: AuthUser = Security(get_current_user, scopes=["chats:read"])
):
    # 1️⃣ Загружаем чаты + участников
    chats_query = (
        select(Chat)
        .join(Chat.participants)
        .where(AuthUser.id == current_user.id)
        .options(selectinload(Chat.participants))
        .order_by(Chat.id)
    )
    chats_result = await db.execute(chats_query)
    chats = chats_result.scalars().unique().all()

    if not chats:
        return []

    chat_ids = [chat.id for chat in chats]

    # 2️⃣ Загружаем ПОСЛЕДНИЕ сообщения для этих чатов (1 запрос)
    # Сортируем по chat_id и timestamp DESC → первые в группе будут последними сообщениями
    last_msg_query = (
        select(Message)
        .where(Message.chat_id.in_(chat_ids))
        .order_by(Message.chat_id, Message.timestamp.desc())
        .options(selectinload(Message.sender))  # 🔥 Важно для валидации MessageRead
    )
    msg_result = await db.execute(last_msg_query)
    all_messages = msg_result.scalars().all()

    # Сопоставляем последнее сообщение каждому чату (берём первое совпадение = самое новое)
    last_messages_map = {}
    for msg in all_messages:
        if msg.chat_id not in last_messages_map:
            last_messages_map[msg.chat_id] = msg

    # 3️⃣ Сортируем чаты по времени последнего сообщения (на уровне объектов)
    # Чаты без сообщений — в конец
    chats.sort(
        key=lambda c: last_messages_map.get(c.id).timestamp if last_messages_map.get(c.id) else datetime.min.replace(tzinfo=timezone.utc),
        reverse=True
    )

    # 4️⃣ Теперь собираем ответ (уже отсортированный)
    response_data = []
    for chat in chats:
        # Валидируем чат через Pydantic
        chat_dict = ChatRead.model_validate(chat).model_dump()
        # Добавляем последнее сообщение (валидируем через Pydantic)
        raw_msg = last_messages_map.get(chat.id)
        chat_dict["last_message"] = MessageRead.model_validate(raw_msg) if raw_msg else None
        response_data.append(chat_dict)

    return response_data

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
            .order_by(Message.timestamp.asc())
            .offset(skip)
            .limit(limit)
            .options(selectinload(Message.sender)) #подгрузим автора для распределения на фронте
        )

        result = await db.execute(query)
        msgs = result.scalars().all()
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    return msgs