from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from sqlalchemy.orm import Session

from app.database import Base, SessionLocal, engine
from app.models import Conversation, ConversationType, Message, MessageStatus, Participant, ParticipantRole, User

SAMPLE_USERS = [
    {
        "identifier": "alex",
        "display_name": "Alex Rivera",
        "avatar": "#dce7ff",
        "token": "demo-token-alex",
    },
    {
        "identifier": "maya",
        "display_name": "Maya Chen",
        "avatar": "#ffe0d2",
        "token": "demo-token-maya",
    },
    {
        "identifier": "jordan",
        "display_name": "Jordan Patel",
        "avatar": "#d7f4e6",
        "token": "demo-token-jordan",
    },
    {
        "identifier": "priya",
        "display_name": "Priya Shah",
        "avatar": "#fff0b8",
        "token": "demo-token-priya",
    },
]


def at(hours_ago: float) -> datetime:
    return datetime.now(timezone.utc) - timedelta(hours=hours_ago)


def add_message(
    db: Session,
    conversation: Conversation,
    sender: User,
    body: str,
    *,
    hours_ago: float,
    status: MessageStatus = MessageStatus.read,
) -> Message:
    created = at(hours_ago)
    message = Message(
        conversation_id=conversation.id,
        sender_id=sender.id,
        body=body,
        status=status,
        created_at=created,
        delivered_at=created + timedelta(seconds=2) if status in {MessageStatus.delivered, MessageStatus.read} else None,
        read_at=created + timedelta(minutes=4) if status == MessageStatus.read else None,
    )
    db.add(message)
    conversation.updated_at = created
    return message


def seed() -> None:
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        users = [
            User(
                identifier=item["identifier"],
                display_name=item["display_name"],
                avatar=item["avatar"],
                session_token=item["token"],
                last_seen_at=at(0.2),
                created_at=at(72),
            )
            for item in SAMPLE_USERS
        ]
        db.add_all(users)
        db.flush()
        alex, maya, jordan, priya = users

        group = Conversation(
            type=ConversationType.group,
            name="Signal team",
            avatar="#d7f4e6",
            created_by_id=alex.id,
            created_at=at(30),
            updated_at=at(2),
        )
        db.add(group)
        db.flush()
        db.add_all(
            [
                Participant(conversation_id=group.id, user_id=alex.id, role=ParticipantRole.admin, joined_at=at(30), last_read_at=at(2)),
                Participant(conversation_id=group.id, user_id=maya.id, role=ParticipantRole.member, joined_at=at(30), last_read_at=at(3)),
                Participant(conversation_id=group.id, user_id=jordan.id, role=ParticipantRole.member, joined_at=at(29), last_read_at=at(4)),
                Participant(conversation_id=group.id, user_id=priya.id, role=ParticipantRole.member, joined_at=at(28), last_read_at=at(5)),
            ]
        )

        maya_chat = Conversation(
            type=ConversationType.direct,
            created_by_id=alex.id,
            created_at=at(48),
            updated_at=at(1),
        )
        jordan_chat = Conversation(
            type=ConversationType.direct,
            created_by_id=alex.id,
            created_at=at(40),
            updated_at=at(6),
        )
        db.add_all([maya_chat, jordan_chat])
        db.flush()
        db.add_all(
            [
                Participant(conversation_id=maya_chat.id, user_id=alex.id, role=ParticipantRole.member, last_read_at=at(1)),
                Participant(conversation_id=maya_chat.id, user_id=maya.id, role=ParticipantRole.member, last_read_at=at(1.1)),
                Participant(conversation_id=jordan_chat.id, user_id=alex.id, role=ParticipantRole.member, last_read_at=at(6)),
                Participant(conversation_id=jordan_chat.id, user_id=jordan.id, role=ParticipantRole.member, last_read_at=at(8)),
            ]
        )

        add_message(db, maya_chat, alex, "Are we still on for the walkthrough?", hours_ago=5)
        add_message(db, maya_chat, maya, "Yes — I just finished the conversation list.", hours_ago=4.6)
        add_message(db, maya_chat, alex, "Perfect. I’ll bring the latest mockups.", hours_ago=4.2)
        add_message(db, maya_chat, maya, "Sounds good — see you soon", hours_ago=1)

        add_message(db, jordan_chat, jordan, "Can you review the group admin controls?", hours_ago=12)
        add_message(db, jordan_chat, alex, "On it. I’ll ping you after I check add/remove members.", hours_ago=6)

        add_message(db, group, alex, "Welcome to private messaging", hours_ago=26)
        add_message(db, group, maya, "Typing indicators and receipts are wired up.", hours_ago=8)
        add_message(db, group, jordan, "Group broadcasts look good from my side.", hours_ago=4)
        add_message(db, group, priya, "I’ll join the standup after this thread.", hours_ago=2, status=MessageStatus.delivered)

        db.commit()
        print("Seeded 4 users, 1 group, 2 direct threads, and message history.")
        print("Demo logins (OTP 123456): alex, maya, jordan, priya")
        print("Stable tokens: demo-token-alex, demo-token-maya, demo-token-jordan, demo-token-priya")
    finally:
        db.close()


if __name__ == "__main__":
    seed()
