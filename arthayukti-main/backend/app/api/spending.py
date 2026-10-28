"""Expenditure projection: the person's spending plans, scheduled changes, categories, settings, trajectory and CSV.

The trajectory and the CSV are both built by engine.spending from the stored rows, so the dashboard, the table and the
export cannot disagree. Every row is owner-scoped: another person's id answers 404.
"""

import csv
import io
import json
from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response
from pydantic import Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.common import AUTH_RESPONSES, VALIDATION_RESPONSES
from app.api.deps import get_current_user, get_db
from app.db.models import (
    ExpenditureCategory,
    ExpenditureChange,
    ExpenditurePlan,
    ExpenditureRateChange,
    ExpenditureSettings,
    User,
)
from app.engine.spending import (
    SYSTEM_CATEGORIES,
    ChangeSpec,
    PlanSpec,
    RateSchedule,
    index_year_month,
    month_index,
    monthly_totals,
    trajectory,
)
from app.errors import ApiError
from app.schemas.plan import Plan, SpendingMonth
from app.schemas.spending import (
    HORIZON_PRESETS,
    MAX_CHANGES_PER_PLAN,
    MAX_CUSTOM_CATEGORIES,
    MAX_PLANS,
    MAX_RATE_CHANGES,
    CategoryIn,
    CategoryOut,
    CategoryPatch,
    ChangeIn,
    ChangeOut,
    InflationIn,
    PlanIn,
    PlanOut,
    RateChangeOut,
    SettingsOut,
    SettingsPatch,
    SystemCategoryPatch,
    TrajectoryOut,
    TrajectoryYear,
)
from app.schemas.types import ApiModel
from app.timeline import MAX_HORIZON_MONTHS

router = APIRouter(prefix="/expenditure", tags=["expenditure-plans"], responses=AUTH_RESPONSES)

DEFAULT_GLOBAL_INFLATION = Decimal("0.060000")
SYSTEM_PREFIX = "sys:"


def _today() -> date:
    return date.today()


def _bad(message: str, code: str = "invalid_duration") -> ApiError:
    return ApiError(422, code, message)


# ---------------------------------------------------------------- settings

def _settings(db: Session, user: User) -> ExpenditureSettings:
    row = db.query(ExpenditureSettings).filter(ExpenditureSettings.user_id == user.id).first()
    if row is None:
        row = ExpenditureSettings(
            user_id=user.id, base_inflation=DEFAULT_GLOBAL_INFLATION, horizon_years=5, hidden_categories_json="[]"
        )
        db.add(row)
        try:
            db.commit()
        except IntegrityError:
            # Another request made the row first (the page asks for several things at once): use theirs.
            db.rollback()
            row = db.query(ExpenditureSettings).filter(ExpenditureSettings.user_id == user.id).one()
        else:
            db.refresh(row)
    return row


def _rate_changes(db: Session, user: User) -> list[ExpenditureRateChange]:
    return (
        db.query(ExpenditureRateChange)
        .filter(ExpenditureRateChange.user_id == user.id)
        .order_by(ExpenditureRateChange.effective_year, ExpenditureRateChange.effective_month)
        .all()
    )


def _schedule(settings: ExpenditureSettings, changes: list[ExpenditureRateChange]) -> RateSchedule:
    return RateSchedule(
        Decimal(settings.base_inflation),
        tuple((month_index(c.effective_year, c.effective_month), Decimal(c.rate)) for c in changes),
    )


def _hidden(settings: ExpenditureSettings) -> set[str]:
    return set(json.loads(settings.hidden_categories_json or "[]"))


def _settings_out(db: Session, user: User) -> SettingsOut:
    settings = _settings(db, user)
    changes = _rate_changes(db, user)
    today = _today()
    return SettingsOut(
        base_inflation=Decimal(settings.base_inflation),
        current_inflation=_schedule(settings, changes).at(month_index(today.year, today.month)),
        rate_changes=[
            RateChangeOut(id=c.id, effective_year=c.effective_year, effective_month=c.effective_month, rate=Decimal(c.rate))
            for c in changes
        ],
        horizon_years=settings.horizon_years,
        horizon_presets=list(HORIZON_PRESETS),
    )


