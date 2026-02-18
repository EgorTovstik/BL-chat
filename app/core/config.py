from pydantic_settings import BaseSettings
from pydantic import ConfigDict
from dotenv import load_dotenv
from typing import Dict

import os

load_dotenv()


class Settings(BaseSettings):
    model_config = ConfigDict(
        extra='ignore',  # Игнорировать лишние поля
        env_file=".env"  # Указываем .env файл здесь
    )

    DB_HOST: str = os.getenv("DB_HOST")
    DB_PORT: int = int(os.getenv("DB_PORT"))
    DB_NAME: str = os.getenv("DB_NAME")
    DB_USER: str = os.getenv("DB_USER")
    DB_PASSWORD: str = os.getenv("DB_PASSWORD")

    SECRET_KEY: str = os.getenv("SECRET_KEY")
    ALGORITHM: str = os.getenv("ALGORITHM")
    ACCESS_TOKEN_EXPIRE_MINUTES: int = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", 10))

    SCOPES: Dict[str, str] = {
        "me": "Read information about the current user",
        "users:read": "Read all users (admin only)",
        "users:write": "Manage users (admin only)",
        "chats:read": "Read chats list and details",
        "chats:write": "Create new chats",
        "messages:read": "Read chat history",
        "messages:write": "Send messages",
    }

    @property
    def DATABASE_URL(self) -> str:
        return f"postgresql+asyncpg://{self.DB_USER}:{self.DB_PASSWORD}@{self.DB_HOST}:{self.DB_PORT}/{self.DB_NAME}"


settings = Settings()