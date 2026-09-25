# Signal Clone

Fullstack Signal-style messenger: Next.js frontend and Python FastAPI backend.

- Frontend: `frontend/`
- Backend: `backend/` — FastAPI, SQLite, WebSockets. Setup and API docs are in `backend/README.md`.

## Quick start

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python seed.py
uvicorn app.main:app --reload --port 8000
```

```bash
cd frontend
pnpm install
pnpm dev
```

Demo OTP is `123456`. Seeded users: `alex`, `maya`, `jordan`, `priya`.
