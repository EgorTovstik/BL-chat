from datetime import datetime, timezone
from fastapi import APIRouter, UploadFile, Depends, HTTPException, Security, status, File
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.api.deps import get_current_user
from app.models import User as AuthUser, Chat, Message, Attachment
from app.schemas import AttachmentRead
from app.services import StorageService


router = APIRouter(tags=["files"])
storage = StorageService()

@router.post(
    "/chats/{chat_id}/upload",
    response_model=AttachmentRead
)
async def upload_file(
    chat_id: int,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: AuthUser = Security(get_current_user, scopes=["messages:write"]),
):
    """Загружает файл и создаёт запись в БД (без отправки в чат)"""
    try:
        metadata = await storage.upload_file(file, chat_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    
    # 3. Создаём черновик сообщения с вложением (опционально)
    # Или возвращаем метаданные для отправки через сокет
    return AttachmentRead(
        **metadata, 
        id=0, 
        message_id=0,
        uploaded_at=datetime.now(timezone.utc)  # 🔥 Добавь это поле
    )

@router.get("/{file_key}")
async def download_file(file_key: str):
    """скачиваем файл по ключу"""
    file_path = storage.base_dir / file_key
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    
    return FileResponse(file_path, filename=file_key)
