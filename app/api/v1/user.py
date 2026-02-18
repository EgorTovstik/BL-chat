from fastapi import Depends
from fastapi import APIRouter, HTTPException, status, Security
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user

from app.schemas import UserCreate, UserRead
from app.models import User as UserModel
from app.core.database import get_db
from app.core.security import hash_password


router = APIRouter(tags=["users"])

@router.get(
    "/me",
    response_model=UserRead,
    summary="Get current user"
)
async def read_own_profile(
        current_user: UserModel = Security(get_current_user, scopes=["me"]),
):
    return UserRead.model_validate(current_user)

@router.post(
    "/",
    response_model=UserRead,
    status_code=status.HTTP_201_CREATED,
    summary="Create user"
)
async def create_user(
    user_in: UserCreate,
    db: AsyncSession = Depends(get_db)
):
    #  Проверка на существование пользователя
    exists = select(UserModel).where(UserModel.email == user_in.email)
    result = await db.execute(exists)
    existing_user = result.scalar_one_or_none()

    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Пользователь с такой почтой уже зарегистрирвоан"
        )
    
    # Хэшируем пароль
    hashed_password = hash_password(user_in.password)

    username = user_in.email.partition("@")[0] #Определим username из почты
    # Создание ORM объекта
    user = UserModel(
        full_name=user_in.full_name,
        email=user_in.email,
        password=hashed_password,
        username=username,
    )

    db.add(user)
    await db.commit()
    await db.refresh(user)

    return user

@router.get(
    "/{user_id}",
    response_model=UserRead,
    summary="Get user by ID"
)
async def get_user(
        user_id: int
        ,db: AsyncSession = Depends(get_db)
):
    query = select(UserModel).where(UserModel.id == user_id)
    result = await db.execute(query)
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User Not Found"
        )

    return user