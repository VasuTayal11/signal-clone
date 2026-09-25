from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.models import User
from app.schemas import UserListResponse
from app.services import to_user_public

router = APIRouter(prefix="/users", tags=["users"])


@router.get("", response_model=UserListResponse)
def list_users(
    q: str | None = Query(default=None, max_length=64),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> UserListResponse:
    query = db.query(User).filter(User.id != current_user.id)
    if q:
        like = f"%{q.strip()}%"
        query = query.filter((User.display_name.ilike(like)) | (User.identifier.ilike(like)))
    users = query.order_by(User.display_name.asc()).all()
    return UserListResponse(users=[to_user_public(user) for user in users])
