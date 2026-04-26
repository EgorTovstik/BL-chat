import logging
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from jose import jwt
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.core.database import get_db
from app.core.config import settings
from app.core.security import verify_password

from app.models import User as UserModel

logger = logging.getLogger(__name__)

router = APIRouter(tags=["auth"])

@router.post("/token")
async def login_for_access_token(
        form_data: OAuth2PasswordRequestForm = Depends(),
        db: AsyncSession = Depends(get_db),
):
    logger.debug("start login_for_access_token")
    query = await db.execute(select(UserModel).where(UserModel.username == form_data.username))
    user = query.scalar_one_or_none()
    if not user or not verify_password(form_data.password, user.password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    now = datetime.now(tz=timezone.utc)
    expire = now + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)

    scopes = ["me", "chats:read", "chats:write", "messages:read", "messages:write"]
    if getattr(user, "is_admin", False):
        scopes += ["users:read", "users:write"]

    payload = {
        "sub": str(user.id),
        "exp": expire,
        "scopes": scopes
    }
    token = jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)

    logger.debug("end login_for_access_token")
    return {"access_token": token, "token_type": "bearer"}

