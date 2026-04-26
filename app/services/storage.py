import io
import os
import uuid
from pathlib import Path
from typing import Optional, BinaryIO
from fastapi import UploadFile
from app.models import FileType
from PIL import Image


class StorageService:
    """Абстракция для работы с хранилищем файлов"""

    def __init__(self, base_dir: str = "uploads"):
        self.base_dir = Path(base_dir)
        self.base_dir.mkdir(parents=True, exist_ok=True)

    def _generate_unic_key(self, filename: str) -> str:
        """Генерирует уникальный ключ для файла"""
        ext = Path(filename).suffix.lower()
        return f"{uuid.uuid4().hex}{ext}" #Сгенерируем случайный 128 идентификатор
    
    def _get_file_type(self, mime_type: str, filename: str) -> FileType:
        """Определяет тип файла по MIME-типу и расширению"""
        if mime_type.startswith('image/'):
            return FileType.IMAGE
        elif mime_type.startswith("video/"):
            return FileType.VIDEO
        elif mime_type.startswith("audio/"):
            return FileType.AUDIO
        elif mime_type in [
            'application/pdf', 'application/msword', 
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        ]:
            return FileType.DOCUMENT
        return FileType.OTHER
    
    async def upload_file(
        self,
        file: UploadFile,
        chat_id: int
    ) -> dict:
        """
        Загружает файл и возвращает метаданные для сохранения в БД
        """
        # валидация: максимальный размер файла (100 МБ)
        MAX_SIZE = 100*1024*1024
        content = await file.read()
        if len(content) > MAX_SIZE:
            raise ValueError(f"File too large: {len(content)} bytes")
        
        # Валидация: тип файла
        allowed_extensions = {
            '.jpg', '.jpeg', '.png', '.gif', '.webp',  # Images
            '.pdf', '.doc', '.docx', '.txt', '.rtf',   # Documents
            '.mp3', '.wav', '.ogg',                     # Audio
            '.mp4', '.webm', '.mov'                     # Video
        }
        ext = Path(file.filename).suffix.lower()
        if ext not in allowed_extensions:
            raise ValueError(f"File type not allowed: {ext}")
        
        # Сгенерируем уникальный ключ
        file_key = self._generate_unic_key(file.filename)
        file_path = self.base_dir / file_key

        # сохраняем файл
        with open(file_path, 'wb') as f:
            f.write(content)

        # генерация превью для изображений для уменьшения нагрузки на чат
        thumbnail_key = None
        if self._get_file_type(file.content_type, file.filename) == FileType.IMAGE:
            try:
                # Открываем изображение из байтов
                img = Image.open(io.BytesIO(content))

                # Конвертируем RGBA/P (прозрачность) в RGB для JPEG
                if img.mode in ("RGBA", "P", "LA"):
                    img = img.convert("GRB")

                # Создаем миниатюру 
                img.thumbnail((300, 300), Image.Resampling.LANCZOS)
                
                # Сохраняем превью
                thumb_key = self._generate_unique_key(f"thumb_{file.filename}")
                thumb_path = self.base_dir / thumb_key
                
                # JPEG оптимальнее для превью: меньше вес, хорошее качество
                img.save(thumb_path, format="JPEG", quality=85, optimize=True)
                
                thumbnail_key = thumb_key
            except Exception as e:
                # print(f"⚠️ Failed to generate thumbnail: {e}")
                thumbnail_key = None

        return {
            "filename": file.filename,
            "file_key": file_key,
            "file_type": self._get_file_type(file.content_type, file.filename),
            "mime_type": file.content_type or "application/octet-stream",
            "file_size": len(content),
            "thumbnail_key": thumbnail_key,
        }
    
    def get_file_url(self, file_key: str) -> str:
        """Возвращает публичный URL для скачивания"""
        return f"/api/v1/files/{file_key}"
    
    async def delete_file(self, file_key: str) -> bool:
        """Удаляет файл из хранилища"""
        file_path = self.base_dir / file_key
        if file_path.exists():
            file_path.unlink()
            return True
        return False
        