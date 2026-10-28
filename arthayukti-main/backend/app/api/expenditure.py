"""Planned spending projection (year by year, by line) and its CSV export.

Both are built by engine.expenditure.project_expenditure, the same monthly spending the surplus, goals and scenarios
use. Planned spending is never read from recorded transactions.
"""

import csv
import io
from decimal import Decimal

from fastapi import APIRouter, Depends
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.api.common import AUTH_RESPONSES, VALIDATION_RESPONSES
from app.api.deps import get_current_user, get_db
from app.db.models import SavedPlan, User
from app.engine.expenditure import project_expenditure
from app.errors import ApiError
from app.schemas.expenditure import (
    ExpenditureLine,
    ExpenditureProjectionRequest,
    ExpenditureProjectionResponse,
    ExpenditureYear,
)
from app.schemas.plan import Plan

router = APIRouter(prefix="/expenditure", tags=["expenditure"], responses=AUTH_RESPONSES)


def _load(req: ExpenditureProjectionRequest, db: Session, user: User) -> tuple[Plan, str]:
    if req.plan_id is not None:
        record = db.query(SavedPlan).filter(SavedPlan.id == req.plan_id, SavedPlan.user_id == user.id).first()
        if record is None:
            raise ApiError(404, "not_found", "Plan not found.")
        return Plan.model_validate_json(record.plan_json), "saved"
    assert req.plan is not None
    return req.plan, "hypothetical"


def _build(req: ExpenditureProjectionRequest, db: Session, user: User) -> ExpenditureProjectionResponse:
    plan, source = _load(req, db, user)
    result = project_expenditure(plan, req.horizon_months)
    years = [ExpenditureYear.model_validate(row) for row in result["years"]]  # type: ignore[attr-defined]
    total = years[-1].cumulative_expenditure if years else Decimal("0.00")
    return ExpenditureProjectionResponse(
        plan_source=source,
        horizon_months=req.horizon_months,
        first_month=plan.as_of,
        plan_growth_annual=plan.assumptions.expense_growth_annual,
        total_projected_expenditure=total,
        years=years,
        lines=[ExpenditureLine.model_validate(line) for line in result["lines"]],  # type: ignore[attr-defined]
    )


@router.post("/projection", response_model=ExpenditureProjectionResponse, responses=VALIDATION_RESPONSES)
def expenditure_projection(
    req: ExpenditureProjectionRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ExpenditureProjectionResponse:
    """Annual and cumulative planned spending by calendar year, with each line's yearly amounts."""
    return _build(req, db, user)


@router.post("/projection/csv", responses=VALIDATION_RESPONSES, response_class=Response)
def expenditure_projection_csv(
    req: ExpenditureProjectionRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Response:
    """The same projection as CSV: UTF-8 with a byte-order mark so Excel opens it with the right columns."""
    result = _build(req, db, user)
    out = io.StringIO()
    writer = csv.writer(out, lineterminator="\r\n")
    writer.writerow(["Year", "Months included", "Annual projected spending", "Cumulative projected spending", "Essential", "Discretionary"])
    for row in result.years:
        writer.writerow(
            [row.year, row.months_included, f"{row.annual_expenditure:.2f}", f"{row.cumulative_expenditure:.2f}", f"{row.essential:.2f}", f"{row.discretionary:.2f}"]
        )
    return Response(
        content="﻿" + out.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="arthayukti_expenditure_projection.csv"'},
    )
