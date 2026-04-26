import os
import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import logging
from app.core.logger import FolderBasedFileHandler

from app.api.v1 import api_router


folder_handler = FolderBasedFileHandler(
    base_log_dir="logs",
    source_base_dir="app",
    fallback_log="logs/framework.log"
)
folder_handler.setLevel(logging.INFO)

root_logger = logging.getLogger()  # корневой логгер
if not any(isinstance(h, FolderBasedFileHandler) for h in root_logger.handlers):
    root_logger.addHandler(folder_handler)
root_logger.setLevel(logging.DEBUG)

app = FastAPI(
    title="Chatus"
)
app.include_router(api_router, prefix="/api/v1")

allow_origins = os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

if __name__ == "__main__":
    uvicorn.run(
        "app.main:app",
        host=os.getenv("UVICORN_HOST", "127.0.0.1"),
        port=int(os.getenv("UVICORN_PORT", 8000)),
        reload=os.getenv("UVICORN_RELOAD", "true").lower() == "true",
    )