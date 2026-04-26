from typing import Optional, List
from datetime import datetime
from pydantic import ConfigDict, BaseModel

from app.schemas.user import UserRead 
from app.schemas.attachment import AttachmentRead


class MessageBase(BaseModel):
    text: str

class MessageCreate(MessageBase):
    chat_id: int
    client_msg_id: Optional[str] = None

# Обновлена под вложения
class MessageRead(MessageBase):
    id: int
    chat_id: int
    sender_id: int
    timestamp: datetime
    read: bool
    sender: UserRead
    attachments: Optional[List[AttachmentRead]] = []
    
    model_config = ConfigDict(from_attributes=True)