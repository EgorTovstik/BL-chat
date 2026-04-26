import os
import logging
from logging.handlers import RotatingFileHandler
from threading import Lock

# Конфигуратор логирования
class FolderBasedFileHandler(logging.Handler):
    def __init__(
            self,
            base_log_dir: str = "logs",
            source_base_dir: str = "app",
            fallback_log: str = "logs/_fallback.log",
            max_bytes: int = 10 * 1024 * 1024,
            backup_count: int = 5
    ):
        super().__init__()
        self.base_log_dir = os.path.abspath(base_log_dir)
        self.source_base_dir = os.path.abspath(source_base_dir)
        self.fallback_log = os.path.abspath(fallback_log)
        self.max_bytes = max_bytes
        self.backup_count = backup_count

        self._handlers: dict[str, RotatingFileHandler] = {}
        self._lock = Lock()

        self.formatter = logging.Formatter(
            "%(asctime)s | %(levelname)-8s | %(name)s | %(pathname)s:%(lineno)d - %(message)s"
        )

    def _get_handler(self, log_path: str) -> RotatingFileHandler:
        """Возвращает кешированный или создаёт новый FileHandler"""
        if log_path not in self._handlers:
            with self._lock:
                if log_path not in self._handlers:
                    os.makedirs(os.path.dirname(log_path), exist_ok=True)
                    handler = RotatingFileHandler(
                        log_path,
                        maxBytes=self.max_bytes,
                        backupCount=self.backup_count,
                        encoding="utf-8"
                    )
                    handler.setFormatter(self.formatter)
                    self._handlers[log_path] = handler

        return self._handlers[log_path]
    
    def emit(self, record: logging.LogRecord):
        try:
            pathname = os.path.abspath(record.pathname)

            # Определяем целевой файл лога
            if pathname.startswith(self.source_base_dir):
                rel_path = os.path.relpath(pathname, self.source_base_dir)
                folder = os.path.dirname(rel_path)
                filename = os.path.splitext(os.path.basename(rel_path))[0]
                target_log = os.path.join(self.base_log_dir, folder, f"{filename}.log")
            else:
                # Файлы вне исходной директории (например, uvicorn, sqlalchemy)
                target_log = self.fallback_log

            handler = self._get_handler(target_log)
            handler.emit(record)
        except Exception:
            self.handleError(record)