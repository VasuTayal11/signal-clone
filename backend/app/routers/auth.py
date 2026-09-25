from __future__ import annotations

import secrets

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.deps import get_current_user
from app.models import User
from app.schemas import AuthResponse, LoginRequest, RegisterRequest, UserPublic
from app.services import to_user_public, utcnow

router = APIRouter(prefix="/auth", tags=["auth"])


def _issue_token(user: User) -> str:
    user.session_token = secrets.token_urlsafe(32)
    user.last_seen_at = utcnow()
    return user.session_token


def _normalize_identifier(identifier: str) -> str:
    return identifier.strip()


@router.post("/register", response_model=AuthResponse)
def register(payload: RegisterRequest, db: Session = Depends(get_db)) -> AuthResponse:
    if payload.otp != settings.fixed_otp:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid OTP")
    identifier = _normalize_identifier(payload.identifier)
    existing = db.query(User).filter(User.identifier == identifier).one_or_none()
    if existing is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Account already exists")
    user = User(
        identifier=identifier,
        display_name=payload.display_name.strip(),
        avatar=payload.avatar,
    )
    token = _issue_token(user)
    db.add(user)
    db.commit()
    db.refresh(user)
    return AuthResponse(token=token, user=to_user_public(user))


@router.post("/login", response_model=AuthResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)) -> AuthResponse:
    if payload.otp != settings.fixed_otp:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid OTP")
    identifier = _normalize_identifier(payload.identifier)
    user = db.query(User).filter(User.identifier == identifier).one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found")
    token = _issue_token(user)
    db.commit()
    db.refresh(user)
    return AuthResponse(token=token, user=to_user_public(user))


@router.get("/me", response_model=UserPublic)
def me(current_user: User = Depends(get_current_user)) -> UserPublic:
    return to_user_public(current_user)