@router.get("/settings", response_model=SettingsOut)
def read_settings(db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> SettingsOut:
    return _settings_out(db, user)


@router.put("/settings", response_model=SettingsOut, responses=VALIDATION_RESPONSES)
def update_settings(
    body: SettingsPatch, db: Session = Depends(get_db), user: User = Depends(get_current_user)
) -> SettingsOut:
    settings = _settings(db, user)
    settings.horizon_years = body.horizon_years
    db.commit()
    return _settings_out(db, user)


@router.post("/settings/inflation", response_model=SettingsOut, responses=VALIDATION_RESPONSES)
def change_inflation(
    body: InflationIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)
) -> SettingsOut:
    """Change the global rate. 'recalculate_all' applies it to the whole projection; 'from_date' keeps the earlier rate before the date."""
    settings = _settings(db, user)
    if body.mode == "recalculate_all":
        settings.base_inflation = body.rate
        db.query(ExpenditureRateChange).filter(ExpenditureRateChange.user_id == user.id).delete()
    else:
        assert body.effective_year is not None and body.effective_month is not None
        today = _today()
        if month_index(body.effective_year, body.effective_month) < month_index(today.year, today.month):
            raise _bad("A new rate cannot start in a past month.", "invalid_effective_date")
        existing = (
            db.query(ExpenditureRateChange)
            .filter(
                ExpenditureRateChange.user_id == user.id,
                ExpenditureRateChange.effective_year == body.effective_year,
                ExpenditureRateChange.effective_month == body.effective_month,
            )
            .first()
        )
        if existing is not None:
            existing.rate = body.rate
        else:
            if len(_rate_changes(db, user)) >= MAX_RATE_CHANGES:
                raise ApiError(422, "limit_reached", f"You can keep up to {MAX_RATE_CHANGES} scheduled rate changes.")
            db.add(
                ExpenditureRateChange(
                    user_id=user.id, effective_year=body.effective_year, effective_month=body.effective_month, rate=body.rate
                )
            )
    db.commit()
    return _settings_out(db, user)


@router.delete("/settings/inflation/{change_id}", response_model=SettingsOut)
def remove_rate_change(
    change_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)
) -> SettingsOut:
    row = (
        db.query(ExpenditureRateChange)
        .filter(ExpenditureRateChange.id == change_id, ExpenditureRateChange.user_id == user.id)
        .first()
    )
    if row is None:
        raise ApiError(404, "not_found", "Rate change not found.")
    db.delete(row)
    db.commit()
    return _settings_out(db, user)


# --------------------------------------------------------------- categories

def _custom(db: Session, user: User, category_id: str) -> ExpenditureCategory | None:
    return (
        db.query(ExpenditureCategory)
        .filter(ExpenditureCategory.id == category_id, ExpenditureCategory.user_id == user.id)
        .first()
    )


def _plan_counts(db: Session, user: User) -> dict[str, int]:
    counts: dict[str, int] = {}
    for plan in db.query(ExpenditurePlan).filter(ExpenditurePlan.user_id == user.id).all():
        key = plan.category_id or f"{SYSTEM_PREFIX}{plan.system_category}"
        counts[key] = counts.get(key, 0) + 1
    return counts


