from __future__ import annotations

from collections import defaultdict

from fastapi import WebSocket
from pydantic import BaseModel


class ConnectionManager:
    def __init__(self) -> None:
        self._sockets: dict[str, set[WebSocket]] = defaultdict(set)

    async def connect(self, user_id: str, websocket: WebSocket) -> None:
        await websocket.accept()
        self._sockets[user_id].add(websocket)

    def disconnect(self, user_id: str, websocket: WebSocket) -> None:
        sockets = self._sockets.get(user_id)
        if not sockets:
            return
        sockets.discard(websocket)
        if not sockets:
            self._sockets.pop(user_id, None)

    def is_online(self, user_id: str) -> bool:
        return bool(self._sockets.get(user_id))

    def online_user_ids(self) -> set[str]:
        return {user_id for user_id, sockets in self._sockets.items() if sockets}

    async def send_to_user(self, user_id: str, payload: BaseModel) -> int:
        sockets = list(self._sockets.get(user_id, set()))
        delivered = 0
        data = payload.model_dump(mode="json")
        for websocket in sockets:
            try:
                await websocket.send_json(data)
                delivered += 1
            except Exception:
                self.disconnect(user_id, websocket)
        return delivered

    async def broadcast(
        self,
        user_ids: list[str],
        payload: BaseModel,
        *,
        exclude_user_id: str | None = None,
    ) -> int:
        delivered = 0
        for user_id in user_ids:
            if user_id == exclude_user_id:
                continue
            delivered += await self.send_to_user(user_id, payload)
        return delivered


manager = ConnectionManager()
