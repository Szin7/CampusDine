from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import Principal, current_user, require_student
from app.db import get_session
from app.models import MenuItem
from app.schemas import MenuView, RecommendationsView
from app.recommendations import recommend

router = APIRouter(prefix="/menu", tags=["Menu"])


@router.get("", response_model=list[MenuView])
def browse_menu(response: Response, category: str | None = Query(None, min_length=1, max_length=50),
                available_only: bool = False, limit: int = Query(100, ge=1, le=200),
                offset: int = Query(0, ge=0), user: Principal = Depends(current_user),
                db: Session = Depends(get_session)):
    response.headers["Cache-Control"] = "no-store"
    query = select(MenuItem).where(MenuItem.is_archived.is_(False))
    if category is not None:
        query = query.where(MenuItem.category.collate("NOCASE") == category.strip())
    if available_only:
        query = query.where(MenuItem.is_available.is_(True))
    return db.scalars(query.order_by(MenuItem.category.collate("NOCASE"),
                                    MenuItem.name.collate("NOCASE"), MenuItem.id)
                      .offset(offset).limit(limit)).all()


@router.get("/recommendations", response_model=RecommendationsView)
def menu_recommendations(response: Response, limit: int = Query(6, ge=1, le=20),
                         user: Principal = Depends(require_student),
                         db: Session = Depends(get_session)):
    response.headers["Cache-Control"] = "no-store"
    return recommend(db, user.account.id, limit)


@router.get("/{item_id}", response_model=MenuView)
def get_menu_item(item_id: int, response: Response, user: Principal = Depends(current_user),
                  db: Session = Depends(get_session)):
    response.headers["Cache-Control"] = "no-store"
    item = db.get(MenuItem, item_id)
    if item is None or item.is_archived:
        raise HTTPException(404, "Menu item not found.")
    return item
