import json

from typing import Dict, List, Optional

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends, status, Security
from fastapi.encoders import jsonable_encoder

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models import User as AuthUser
from app.api.deps import get_current_user_ws
from app.services import ChatService, MessageService
from app.schemas import MessageRead

router = APIRouter(tags=["ws"])

class ConnectionManager:
    def __init__(self):
        # chat_id -> список сокетов
        self.active: Dict[int, List[WebSocket]] = {}

    async def connect(self, chat_id: int, ws: WebSocket):
        await ws.accept()
        self.active.setdefault(chat_id, []).append(ws)

    def disconnect(self, chat_id: int, ws: WebSocket):
        if chat_id not in self.active:
            return
        
        try:
            self.active[chat_id].remove(ws)
            if not self.active[chat_id]:
                del self.active[chat_id]
        except ValueError:
            pass  # сокет уже удалён

    async def broadcast(self, chat_id: int, data: dict):
        payload = jsonable_encoder(data)
        if chat_id not in self.active:
            return

        # Копируем список, чтобы безопасно удалять битые сокеты в цикле
        for ws in list(self.active[chat_id]):
            try:
                await ws.send_json(payload)
            except Exception as e:
                self.disconnect(chat_id, ws)


manager = ConnectionManager()

@router.websocket("/{chat_id}")
async def ws_chat(
    chat_id: int,
    ws: WebSocket,
    db: AsyncSession = Depends(get_db),
    current_user: AuthUser = Security(
        get_current_user_ws,
        scopes=["chats:read", "messages:write"]
    )
):
    user_id = current_user.id
    if current_user is None:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    # Проверим доступ к чату
    try:
        await ChatService.get_chat(chat_id, db, user_id=current_user.id)
    except ValueError:
        await ws.close(code=status.WS_1008_POLICY_VIOLATION, reason="Access denied")
        return
    
    await manager.connect(chat_id, ws)

    try:
        while True:
            raw = await ws.receive_text()
            try:
                evt = json.loads(raw)
            except json.JSONDecodeError:
                continue

            typ = evt.get("type")

            if typ == "message":
                msg, created = await MessageService.send_message(
                    db,
                    chat_id=chat_id,
                    sender_id=user_id,
                    text=evt["text"],
                    client_msg_id=evt.get("client_msg_id"),
                )

                out = MessageRead.model_validate(msg).model_dump()
                out["type"] = "message"
                
                if created:
                    await manager.broadcast(chat_id, out)
                else:
                    payload = jsonable_encoder(out)
                    await ws.send_json(payload) 

    except WebSocketDisconnect:
        manager.disconnect(chat_id, ws)