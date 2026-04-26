from typing import Dict, List, Set

from fastapi import APIRouter, WebSocket
from fastapi.encoders import jsonable_encoder


router = APIRouter(tags=["ws"])


class ConnectionManager:
    def __init__(self):
        self.user_sockets: Dict[int, List[WebSocket]] = {}
        self.chat_subscribers: Dict[int, Set[int]] = {}
        self.online_users: Set[int] = set()
        self.typing_users: Dict[int, Set[int]] = {}

    async def connect(self, user_id: int, ws: WebSocket):
        await ws.accept()
        self.user_sockets.setdefault(user_id, []).append(ws)

        # Первый сокет → переход в онлайн
        if len(self.user_sockets[user_id]) == 1:
            self.online_users.add(user_id)
            # Сообщение всем, что пользователь зашел в сеть
            await self.broadcast_status_update(user_id, "online")

            # Текущему пользователю отправляем список текущих пользователей в сети
            online_list = [uid for uid in self.online_users if uid != user_id]
            await self.send_to_user(user_id, {
                "type": "initial_online_list",
                "user_ids": online_list
            })

    # 🔥 Сделали асинхронным для корректного await
    async def disconnect(self, user_id: int, ws: WebSocket):
        sockets = self.user_sockets.get(user_id, [])
        if ws in sockets:
            sockets.remove(ws)
            if not sockets:
                del self.user_sockets[user_id]
                for subscribers in self.chat_subscribers.values():
                    subscribers.discard(user_id)

        # Если сокетов не осталось → оффлайн
        if not self.user_sockets.get(user_id):
            self.online_users.discard(user_id)
            await self.broadcast_status_update(user_id, "offline")

    async def send_to_user(self, user_id: int, data: dict):
        payload = jsonable_encoder(data)
        dead_ws = []
        for ws in self.user_sockets.get(user_id, []):
            try:
                await ws.send_json(payload)
            except Exception:
                dead_ws.append(ws)
        
        # 🔥 await, так как disconnect теперь async
        for ws in dead_ws:
            await self.disconnect(user_id, ws)

    async def subscribe(self, user_id: int, chat_id: int):
        self.chat_subscribers.setdefault(chat_id, set()).add(user_id)

    async def unsubscribe(self, user_id: int, chat_id: int):
        if chat_id in self.chat_subscribers:
            self.chat_subscribers[chat_id].discard(user_id)

    async def broadcast_status_update(self, user_id: int, status: str):
        payload = {"type": "user_status_update", "user_id": user_id, "status": status}
        
        # Это гарантирует, что сообщение получат только реально активные пользователи
        for uid in list(self.online_users):
            if uid != user_id:
                await self.send_to_user(uid, payload)

    def set_typing(self, user_id: int, chat_id: int):
        """Добавляет пользователя в список печатающих для конкретного чата"""
        if chat_id not in self.typing_users:
            self.typing_users[chat_id] = set()
        self.typing_users[chat_id].add(user_id)

    def clear_typing(self, user_id: int, chat_id: int):
        """Убирает пользователя из списка печатающих"""
        if chat_id in self.typing_users:
            self.typing_users[chat_id].discard(user_id)
            
            # Если в чате больше никто не печатает, удаляем запись о чате
            if not self.typing_users[chat_id]:
                del self.typing_users[chat_id]

    def get_typing_users(self, chat_id: int) -> Set[int]:
        """Возвращает копию множества ID печатающих в чате"""
        return self.typing_users.get(chat_id, set()).copy()

manager = ConnectionManager()