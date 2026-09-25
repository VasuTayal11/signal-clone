from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload, selectinload

from app.manager import manager
from app.models import Conversation, ConversationType, Message, MessageStatus, Participant, ParticipantRole, User
from app.schemas import ConversationDetail, ConversationSummary, MessagePublic, ParticipantPublic, UserPublic


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def to_user_public(user: User) -> UserPublic:
    return UserPublic(
        id=user.id,
        identifier=user.identifier,
        display_name=user.display_name,
        avatar=user.avatar,
        last_seen_at=user.last_seen_at,
        is_online=manager.is_online(user.id),
    )


def require_participant(db: Session, conversation_id: str, user_id: str) -> Participant:
    participant = (
        db.query(Participant)
        .filter(Participant.conversation_id == conversation_id, Participant.user_id == user_id)
        .one_or_none()
    )
    if participant is None:
        from fastapi import HTTPException, status

        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found")
    return participant


def conversation_title(conversation: Conversation, viewer_id: str) -> tuple[str, str]:
    if conversation.type == ConversationType.group:
        return conversation.name or "Group", conversation.avatar or "#d7f4e6"
    other = next((p.user for p in conversation.participants if p.user_id != viewer_id), None)
    if other is None:
        return "Note to Self", conversation.avatar or "#e6ddff"
    return other.display_name, other.avatar


def participant_public(participant: Participant) -> ParticipantPublic:
    return ParticipantPublic(
        user_id=participant.user_id,
        display_name=participant.user.display_name,
        identifier=participant.user.identifier,
        avatar=participant.user.avatar,
        role=participant.role,
        is_online=manager.is_online(participant.user_id),
    )


def last_message(conversation: Conversation) -> Message | None:
    if conversation.messages:
        return conversation.messages[-1]
    return None


def unread_count(db: Session, conversation_id: str, user_id: str, last_read_at: datetime | None) -> int:
    query = db.query(func.count(Message.id)).filter(
        Message.conversation_id == conversation_id,
        Message.sender_id != user_id,
    )
    if last_read_at is not None:
        query = query.filter(Message.created_at > last_read_at)
    return int(query.scalar() or 0)


def to_message_public(message: Message) -> MessagePublic:
    return MessagePublic(
        id=message.id,
        conversation_id=message.conversation_id,
        sender_id=message.sender_id,
        sender_name=message.sender.display_name,
        body=message.body,
        status=message.status,
        created_at=message.created_at,
        delivered_at=message.delivered_at,
        read_at=message.read_at,
    )


def to_conversation_summary(db: Session, conversation: Conversation, viewer_id: str) -> ConversationSummary:
    name, avatar = conversation_title(conversation, viewer_id)
    viewer = next(p for p in conversation.participants if p.user_id == viewer_id)
    preview = last_message(conversation)
    other_online = False
    if conversation.type == ConversationType.direct:
        other = next((p for p in conversation.participants if p.user_id != viewer_id), None)
        other_online = bool(other and manager.is_online(other.user_id))
    return ConversationSummary(
        id=conversation.id,
        type=conversation.type,
        name=name,
        avatar=avatar,
        last_message=preview.body if preview else None,
        last_message_at=preview.created_at if preview else conversation.updated_at,
        unread_count=unread_count(db, conversation.id, viewer_id, viewer.last_read_at),
        is_online=other_online,
        members=[participant_public(p) for p in conversation.participants],
    )


def to_conversation_detail(db: Session, conversation: Conversation, viewer_id: str) -> ConversationDetail:
    summary = to_conversation_summary(db, conversation, viewer_id)
    return ConversationDetail(
        **summary.model_dump(),
        created_at=conversation.created_at,
        created_by_id=conversation.created_by_id,
    )


def load_conversation(db: Session, conversation_id: str) -> Conversation | None:
    return (
        db.query(Conversation)
        .options(
            selectinload(Conversation.participants).selectinload(Participant.user),
            selectinload(Conversation.messages).selectinload(Message.sender),
        )
        .filter(Conversation.id == conversation_id)
        .one_or_none()
    )


def find_direct_conversation(db: Session, user_a: str, user_b: str) -> Conversation | None:
    conversations = (
        db.query(Conversation)
        .options(joinedload(Conversation.participants))
        .filter(Conversation.type == ConversationType.direct)
        .all()
    )
    for conversation in conversations:
        ids = {p.user_id for p in conversation.participants}
        if user_a == user_b and ids == {user_a}:
            return conversation
        if ids == {user_a, user_b}:
            return conversation
    return None


def persist_message(db: Session, conversation: Conversation, sender: User, body: str) -> Message:
    now = utcnow()
    message = Message(
        conversation_id=conversation.id,
        sender_id=sender.id,
        body=body,
        status=MessageStatus.sent,
        created_at=now,
    )
    conversation.updated_at = now
    sender_participant = next(p for p in conversation.participants if p.user_id == sender.id)
    sender_participant.last_read_at = now
    db.add(message)
    db.flush()
    db.refresh(message)
    if message.sender is None:
        message.sender = sender
    return message


def mark_delivered(db: Session, message: Message) -> Message:
    if message.status in {MessageStatus.delivered, MessageStatus.read}:
        return message
    message.status = MessageStatus.delivered
    message.delivered_at = utcnow()
    db.add(message)
    db.flush()
    return message


def mark_conversation_read(db: Session, conversation: Conversation, user: User, message_id: str | None) -> list[Message]:
    now = utcnow()
    participant = next(p for p in conversation.participants if p.user_id == user.id)
    participant.last_read_at = now
    updated: list[Message] = []
    query = [
        m
        for m in conversation.messages
        if m.sender_id != user.id and m.status != MessageStatus.read
    ]
    if message_id is not None:
        query = [m for m in query if m.id == message_id or m.created_at <= next((x.created_at for x in conversation.messages if x.id == message_id), now)]
    for message in query:
        message.status = MessageStatus.read
        message.read_at = now
        if message.delivered_at is None:
            message.delivered_at = now
        updated.append(message)
    db.flush()
    return updated
