from fastapi import APIRouter

from app.api.v1.user import router as user_router
from app.api.v1.db import router as db_router


api_router = APIRouter()

api_router.include_router(user_router, prefix="/user")
api_router.include_router(db_router, prefix="/database", tags=["health"])
