"""Saved plans with database persistence and tenant isolation."""

import json
import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.common import AUTH_RESPONSES
from app.api.deps import get_current_user, get_db
from app.db.models import SavedPlan, User
from app.schemas.plan import Plan
from app.schemas.requests import PlanRecord, PlanSummary

router = APIRouter(tags=["plans"], responses=AUTH_RESPONSES)


@router.post("/plans", response_model=PlanRecord, status_code=201)
def create_plan(
    plan: Plan,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> PlanRecord:
    """Save a financial plan."""
    owner = user
    now = datetime.now(UTC)
    plan_id = str(uuid.uuid4())[:8]  # alphanumeric ID matching Id pattern

    record = SavedPlan(
        id=plan_id,
        user_id=owner.id,
        name=plan.name,
        as_of=plan.as_of,
        currency=plan.currency,
        plan_json=plan.model_dump_json(),
        created_at=now,
        updated_at=now,
    )
    db.add(record)
    db.commit()
    db.refresh(record)

    return PlanRecord(
        id=record.id,
        plan=plan,
        created_at=record.created_at.isoformat(),
        updated_at=record.updated_at.isoformat(),
    )


@router.get("/plans", response_model=list[PlanSummary])
def list_plans(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[PlanSummary]:
    """List saved plans for the current tenant."""
    owner = user
    records = (
        db.query(SavedPlan)
        .filter(SavedPlan.user_id == owner.id)
        .order_by(SavedPlan.updated_at.desc())
        .all()
    )
    return [
        PlanSummary(
            id=r.id,
            name=r.name,
            updated_at=r.updated_at.isoformat(),
        )
        for r in records
    ]


@router.get("/plans/{plan_id}", response_model=PlanRecord)
def get_plan(
    plan_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> PlanRecord:
    """Load a specific saved plan by ID."""
    owner = user
    record = (
        db.query(SavedPlan).filter(SavedPlan.id == plan_id, SavedPlan.user_id == owner.id).first()
    )
    if record is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Plan {plan_id} not found",
        )
    parsed_plan = Plan.model_validate(json.loads(record.plan_json))
    return PlanRecord(
        id=record.id,
        plan=parsed_plan,
        created_at=record.created_at.isoformat(),
        updated_at=record.updated_at.isoformat(),
    )


@router.put("/plans/{plan_id}", response_model=PlanRecord)
def update_plan(
    plan_id: str,
    plan: Plan,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> PlanRecord:
    """Update a saved plan."""
    owner = user
    record = (
        db.query(SavedPlan).filter(SavedPlan.id == plan_id, SavedPlan.user_id == owner.id).first()
    )
    if record is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Plan {plan_id} not found",
        )
    record.name = plan.name
    record.as_of = plan.as_of
    record.currency = plan.currency
    record.plan_json = plan.model_dump_json()
    record.updated_at = datetime.now(UTC)

    db.commit()
    db.refresh(record)

    return PlanRecord(
        id=record.id,
        plan=plan,
        created_at=record.created_at.isoformat(),
        updated_at=record.updated_at.isoformat(),
    )


@router.delete("/plans/{plan_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_plan(
    plan_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> None:
    """Delete a saved plan."""
    owner = user
    record = (
        db.query(SavedPlan).filter(SavedPlan.id == plan_id, SavedPlan.user_id == owner.id).first()
    )
    if record is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Plan {plan_id} not found",
        )
    db.delete(record)
    db.commit()
