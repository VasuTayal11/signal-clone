# Signal Clone Backend

Python FastAPI service for the Signal clone frontend. It stores users, conversations, and messages in SQLite, exposes REST APIs for mocked auth and chat history, and uses WebSockets for live messaging.

## Tech stack

- FastAPI
- SQLAlchemy 2.0
- SQLite
- Pydantic v2 (`extra="forbid"`, `strict=True`)
- WebSockets via `ConnectionManager`

## Setup

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python seed.py
uvicorn app.main:app --reload --port 8000
```

On macOS/Linux, activate the venv with `source .venv/bin/activate`.

The API is at `http://127.0.0.1:8000`. OpenAPI docs: `http://127.0.0.1:8000/docs`.

## Demo accounts

OTP is always `123456`.

| Identifier | Name | Token (after seed, until next login) |
| --- | --- | --- |
| `alex` | Alex Rivera | `demo-token-alex` |
| `maya` | Maya Chen | `demo-token-maya` |
| `jordan` | Jordan Patel | `demo-token-jordan` |
| `priya` | Priya Shah | `demo-token-priya` |

`python seed.py` resets `signal.db` and creates four users, one **Signal team** group, two 1-on-1 threads, and existing message history.

Login issues a new session token. Use the token from the login response after calling `/api/auth/login`.

## Architecture

```
backend/
  app/
    main.py            FastAPI app, CORS, routers
    models.py          SQLAlchemy models
    schemas.py         Pydantic v2 request/response/WS payloads
    manager.py         WebSocket ConnectionManager
    routers/           REST + WebSocket routes
    services.py        Conversation/message helpers
  seed.py
  signal.db            Created at runtime
```

REST handles auth, user search, conversation lists, history, group membership, and a fallback send-message endpoint. The WebSocket connection is the real-time path for new messages, typing, delivery, and read receipts.

## Database schema

**User** — `id`, `identifier` (phone or username), `display_name`, `avatar`, `session_token`, `last_seen_at`, `created_at`

**Conversation** — `id`, `type` (`direct` | `group`), `name`, `avatar`, `created_by_id`, `created_at`, `updated_at`

**Participant** — `id`, `conversation_id`, `user_id`, `role` (`admin` | `member`), `last_read_at`, `joined_at`  
Unique on (`conversation_id`, `user_id`). Direct chats have two participants (or one for note-to-self). Groups have a creator admin plus members.

**Message** — `id`, `conversation_id`, `sender_id`, `body`, `status` (`sending` | `sent` | `delivered` | `read`), `created_at`, `delivered_at`, `read_at`

## REST API

All JSON request and response bodies use strict Pydantic v2 models.

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/health` | No | Liveness |
| POST | `/api/auth/register` | No | Register with identifier, OTP, display name, avatar |
| POST | `/api/auth/login` | No | Login with identifier + OTP `123456` |
| GET | `/api/auth/me` | Bearer | Current user |
| GET | `/api/users?q=` | Bearer | Search other users |
| GET | `/api/conversations` | Bearer | Conversation list, newest activity first |
| POST | `/api/conversations` | Bearer | Create direct (`{"type":"direct","user_id"}`) or group (`{"type":"group","name","member_ids"}`) |
| GET | `/api/conversations/{id}` | Bearer | Conversation detail + members |
| GET | `/api/conversations/{id}/messages` | Bearer | Message history |
| POST | `/api/conversations/{id}/messages` | Bearer | Persist a message and fan out over WebSocket |
| POST | `/api/conversations/{id}/participants` | Bearer | Admin adds a group member |
| DELETE | `/api/conversations/{id}/participants/{user_id}` | Bearer | Admin removes a member (or self-leave) |

Example login:

```bash
curl -X POST http://127.0.0.1:8000/api/auth/login ^
  -H "Content-Type: application/json" ^
  -d "{\"identifier\":\"alex\",\"otp\":\"123456\"}"
```

## WebSocket

Connect to `ws://127.0.0.1:8000/ws?token=<session_token>`.

Incoming payloads (strict):

```json
{"type":"message.send","conversation_id":"...","body":"Hello","client_id":"optional"}
{"type":"typing","conversation_id":"...","is_typing":true}
{"type":"receipt.read","conversation_id":"...","message_id":null}
```

Outgoing payloads:

- `ready` — connection accepted
- `message.new` — persisted message for direct and group chats
- `message.status` — `sent` → `delivered` → `read`
- `typing` — typing indicator
- `receipt.read` — read receipt
- `presence` — online / last seen
- `error` — validation or authorization failure

Delivery: a message is stored as `sent`. If any other participant is connected, it is marked `delivered`. When a recipient sends `receipt.read`, matching messages become `read`.

## Assumptions

- Phone verification is mocked with a fixed OTP (`123456`). There is no real SMS or cryptographic key exchange.
- Session auth is a bearer token stored on the user row, not JWT.
- End-to-end encryption is not implemented; messages are stored in plaintext for the assignment.
- Online state is derived from active WebSocket connections.
- CORS defaults to `http://localhost:3000` and `http://127.0.0.1:3000`.
