# Signal Clone

Signal-style full-stack messenger with a Next.js frontend and FastAPI backend.

## Tech Stack

- Next.js 16, React 19, TypeScript, Tailwind CSS, and Lucide icons
- FastAPI, Pydantic 2, SQLAlchemy 2, SQLite, and WebSockets
- JSON REST APIs for authentication, contacts, conversations, and group membership
- WebSockets for live messages, typing indicators, presence, and read receipts

## Run Locally

Start the backend in one terminal:
```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python seed.py
uvicorn app.main:app --reload --port 8000
```

On macOS/Linux, activate the virtual environment with `source .venv/bin/activate`.

Start the frontend in another terminal:
```bash
cd frontend
pnpm install
pnpm dev
```

Open `http://localhost:3000`. The API defaults to `http://127.0.0.1:8000`; set `NEXT_PUBLIC_API_URL` when the backend runs at a different address.

The seeded accounts are `alex`, `maya`, `jordan`, and `priya`. The demo verification code is `123456`. Use **Create account** to add another user. Seeding resets the local SQLite database at `backend/signal.db`.

## Architecture

The browser stores the bearer token in local storage and restores the user through `GET /api/auth/me`. The frontend loads conversations and message history over REST, then opens an authenticated WebSocket for live events. Messages and group membership are persisted through SQLAlchemy models in SQLite. WebSocket presence is process-local, so online indicators are intended for a single backend instance.

The backend is organized into routers (`auth`, `users`, `conversations`, and `ws`), shared request/response schemas, database models, and conversation/message services. More detailed backend notes are in [backend/README.md](backend/README.md).

## Database Schema

- `User`: identifier, display name, avatar, session token, and last-seen timestamp
- `Conversation`: direct or group type, name/avatar, creator, and activity timestamps
- `Participant`: conversation/user relationship, role, join time, and last-read timestamp; unique per conversation and user
- `Message`: conversation, sender, body, delivery status, and sent/delivered/read timestamps

## API Overview

- `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`
- `GET /api/users?q=...`
- `GET` and `POST /api/conversations`; `GET /api/conversations/{id}/messages`; `POST /api/conversations/{id}/messages`
- `POST` and `DELETE /api/conversations/{id}/participants/{user_id}` for group membership
- `ws://127.0.0.1:8000/ws?token=...` for realtime messaging events

## Assumptions

OTP is fixed to `123456`; phone verification is mocked. End-to-end encryption is not implemented, and messages are stored as plaintext. Calls and stories are placeholders. The default database is local SQLite; set `DATABASE_URL` for another SQLAlchemy-supported database URL.
