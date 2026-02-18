import uvicorn
from fastapi import FastAPI

from app.api.v1 import api_router

app = FastAPI(
    title="BL-Chat"
)
app.include_router(api_router, prefix="/api/v1")

if __name__ == "__main__":
    uvicorn.run(
        "app.main:app",
        reload=True,
    )