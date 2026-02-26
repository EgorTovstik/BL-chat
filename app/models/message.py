from datetime import datetime, timezone

from sqlalchemy import Column, Integer, ForeignKey, Text, DateTime, Boolean, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class Message(Base):
    __tablename__ = "messages"
    __table_args__ = (
        UniqueConstraint('chat_id', 'client_msg_id', name='unique_chat_client_msg'),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    chat_id: Mapped[int] = mapped_column(Integer, ForeignKey('chats.id', ondelete='CASCADE'), nullable=False)
    sender_id: Mapped[int] = mapped_column(Integer, ForeignKey('users.id', ondelete='SET NULL'), nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    timestamp: Mapped[DateTime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    client_msg_id: Mapped[str] = mapped_column(String(36), nullable=True, index=True)
    read: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    chat = relationship('Chat', back_populates='messages')
    sender = relationship('User', back_populates='messages')