@router.get("/categories", response_model=list[CategoryOut])
def list_categories(db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> list[CategoryOut]:
    hidden = _hidden(_settings(db, user))
    counts = _plan_counts(db, user)
    out = [
        CategoryOut(
            id=f"{SYSTEM_PREFIX}{key}", name=name, kind="system", hidden=key in hidden, archived=False,
            plan_count=counts.get(f"{SYSTEM_PREFIX}{key}", 0),
        )
        for key, name in SYSTEM_CATEGORIES.items()
    ]
    custom = (
        db.query(ExpenditureCategory)
        .filter(ExpenditureCategory.user_id == user.id)
        .order_by(ExpenditureCategory.name)
        .all()
    )
    out += [
        CategoryOut(id=c.id, name=c.name, kind="custom", hidden=False, archived=c.archived, plan_count=counts.get(c.id, 0))
        for c in custom
    ]
    return out


def _category_out(db: Session, user: User, category_id: str) -> CategoryOut:
    return next(c for c in list_categories(db, user) if c.id == category_id)


def _name_taken(db: Session, user: User, name: str, ignore_id: str | None = None) -> bool:
    lowered = name.strip().lower()
    if lowered in {n.lower() for n in SYSTEM_CATEGORIES.values()}:
        return True
    rows = db.query(ExpenditureCategory).filter(ExpenditureCategory.user_id == user.id).all()
    return any(c.name.lower() == lowered and c.id != ignore_id for c in rows)


@router.post("/categories", response_model=CategoryOut, status_code=201, responses=VALIDATION_RESPONSES)
def create_category(
    body: CategoryIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)
) -> CategoryOut:
    if db.query(ExpenditureCategory).filter(ExpenditureCategory.user_id == user.id).count() >= MAX_CUSTOM_CATEGORIES:
        raise ApiError(422, "limit_reached", f"You can keep up to {MAX_CUSTOM_CATEGORIES} of your own categories.")
    if _name_taken(db, user, body.name):
        raise ApiError(409, "name_taken", "A category with that name already exists.")
    row = ExpenditureCategory(user_id=user.id, name=body.name)
    db.add(row)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise ApiError(409, "name_taken", "A category with that name already exists.") from None
    return _category_out(db, user, row.id)


@router.put("/categories/system/{key}", response_model=CategoryOut)
def hide_system_category(
    key: str, body: SystemCategoryPatch, db: Session = Depends(get_db), user: User = Depends(get_current_user)
) -> CategoryOut:
    """Hide or show a predefined category in this person's own list. It is never deleted for anyone."""
    if key not in SYSTEM_CATEGORIES:
        raise ApiError(404, "not_found", "Category not found.")
    settings = _settings(db, user)
    hidden = _hidden(settings)
    (hidden.add if body.hidden else hidden.discard)(key)
    settings.hidden_categories_json = json.dumps(sorted(hidden))
    db.commit()
    return _category_out(db, user, f"{SYSTEM_PREFIX}{key}")


@router.put("/categories/{category_id}", response_model=CategoryOut, responses=VALIDATION_RESPONSES)
def update_category(
    category_id: str, body: CategoryPatch, db: Session = Depends(get_db), user: User = Depends(get_current_user)
) -> CategoryOut:
    row = _custom(db, user, category_id)
    if row is None:
        raise ApiError(404, "not_found", "Category not found.")
    if body.name is not None:
        if _name_taken(db, user, body.name, ignore_id=row.id):
            raise ApiError(409, "name_taken", "A category with that name already exists.")
        row.name = body.name
    if body.archived is not None:
        row.archived = body.archived
    db.commit()
    return _category_out(db, user, row.id)


