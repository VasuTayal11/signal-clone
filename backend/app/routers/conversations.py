from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session, joinedload, selectinload

from app.database import get_db
from app.deps import get_current_user
from app.manager import manager
from datetime import datetime, timezone

from app.models import Conversation, ConversationType, Message, MessageStatus, Participant, ParticipantRole, User
from app.schemas import (
    AddMemberRequest,
    ConversationDetail,
    ConversationListResponse,
    CreateConversationRequest,
    CreateDirectConversationRequest,
    CreateGroupConversationRequest,
    MessageListResponse,
    MessagePublic,
    SendMessageRequest,
    WSMessageEvent,
    WSStatusEvent,
)
from app.services import (
    find_direct_conversation,
    load_conversation,
    mark_delivered,
    persist_message,
    require_participant,
    to_conversation_detail,
    to_conversation_summary,
    to_message_public,
    utcnow,
)

router = APIRouter(prefix="/conversations", tags=["conversations"])


def _load_for_user(db: Session, conversation_id: str, user_id: str) -> Conversation:
    require_participant(db, conversation_id, user_id)
    conversation = load_conversation(db, conversation_id)
    if conversation is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found")
    return conversation


@router.get("", response_model=ConversationListResponse)
def list_conversations(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ConversationListResponse:
    conversation_ids = [
        row[0]
        for row in db.query(Participant.conversation_id).filter(Participant.user_id == current_user.id).all()
    ]
    if not conversation_ids:
        return ConversationListResponse(conversations=[])
    conversations = (
        db.query(Conversation)
        .options(
            selectinload(Conversation.participants).selectinload(Participant.user),
            selectinload(Conversation.messages).selectinload(Message.sender),
        )
        .filter(Conversation.id.in_(conversation_ids))
        .order_by(Conversation.updated_at.desc())
        .all()
    )
    summaries = [to_conversation_summary(db, conversation, current_user.id) for conversation in conversations]
    summaries.sort(
        key=lambda item: item.last_message_at or datetime.min.replace(tzinfo=timezone.utc),
        reverse=True,
    )
    return ConversationListResponse(conversations=summaries)


@router.post("", response_model=ConversationDetail, status_code=status.HTTP_201_CREATED)
def create_conversation(
    payload: CreateConversationRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ConversationDetail:
    if isinstance(payload, CreateDirectConversationRequest):
        other = db.query(User).filter(User.id == payload.user_id).one_or_none()
        if other is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
        existing = find_direct_conversation(db, current_user.id, other.id)
        if existing is not None:
            loaded = load_conversation(db, existing.id)
            assert loaded is not None
            return to_conversation_detail(db, loaded, current_user.id)
        conversation = Conversation(
            type=ConversationType.direct,
            created_by_id=current_user.id,
            updated_at=utcnow(),
        )
        db.add(conversation)
        db.flush()
        db.add(Participant(conversation_id=conversation.id, user_id=current_user.id, role=ParticipantRole.admin))
        if other.id != current_user.id:
            db.add(Participant(conversation_id=conversation.id, user_id=other.id, role=ParticipantRole.member))
        db.commit()
        loaded = load_conversation(db, conversation.id)
        assert loaded is not None
        return to_conversation_detail(db, loaded, current_user.id)

    if isinstance(payload, CreateGroupConversationRequest):
        member_ids = list(dict.fromkeys([current_user.id, *payload.member_ids]))
        users = db.query(User).filter(User.id.in_(member_ids)).all()
        if len(users) != len(member_ids):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="One or more users were not found")
        conversation = Conversation(
            type=ConversationType.group,
            name=payload.name.strip(),
            avatar=payload.avatar,
            created_by_id=current_user.id,
            updated_at=utcnow(),
        )
        db.add(conversation)
        db.flush()
        for user in users:
            role = ParticipantRole.admin if user.id == current_user.id else ParticipantRole.member
            db.add(Participant(conversation_id=conversation.id, user_id=user.id, role=role))
        db.commit()
        loaded = load_conversation(db, conversation.id)
        assert loaded is not None
        return to_conversation_detail(db, loaded, current_user.id)

    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported conversation type")


@router.get("/{conversation_id}", response_model=ConversationDetail)
def get_conversation(
    conversation_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ConversationDetail:
    conversation = _load_for_user(db, conversation_id, current_user.id)
    return to_conversation_detail(db, conversation, current_user.id)


@router.get("/{conversation_id}/messages", response_model=MessageListResponse)
def list_messages(
    conversation_id: str,
    limit: int = Query(default=50, ge=1, le=200),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> MessageListResponse:
    _load_for_user(db, conversation_id, current_user.id)
    messages = (
        db.query(Message)
        .options(joinedload(Message.sender))
        .filter(Message.conversation_id == conversation_id)
        .order_by(Message.created_at.desc())
        .limit(limit)
        .all()
    )
    messages.reverse()
    return MessageListResponse(messages=[to_message_public(message) for message in messages])


@router.post("/{conversation_id}/messages", response_model=MessagePublic, status_code=status.HTTP_201_CREATED)
async def send_message(
    conversation_id: str,
    payload: SendMessageRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> MessagePublic:
    conversation = _load_for_user(db, conversation_id, current_user.id)
    message = persist_message(db, conversation, current_user, payload.body.strip())
    recipient_ids = [p.user_id for p in conversation.participants if p.user_id != current_user.id]
    if any(manager.is_online(user_id) for user_id in recipient_ids):
        mark_delivered(db, message)
    db.commit()
    db.refresh(message)
    public = to_message_public(message)
    event = WSMessageEvent(type="message.new", message=public, client_id=payload.client_id)
    await manager.broadcast([p.user_id for p in conversation.participants], event)
    if message.status == MessageStatus.delivered:
        await manager.send_to_user(
            current_user.id,
            WSStatusEvent(
                type="message.status",
                conversation_id=conversation.id,
                message_id=message.id,
                status=message.status,
                delivered_at=message.delivered_at,
                read_at=message.read_at,
            ),
        )
    return public


@router.post("/{conversation_id}/participants", response_model=ConversationDetail)
def add_participant(
    conversation_id: str,
    payload: AddMemberRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ConversationDetail:
    conversation = _load_for_user(db, conversation_id, current_user.id)
    if conversation.type != ConversationType.group:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Members can only be added to groups")
    actor = next(p for p in conversation.participants if p.user_id == current_user.id)
    if actor.role != ParticipantRole.admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only admins can add members")
    user = db.query(User).filter(User.id == payload.user_id).one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if any(p.user_id == user.id for p in conversation.participants):
        return to_conversation_detail(db, conversation, current_user.id)
    db.add(Participant(conversation_id=conversation.id, user_id=user.id, role=ParticipantRole.member))
    db.commit()
    loaded = load_conversation(db, conversation.id)
    assert loaded is not None
    return to_conversation_detail(db, loaded, current_user.id)


@router.delete("/{conversation_id}/participants/{user_id}", response_model=ConversationDetail)
def remove_participant(
    conversation_id: str,
    user_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ConversationDetail:
    conversation = _load_for_user(db, conversation_id, current_user.id)
    if conversation.type != ConversationType.group:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Members can only be removed from groups")
    actor = next(p for p in conversation.participants if p.user_id == current_user.id)
    if actor.role != ParticipantRole.admin and current_user.id != user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only admins can remove members")
    target = next((p for p in conversation.participants if p.user_id == user_id), None)
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Member not found")
    db.delete(target)
    db.commit()
    loaded = load_conversation(db, conversation.id)
    assert loaded is not None
    return to_conversation_detail(db, loaded, current_user.id)
