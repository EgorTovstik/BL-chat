from sqlalchemy import Integer, String, Boolean, DateTime, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base
from app.models.associations import chat_members
from app.models.chat import Chat

class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    username: Mapped[str] = mapped_column(String(50), unique=True, nullable=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    full_name: Mapped[str] = mapped_column(String(255), nullable=True)
    password: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    is_admin: Mapped[Boolean] = mapped_column(Boolean, server_default='false')

    chats = relationship(
        "Chat",
        secondary=chat_members,
        back_populates="participants"
    )

    messages = relationship(
        "Message",
        back_populates='sender',
        cascade='all, delete-orphan',
    )
    