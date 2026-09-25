from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal, Union

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from app.models import ConversationType, MessageStatus, ParticipantRole

StrictStr = Annotated[str, StringConstraints(strict=True, min_length=1, max_length=4000)]
IdentifierStr = Annotated[str, StringConstraints(strict=True, min_length=3, max_length=64)]
NameStr = Annotated[str, StringConstraints(strict=True, min_length=1, max_length=120)]
AvatarStr = Annotated[str, StringConstraints(strict=True, min_length=1, max_length=32)]
IdStr = Annotated[str, StringConstraints(strict=True, min_length=1, max_length=36)]
OtpStr = Annotated[str, StringConstraints(strict=True, min_length=6, max_length=6)]
TokenStr = Annotated[str, StringConstraints(strict=True, min_length=8, max_length=128)]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, from_attributes=True)


class RegisterRequest(StrictModel):
    identifier: IdentifierStr
    otp: OtpStr
    display_name: NameStr
    avatar: AvatarStr = "#dce7ff"


class LoginRequest(StrictModel):
    identifier: IdentifierStr
    otp: OtpStr


class UserPublic(StrictModel):
    id: str
    identifier: str
    display_name: str
    avatar: str
    last_seen_at: datetime
    is_online: bool = False


class AuthResponse(StrictModel):
    token: str
    user: UserPublic


class ParticipantPublic(StrictModel):
    user_id: str
    display_name: str
    identifier: str
    avatar: str
    role: ParticipantRole
    is_online: bool = False


class MessagePublic(StrictModel):
    id: str
    conversation_id: str
    sender_id: str
    sender_name: str
    body: str
    status: MessageStatus
    created_at: datetime
    delivered_at: datetime | None = None
    read_at: datetime | None = None


class ConversationSummary(StrictModel):
    id: str
    type: ConversationType
    name: str
    avatar: str
    last_message: str | None = None
    last_message_at: datetime | None = None
    unread_count: int
    is_online: bool = False
    members: list[ParticipantPublic]


class ConversationDetail(ConversationSummary):
    created_at: datetime
    created_by_id: str


class ConversationListResponse(StrictModel):
    conversations: list[ConversationSummary]


class MessageListResponse(StrictModel):
    messages: list[MessagePublic]


class CreateDirectConversationRequest(StrictModel):
    type: Literal["direct"]
    user_id: IdStr


class CreateGroupConversationRequest(StrictModel):
    type: Literal["group"]
    name: NameStr
    member_ids: list[IdStr]
    avatar: AvatarStr = "#d7f4e6"


CreateConversationRequest = Annotated[
    Union[CreateDirectConversationRequest, CreateGroupConversationRequest],
    Field(discriminator="type"),
]


class AddMemberRequest(StrictModel):
    user_id: IdStr


class SendMessageRequest(StrictModel):
    body: StrictStr
    client_id: str | None = None


class UserListResponse(StrictModel):
    users: list[UserPublic]


class HealthResponse(StrictModel):
    status: Literal["ok"]


class WSSendMessage(StrictModel):
    type: Literal["message.send"]
    conversation_id: IdStr
    body: StrictStr
    client_id: str | None = None


class WSTyping(StrictModel):
    type: Literal["typing"]
    conversation_id: IdStr
    is_typing: bool


class WSReadReceipt(StrictModel):
    type: Literal["receipt.read"]
    conversation_id: IdStr
    message_id: IdStr | None = None


IncomingWSEvent = Annotated[
    Union[WSSendMessage, WSTyping, WSReadReceipt],
    Field(discriminator="type"),
]


class WSErrorEvent(StrictModel):
    type: Literal["error"]
    detail: str


class WSReadyEvent(StrictModel):
    type: Literal["ready"]
    user: UserPublic


class WSMessageEvent(StrictModel):
    type: Literal["message.new"]
    message: MessagePublic
    client_id: str | None = None


class WSStatusEvent(StrictModel):
    type: Literal["message.status"]
    conversation_id: str
    message_id: str
    status: MessageStatus
    delivered_at: datetime | None = None
    read_at: datetime | None = None


class WSTypingEvent(StrictModel):
    type: Literal["typing"]
    conversation_id: str
    user_id: str
    display_name: str
    is_typing: bool


class WSReadEvent(StrictModel):
    type: Literal["receipt.read"]
    conversation_id: str
    user_id: str
    message_id: str | None = None
    read_at: datetime


class WSPresenceEvent(StrictModel):
    type: Literal["presence"]
    user_id: str
    is_online: bool
    last_seen_at: datetime


OutgoingWSEvent = Annotated[
    Union[
        WSErrorEvent,
        WSReadyEvent,
        WSMessageEvent,
        WSStatusEvent,
        WSTypingEvent,
        WSReadEvent,
        WSPresenceEvent,
    ],
    Field(discriminator="type"),
]
