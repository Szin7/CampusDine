from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import Principal, require_admin
from app.db import get_session
from app.models import MenuItem
from app.schemas import MenuCreate, MenuUpdate, MenuView

router = APIRouter(prefix="/admin/menu", tags=["Admin menu"])


@router.get("", response_model=list[MenuView])
def list_menu(response: Response, include_archived: bool = False,
              limit: int = Query(100, ge=1, le=200), offset: int = Query(0, ge=0),
              user: Principal = Depends(require_admin), db: Session = Depends(get_session)):
    response.headers["Cache-Control"] = "no-store"
    query = select(MenuItem)
    if not include_archived:
        query = query.where(MenuItem.is_archived.is_(False))
    return db.scalars(query.order_by(MenuItem.is_archived, MenuItem.category, MenuItem.name, MenuItem.id)
                      .offset(offset).limit(limit)).all()


@router.post("", response_model=MenuView, status_code=201)
def create_item(body: MenuCreate, user: Principal = Depends(require_admin), db: Session = Depends(get_session)):
    item = MenuItem(**body.model_dump())
    db.add(item)
    db.commit()
    return item


@router.patch("/{item_id}", response_model=MenuView)
def update_item(item_id: int, body: MenuUpdate, user: Principal = Depends(require_admin),
                db: Session = Depends(get_session)):
    item = db.get(MenuItem, item_id)
    if item is None:
        raise HTTPException(404, "Menu item not found.")
    changes = body.model_dump(exclude_unset=True)
    if changes.get("is_archived", item.is_archived):
        if changes.get("is_available") is True:
            raise HTTPException(409, "Restore the archived item before marking it available.")
        changes["is_available"] = False
    for field, value in changes.items():
        setattr(item, field, value)
    db.commit()
    return item
