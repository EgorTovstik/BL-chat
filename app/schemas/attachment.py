from pydantic import BaseModel
from datetime import datetime
from typing import Optional
from app.models.attachment import FileType

class AttachmentBase(BaseModel):
    filename: str
    file_type: FileType
    mime_type: str
    file_size: int

class AttachmentCreate(AttachmentBase):
    file_key: str
    thumbnail_key: Optional[str] = None

class AttachmentRead(AttachmentBase):
    id: int
    message_id: int
    file_key: str
    thumbnail_key: Optional[str] = None
    uploaded_at: datetime
    
    class Config:
        from_attributes = True

class AttachmentInMessage(AttachmentRead):
    """Вложение внутри сообщения"""
    pass

