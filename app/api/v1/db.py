import logging
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from app.core.database import get_db


logger = logging.getLogger(__name__)

router = APIRouter()

@router.get("/db")
async def check_db(
    db: AsyncSession = Depends(get_db)
):
    print("start check_db")
    logger.debug("start check_db")
    try:
        await db.execute(text("SELECT 1"))
        logger.debug("database : ok")
        logger.debug("end check_db")
        return {"database":"ok"}
    except Exception as e:
        logger.debug(f"db connection error: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"db connection error: {str(e)}"
        )