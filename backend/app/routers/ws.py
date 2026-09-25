from __future__ import annotations

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import TypeAdapter, ValidationError
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.deps import get_user_by_token
from app.manager import manager
from app.models import MessageStatus, Participant, User
from app.schemas import (
    IncomingWSEvent,
    WSErrorEvent,
    WSMessageEvent,
    WSPresenceEvent,
    WSReadEvent,
    WSReadyEvent,
    WSStatusEvent,
    WSTypingEvent,
)
from app.services import (
    load_conversation,
    mark_conversation_read,
    mark_delivered,
    persist_message,
    require_participant,
    to_message_public,
    to_user_public,
    utcnow,
)

router = APIRouter(tags=["realtime"])
incoming_adapter: TypeAdapter[IncomingWSEvent] = TypeAdapter(IncomingWSEvent)


def _participant_ids(conversation) -> list[str]:
    return [p.user_id for p in conversation.participants]


async def _broadcast_presence(db: Session, user: User, is_online: bool) -> None:
    user.last_seen_at = utcnow()
    db.commit()
    event = WSPresenceEvent(
        type="presence",
        user_id=user.id,
        is_online=is_online,
        last_seen_at=user.last_seen_at,
    )
    peer_ids: set[str] = set()
    conversation_ids = [
        row[0]
        for row in db.query(Participant.conversation_id).filter(Participant.user_id == user.id).all()
    ]
    for conversation_id in conversation_ids:
        conversation = load_conversation(db, conversation_id)
        if conversation is None:
            continue
        peer_ids.update(_participant_ids(conversation))
    await manager.broadcast(list(peer_ids), event, exclude_user_id=user.id)


@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, token: str) -> None:
    db = SessionLocal()
    try:
        user = get_user_by_token(db, token)
    except Exception:
        await websocket.close(code=4401)
        db.close()
        return

    await manager.connect(user.id, websocket)
    await manager.send_to_user(user.id, WSReadyEvent(type="ready", user=to_user_public(user)))
    await _broadcast_presence(db, user, True)

    try:
        while True:
            raw = await websocket.receive_json()
            try:
                event = incoming_adapter.validate_python(raw)
            except ValidationError as exc:
                await manager.send_to_user(
                    user.id,
                    WSErrorEvent(type="error", detail=exc.errors()[0]["msg"]),
                )
                continue
            await _handle_event(db, user, event)
    except WebSocketDisconnect:
        pass
    finally:
        manager.disconnect(user.id, websocket)
        if not manager.is_online(user.id):
            await _broadcast_presence(db, user, False)
        db.close()


async def _handle_event(db: Session, user: User, event: IncomingWSEvent) -> None:
    require_participant(db, event.conversation_id, user.id)
    conversation = load_conversation(db, event.conversation_id)
    if conversation is None:
        await manager.send_to_user(user.id, WSErrorEvent(type="error", detail="Conversation not found"))
        return

    if event.type == "message.send":
        message = persist_message(db, conversation, user, event.body.strip())
        recipient_ids = [p.user_id for p in conversation.participants if p.user_id != user.id]
        if any(manager.is_online(user_id) for user_id in recipient_ids):
            mark_delivered(db, message)
        db.commit()
        db.refresh(message)
        public = to_message_public(message)
        await manager.broadcast(
            _participant_ids(conversation),
            WSMessageEvent(type="message.new", message=public, client_id=event.client_id),
        )
        return

    if event.type == "typing":
        await manager.broadcast(
            _participant_ids(conversation),
            WSTypingEvent(
                type="typing",
                conversation_id=conversation.id,
                user_id=user.id,
                display_name=user.display_name,
                is_typing=event.is_typing,
            ),
            exclude_user_id=user.id,
        )
        return

    if event.type == "receipt.read":
        updated = mark_conversation_read(db, conversation, user, event.message_id)
        db.commit()
        read_at = utcnow()
        await manager.broadcast(
            _participant_ids(conversation),
            WSReadEvent(
                type="receipt.read",
                conversation_id=conversation.id,
                user_id=user.id,
                message_id=event.message_id,
                read_at=read_at,
            ),
            exclude_user_id=user.id,
        )
        for message in updated:
            await manager.send_to_user(
                message.sender_id,
                WSStatusEvent(
                    type="message.status",
                    conversation_id=conversation.id,
                    message_id=message.id,
                    status=MessageStatus.read,
                    delivered_at=message.delivered_at,
                    read_at=message.read_at,
                ),
            )
