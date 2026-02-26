from sqlalchemy import Integer, String, Boolean, DateTime, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base
from app.models.associations import chat_members

class Chat(Base):
    __tablename__ = 'chats'

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(100), nullable=True)
    type: Mapped[String] = mapped_column(String(255), nullable=False)
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    participants = relationship(
        "User",
        secondary=chat_members,
        back_populates="chats"
    )

    messages = relationship(
        'Message',
        back_populates='chat',
        cascade='all, delete-orphan',
    )