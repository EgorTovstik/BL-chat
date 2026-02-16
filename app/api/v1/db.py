from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from app.core.database import get_db

router = APIRouter()

@router.get("/db")
async def check_db(
    db: AsyncSession = Depends(get_db)
):
    try:
        await db.execute(text("SELECT 1"))
        return {"database":"ok"}
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"db connection error: {str(e)}"
        )