@router.delete("/categories/{category_id}", status_code=204)
def delete_category(
    category_id: str,
    reassign_to: str | None = Query(default=None, description="Where to move its plans: sys:<key> or a category id."),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Response:
    row = _custom(db, user, category_id)
    if row is None:
        raise ApiError(404, "not_found", "Category not found.")
    plans = db.query(ExpenditurePlan).filter(ExpenditurePlan.user_id == user.id, ExpenditurePlan.category_id == row.id).all()
    if plans:
        if reassign_to is None:
            raise ApiError(409, "category_in_use", f"{len(plans)} plan(s) use this category; choose where to move them first.")
        if reassign_to == row.id:
            raise _bad("Choose a different category to move the plans to.", "invalid_category")
        target_custom, target_system = _resolve_category(db, user, reassign_to, current=None)
        for plan in plans:
            plan.category_id, plan.system_category = target_custom, target_system
        db.flush()
    db.delete(row)
    db.commit()
    return Response(status_code=204)


def _resolve_category(
    db: Session, user: User, reference: str, current: ExpenditurePlan | None
) -> tuple[str | None, str | None]:
    """(custom id, system key) for a category reference. Archived or hidden ones are refused for new use only."""
    if reference.startswith(SYSTEM_PREFIX):
        key = reference[len(SYSTEM_PREFIX):]
        if key not in SYSTEM_CATEGORIES:
            raise _bad("That category does not exist.", "invalid_category")
        if key in _hidden(_settings(db, user)) and not (current and current.system_category == key):
            raise _bad("That category is hidden; show it again or pick another.", "invalid_category")
        return None, key
    row = _custom(db, user, reference)
    if row is None:
        raise _bad("That category does not exist.", "invalid_category")
    if row.archived and not (current and current.category_id == row.id):
        raise _bad("That category is archived; restore it or pick another.", "invalid_category")
    return row.id, None


# -------------------------------------------------------------------- plans

def _end_index(year: int | None, month: int | None, yearly: bool) -> int | None:
    if year is None:
        return None
    return month_index(year, 12 if yearly else (month or 12))


def _start_index(plan: ExpenditurePlan) -> int:
    return month_index(plan.start_year, plan.start_month or 1)


def _end_of(plan: ExpenditurePlan) -> int | None:
    return _end_index(plan.end_year, plan.end_month, plan.frequency == "yearly")


def _resolve_duration(body: PlanIn, today: date, existing: ExpenditurePlan | None) -> dict[str, int | None]:
    """The normalised start and end for a plan, or a 422 that says exactly what is wrong."""
    yearly = body.frequency == "yearly"
    current = month_index(today.year, today.month)
    if yearly and (body.start_month is not None or body.end_month is not None):
        raise _bad("A yearly plan is set by year; remove the month fields.")

    if body.duration == "today_forever":
        if any(v is not None for v in (body.start_year, body.start_month, body.end_year, body.end_month)):
            raise _bad("'From today to forever' takes no start or end; remove them or choose another duration.")
        kept = existing if existing and existing.duration_type == "today_forever" and existing.frequency == body.frequency else None
        if kept is not None and _start_index(kept) <= current:
            return {"start_year": kept.start_year, "start_month": kept.start_month, "end_year": None, "end_month": None}
        return {"start_year": today.year, "start_month": None if yearly else today.month, "end_year": None, "end_month": None}

    if body.start_year is None:
        raise _bad("Choose the start year.")
    if body.duration == "year_forever":
        if body.end_year is not None or body.end_month is not None or body.start_month is not None:
            raise _bad("'From this year to forever' takes only a start year.")
        if body.start_year < today.year:
            raise _bad("The start year cannot be in the past.", "start_in_past")
        if body.start_year == today.year:
            kept = existing if existing and existing.duration_type == "year_forever" and existing.start_year == body.start_year and existing.frequency == body.frequency else None
            if kept is not None and _start_index(kept) <= current:
                month = kept.start_month
            else:
                month = None if yearly else today.month
        else:
            month = None if yearly else 1
        return {"start_year": body.start_year, "start_month": month, "end_year": None, "end_month": None}

    # range
    if body.end_year is None:
        raise _bad("Choose the end year.")
    if not yearly and (body.start_month is None or body.end_month is None):
        raise _bad("A monthly plan needs a start and an end month.")
    start = month_index(body.start_year, 1 if yearly else body.start_month or 1)
    end = month_index(body.end_year, 12 if yearly else body.end_month or 12)
    unchanged = existing is not None and existing.frequency == body.frequency and _start_index(existing) == start
    if start < current and not unchanged and not (yearly and body.start_year == today.year):
        raise _bad("The start cannot be in the past.", "start_in_past")
    if yearly and body.start_year < today.year and not unchanged:
        raise _bad("The start year cannot be in the past.", "start_in_past")
    if end < start:
        raise _bad("The end must be the same as or later than the start.", "end_before_start")
    return {"start_year": body.start_year, "start_month": None if yearly else body.start_month,
            "end_year": body.end_year, "end_month": None if yearly else body.end_month}


def _owned_plan(db: Session, user: User, plan_id: str) -> ExpenditurePlan:
    plan = db.query(ExpenditurePlan).filter(ExpenditurePlan.id == plan_id, ExpenditurePlan.user_id == user.id).first()
    if plan is None:
        raise ApiError(404, "not_found", "Plan not found.")
    return plan


def _plan_out(db: Session, user: User, plan: ExpenditurePlan) -> PlanOut:
    settings = _settings(db, user)
    today = _today()
    now_rate = _schedule(settings, _rate_changes(db, user)).at(month_index(today.year, today.month))
    if plan.category_id:
        category = plan.category
        name, hidden, archived, ref = category.name, False, category.archived, category.id
    else:
        key = plan.system_category or "other"
        name, hidden, archived, ref = SYSTEM_CATEGORIES[key], key in _hidden(settings), False, f"{SYSTEM_PREFIX}{key}"
    amount = Decimal(plan.amount)
    return PlanOut(
        id=plan.id, category=ref, category_name=name, category_hidden=hidden, category_archived=archived,
        name=plan.name, amount=amount, frequency=plan.frequency,
        monthly_equivalent=(amount / 12).quantize(Decimal("0.01")) if plan.frequency == "yearly" else amount,
        duration=plan.duration_type, start_year=plan.start_year, start_month=plan.start_month,
        end_year=plan.end_year, end_month=plan.end_month,
        inflation_override=None if plan.inflation_override is None else Decimal(plan.inflation_override),
        inflation_now=Decimal(plan.inflation_override) if plan.inflation_override is not None else now_rate,
        status=plan.status,
        changes=[
            ChangeOut(
                id=c.id, kind=c.kind, effective_year=c.effective_year, effective_month=c.effective_month,
                end_year=c.end_year, end_month=c.end_month, amount=Decimal(c.amount),
            )
            for c in plan.changes
        ],
    )


@router.get("/plans", response_model=list[PlanOut])
def list_plans(db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> list[PlanOut]:
    plans = db.query(ExpenditurePlan).filter(ExpenditurePlan.user_id == user.id).order_by(ExpenditurePlan.created_at).all()
    return [_plan_out(db, user, p) for p in plans]


@router.post("/plans", response_model=PlanOut, status_code=201, responses=VALIDATION_RESPONSES)
def create_plan(body: PlanIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> PlanOut:
    if db.query(ExpenditurePlan).filter(ExpenditurePlan.user_id == user.id).count() >= MAX_PLANS:
        raise ApiError(422, "limit_reached", f"You can keep up to {MAX_PLANS} spending plans.")
    custom_id, system_key = _resolve_category(db, user, body.category, current=None)
    span = _resolve_duration(body, _today(), None)
    plan = ExpenditurePlan(
        user_id=user.id, category_id=custom_id, system_category=system_key, name=body.name, amount=body.amount,
        frequency=body.frequency, duration_type=body.duration, inflation_override=body.inflation_override,
        status="active", **span,
    )
    db.add(plan)
    db.commit()
    db.refresh(plan)
    return _plan_out(db, user, plan)


@router.put("/plans/{plan_id}", response_model=PlanOut, responses=VALIDATION_RESPONSES)
def update_plan(
    plan_id: str, body: PlanIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)
) -> PlanOut:
    plan = _owned_plan(db, user, plan_id)
    if plan.status == "stopped":
        raise ApiError(409, "plan_stopped", "Reactivate this plan before editing it.")
    if plan.changes and body.frequency != plan.frequency:
        raise _bad("Remove the scheduled changes before switching between monthly and yearly.", "frequency_locked")
    custom_id, system_key = _resolve_category(db, user, body.category, current=plan)
    span = _resolve_duration(body, _today(), plan)
    new_end = _end_index(span["end_year"], span["end_month"], body.frequency == "yearly")
    if new_end is not None:
        for change in plan.changes:
            if month_index(change.effective_year, change.effective_month or 1) > new_end:
                raise _bad("A scheduled change falls after the new end; edit or remove it first.", "orphaned_change")
    plan.category_id, plan.system_category, plan.name, plan.amount = custom_id, system_key, body.name, body.amount
    plan.frequency, plan.duration_type, plan.inflation_override = body.frequency, body.duration, body.inflation_override
    plan.start_year, plan.start_month = span["start_year"], span["start_month"]
    plan.end_year, plan.end_month = span["end_year"], span["end_month"]
    db.commit()
    db.refresh(plan)
    return _plan_out(db, user, plan)


@router.delete("/plans/{plan_id}", status_code=204)
def delete_plan(plan_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> Response:
    db.delete(_owned_plan(db, user, plan_id))
    db.commit()
    return Response(status_code=204)


@router.post("/plans/{plan_id}/stop", response_model=PlanOut)
def stop_plan(plan_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> PlanOut:
    """Stop spending from this month on. The plan, its changes and its original end are kept so it can be restored."""
    plan = _owned_plan(db, user, plan_id)
    if plan.status == "stopped":
        raise ApiError(409, "already_stopped", "This plan is already stopped.")
    today = _today()
    plan.resume_end_year, plan.resume_end_month = plan.end_year, plan.end_month
    if plan.frequency == "yearly":
        plan.end_year, plan.end_month = today.year - 1, None
    else:
        year, month = index_year_month(month_index(today.year, today.month) - 1)
        plan.end_year, plan.end_month = year, month
    plan.status = "stopped"
    db.commit()
    db.refresh(plan)
    return _plan_out(db, user, plan)


@router.post("/plans/{plan_id}/reactivate", response_model=PlanOut)
def reactivate_plan(plan_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> PlanOut:
    """Restart a stopped plan from this month. Nothing is projected for the time it was stopped; no copy is made."""
    plan = _owned_plan(db, user, plan_id)
    if plan.status != "stopped":
        raise ApiError(409, "not_stopped", "This plan is not stopped.")
    today = _today()
    yearly = plan.frequency == "yearly"
    current = month_index(today.year, today.month)
    if _start_index(plan) < current:
        plan.start_year, plan.start_month = today.year, None if yearly else today.month
    restored = (
        None
        if plan.resume_end_year is None
        else _end_index(plan.resume_end_year, plan.resume_end_month, yearly)
    )
    if restored is not None and restored >= _start_index(plan):
        plan.end_year, plan.end_month = plan.resume_end_year, plan.resume_end_month
    else:
        plan.end_year = plan.end_month = None  # it was ongoing, or its original end has passed: it restarts ongoing
    plan.resume_end_year = plan.resume_end_month = None
    plan.duration_type = "range" if plan.end_year is not None else ("today_forever" if _start_index(plan) <= current else "year_forever")
    plan.status = "active"
    db.commit()
    db.refresh(plan)
    return _plan_out(db, user, plan)


# ------------------------------------------------------------------ changes

def _check_change(plan: ExpenditurePlan, body: ChangeIn, ignore_id: str | None) -> tuple[int, int | None]:
    yearly = plan.frequency == "yearly"
    if yearly and (body.effective_month is not None or body.end_month is not None):
        raise _bad("A yearly plan's changes are set by year; remove the month fields.", "invalid_change")
    if not yearly and body.effective_month is None:
        raise _bad("Choose the month the change takes effect.", "invalid_change")
    if not yearly and body.kind == "temporary" and body.end_month is None:
        raise _bad("Choose the month the override ends.", "invalid_change")
    start = month_index(body.effective_year, body.effective_month or 1)
    end = None if body.kind == "permanent" else month_index(body.end_year or body.effective_year, 12 if yearly else body.end_month or 12)
    plan_start, plan_end = _start_index(plan), _end_of(plan)
    if start < plan_start:
        raise _bad("A change cannot take effect before the plan starts.", "invalid_change")
    if plan_end is not None and (start > plan_end or (end is not None and end > plan_end)):
        raise _bad("A change must fall within the plan's period.", "invalid_change")
    if end is not None and end < start:
        raise _bad("The override must end in or after the month it starts.", "invalid_change")
    for other in plan.changes:
        if other.id == ignore_id:
            continue
        o_start = month_index(other.effective_year, other.effective_month or 1)
        if body.kind == "permanent" and other.kind == "permanent" and o_start == start:
            raise ApiError(409, "change_overlaps", "There is already a permanent change that month.")
        if body.kind == "temporary" and other.kind == "temporary":
            o_end = month_index(other.end_year or other.effective_year, 12 if yearly else other.end_month or 12)
            if start <= o_end and o_start <= (end or start):
                raise ApiError(409, "change_overlaps", "That overlaps another temporary override.")
    return start, end


def _save_change(row: ExpenditureChange, body: ChangeIn) -> None:
    row.kind, row.effective_year, row.effective_month = body.kind, body.effective_year, body.effective_month
    row.end_year, row.end_month, row.amount = body.end_year, body.end_month, body.amount


@router.post("/plans/{plan_id}/changes", response_model=PlanOut, status_code=201, responses=VALIDATION_RESPONSES)
def add_change(
    plan_id: str, body: ChangeIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)
) -> PlanOut:
    plan = _owned_plan(db, user, plan_id)
    if plan.status == "stopped":
        raise ApiError(409, "plan_stopped", "Reactivate this plan before changing it.")
    if len(plan.changes) >= MAX_CHANGES_PER_PLAN:
        raise ApiError(422, "limit_reached", f"A plan can have up to {MAX_CHANGES_PER_PLAN} scheduled changes.")
    _check_change(plan, body, None)
    row = ExpenditureChange(plan_id=plan.id, amount=body.amount, kind=body.kind, effective_year=body.effective_year)
    _save_change(row, body)
    db.add(row)
    db.commit()
    db.refresh(plan)
    return _plan_out(db, user, plan)


def _owned_change(db: Session, user: User, plan_id: str, change_id: str) -> tuple[ExpenditurePlan, ExpenditureChange]:
    plan = _owned_plan(db, user, plan_id)
    row = next((c for c in plan.changes if c.id == change_id), None)
    if row is None:
        raise ApiError(404, "not_found", "Change not found.")
    return plan, row


@router.put("/plans/{plan_id}/changes/{change_id}", response_model=PlanOut, responses=VALIDATION_RESPONSES)
def edit_change(
    plan_id: str, change_id: str, body: ChangeIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)
) -> PlanOut:
    plan, row = _owned_change(db, user, plan_id, change_id)
    if plan.status == "stopped":
        raise ApiError(409, "plan_stopped", "Reactivate this plan before changing it.")
    _check_change(plan, body, row.id)
    _save_change(row, body)
    db.commit()
    db.refresh(plan)
    return _plan_out(db, user, plan)


@router.delete("/plans/{plan_id}/changes/{change_id}", response_model=PlanOut)
def remove_change(
    plan_id: str, change_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)
) -> PlanOut:
    plan, row = _owned_change(db, user, plan_id, change_id)
    db.delete(row)
    db.commit()
    db.refresh(plan)
    return _plan_out(db, user, plan)


# --------------------------------------------------------------- trajectory

def _specs(plans: list[ExpenditurePlan]) -> list[PlanSpec]:
    specs = []
    for plan in plans:
        yearly = plan.frequency == "yearly"
        specs.append(
            PlanSpec(
                id=plan.id, amount=Decimal(plan.amount), frequency=plan.frequency, start=_start_index(plan), end=_end_of(plan),
                override_rate=None if plan.inflation_override is None else Decimal(plan.inflation_override),
                changes=tuple(
                    ChangeSpec(
                        kind=c.kind, start=month_index(c.effective_year, c.effective_month or 1),
                        end=None if c.kind == "permanent" else month_index(c.end_year or c.effective_year, 12 if yearly else c.end_month or 12),
                        amount=Decimal(c.amount),
                    )
                    for c in plan.changes
                ),
            )
        )
    return specs


def load_spending(db: Session, user: User, as_of: str, months: int) -> tuple[dict[int, Decimal], bool] | None:
    """Spending by plan month (1 = `as_of`) from the person's active Expenditure plans, and whether any is insurance.

    None when there are no active plans, so a caller never mistakes "nothing entered" for "no spending"."""
    plans = (
        db.query(ExpenditurePlan)
        .filter(ExpenditurePlan.user_id == user.id, ExpenditurePlan.status == "active")
        .order_by(ExpenditurePlan.created_at)
        .all()
    )
    if not plans:
        return None
    schedule = _schedule(_settings(db, user), _rate_changes(db, user))
    first = int(as_of[:4]) * 12 + int(as_of[5:7]) - 1
    amounts = monthly_totals(_specs(plans), schedule, first, months)
    return {t + 1: amount for t, amount in enumerate(amounts)}, any(p.system_category == "insurance" for p in plans)


def _compute(db: Session, user: User):  # noqa: ANN202
    settings = _settings(db, user)
    plans = (
        db.query(ExpenditurePlan)
        .filter(ExpenditurePlan.user_id == user.id, ExpenditurePlan.status == "active")
        .order_by(ExpenditurePlan.created_at)
        .all()
    )
    schedule = _schedule(settings, _rate_changes(db, user))
    today = _today()
    result = trajectory(_specs(plans), schedule, today, settings.horizon_years)
    return today, settings, plans, schedule, result


class ApplyToPlanRequest(ApiModel):
    plan: Plan
    months: int = Field(default=240, ge=1, le=MAX_HORIZON_MONTHS)


@router.post("/apply-to-plan", response_model=Plan, responses=VALIDATION_RESPONSES)
def apply_to_plan(
    body: ApplyToPlanRequest, db: Session = Depends(get_db), user: User = Depends(get_current_user)
) -> Plan:
    """The plan with its spending taken month by month from the person's Expenditure plans, so the goals, scenarios, fixes and
    comparisons all read the same spending. It is a snapshot: apply it again after the plans change."""
    loaded = load_spending(db, user, body.plan.as_of, body.months)
    if loaded is None:
        raise ApiError(422, "no_expenditure_plans", "You have no active plans on the Expenditure page. Add one first.")
    amounts, _has_insurance = loaded
    first = month_index(int(body.plan.as_of[:4]), int(body.plan.as_of[5:7]))
    schedule = [
        SpendingMonth(month="{:04d}-{:02d}".format(*index_year_month(first + t - 1)), amount=amount) for t, amount in sorted(amounts.items())
    ]
    return body.plan.model_copy(update={"spending_schedule": schedule})


@router.get("/trajectory", response_model=TrajectoryOut)
def read_trajectory(db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> TrajectoryOut:
    """Annual and cumulative spending, with and without inflation, from this month for the chosen horizon."""
    today, settings, plans, schedule, result = _compute(db, user)
    return TrajectoryOut(
        starts=f"{today.year:04d}-{today.month:02d}", horizon_years=settings.horizon_years,
        horizon_months=result.horizon_months, plans_included=len(plans),
        current_inflation=schedule.at(month_index(today.year, today.month)),
        total_with_inflation=result.total_with_inflation, total_without_inflation=result.total_without_inflation,
        years=[
            TrajectoryYear(
                year=y.year, months_included=y.months_included, annual_with_inflation=y.annual_with_inflation,
                cumulative_with_inflation=y.cumulative_with_inflation,
                cumulative_without_inflation=y.cumulative_without_inflation,
            )
            for y in result.years
        ],
    )


@router.get("/trajectory.csv", response_class=Response, responses={200: {"content": {"text/csv": {}}}})
def export_trajectory(
    granularity: str = Query(default="yearly", pattern="^(yearly|monthly)$"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Response:
    """The trajectory just calculated, as UTF-8 CSV with a byte-order mark so Excel opens it with separate columns."""
    today, _settings_row, _plans, _schedule_row, result = _compute(db, user)
    out = io.StringIO()
    writer = csv.writer(out, lineterminator="\r\n")
    if granularity == "monthly":
        writer.writerow(["Year", "Month", "Expenditure with inflation", "Expenditure without inflation"])
        for row in result.months:
            writer.writerow([row.year, row.month, f"{row.with_inflation:.2f}", f"{row.without_inflation:.2f}"])
    else:
        writer.writerow(
            ["Year", "Annual expenditure with inflation", "Cumulative expenditure with inflation",
             "Cumulative expenditure without inflation", "Months included"]
        )
        for row in result.years:
            writer.writerow(
                [row.year, f"{row.annual_with_inflation:.2f}", f"{row.cumulative_with_inflation:.2f}",
                 f"{row.cumulative_without_inflation:.2f}", row.months_included]
            )
    name = f"arthayukti_expenditure_trajectory_{granularity}_{today.isoformat()}.csv"
    return Response(
        content="﻿" + out.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{name}"', "Cache-Control": "no-store"},
    )
