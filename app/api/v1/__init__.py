from fastapi import APIRouter

from app.api.v1.user import router as user_router
from app.api.v1.db import router as db_router
from app.api.v1.auth import router as auth_router
from app.api.v1.chat import router as chat_router
from app.api.v1.ws import router as ws_router
from app.api.v1.message import router as msg_router
from app.api.v1.file import router as file_router

api_router = APIRouter()

api_router.include_router(user_router, prefix="/user")
api_router.include_router(auth_router, prefix="/auth")
api_router.include_router(chat_router, prefix="/chat")
api_router.include_router(ws_router, prefix="/ws")
api_router.include_router(msg_router, prefix="/message")
api_router.include_router(file_router, prefix="/files")
api_router.include_router(db_router, prefix="/database", tags=["health"])

