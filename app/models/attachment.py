from typing import Optional
from sqlalchemy import (Column, Integer, ForeignKey, String, DateTime,
                        BigInteger, Enum as SQLEnum)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from enum import Enum
from datetime import datetime, timezone

from app.models.base import Base

class FileType(str, Enum):
    IMAGE = "image"
    DOCUMENT = "document"
    AUDIO = "audio"
    VIDEO = "video"
    OTHER = "other"


class Attachment(Base):
    __tablename__ = "attachments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    message_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey('messages.id', ondelete='CASCADE'),
        nullable=False,
        index=True
    )

    # Метаданные файла
    filename: Mapped[str] = mapped_column(String(255), nullable=False)  # Оригинальное имя
    file_key: Mapped[str] = mapped_column(String(512), nullable=False, unique=True, index=True)  # Уникальный ключ (путь в хранилище)
    file_type: Mapped[FileType] = mapped_column(SQLEnum(FileType), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(128), nullable=False)
    file_size: Mapped[int] = mapped_column(BigInteger, nullable=False)  # Размер в байтах
    thumbnail_key: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    
    # Метаданные загрузки
    uploaded_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True), 
        default=lambda: datetime.now(timezone.utc), 
        nullable=False
    )
    
    # Связи
    message = relationship('Message', back_populates='attachments')