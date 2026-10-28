"""Investment calculators: valuation, scenario comparison, CSV export and saved scenarios.

Every figure comes from engine.calculators.run, so the screen, the compiled report, the comparison and
the CSV always agree. Saved scenarios belong to the signed-in user only.
"""

import csv
import io
from datetime import UTC, datetime

from fastapi import APIRouter, Depends
from fastapi.responses import Response
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.common import AUTH_RESPONSES, VALIDATION_RESPONSES
from app.api.deps import get_current_user, get_db
from app.db.models import CalculatorScenario, User
from app.engine.calculators import pending_decisions, run
from app.errors import ApiError
from app.schemas.calculators import (
    MAX_SAVED_SCENARIOS,
    CalcCompareEntry,
    CalcCompareRequest,
    CalcCompareResponse,
    CalcCompareRow,
    CalcScenarioIn,
    CalcScenarioOut,
    CalcScenarioSummary,
    CalculatorConfig,
    CalculatorResult,
    MaturityDecisionNeeded,
)

router = APIRouter(prefix="/calculators", tags=["calculators"], responses=AUTH_RESPONSES)


def _stamp(value: datetime) -> str:
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    return value.isoformat()


def _out(record: CalculatorScenario) -> CalcScenarioOut:
    return CalcScenarioOut(
        id=record.id,
        name=record.name,
        config=CalculatorConfig.model_validate_json(record.config_json),
        created_at=_stamp(record.created_at),
        updated_at=_stamp(record.updated_at),
    )


def _owned(db: Session, user: User, scenario_id: str) -> CalculatorScenario:
    record = (
        db.query(CalculatorScenario)
        .filter(CalculatorScenario.id == scenario_id, CalculatorScenario.user_id == user.id)
        .first()
    )
    if record is None:
        raise ApiError(404, "not_found", "Scenario not found.")
    return record


@router.post("/run", response_model=CalculatorResult, responses=VALIDATION_RESPONSES)
def run_calculator(
    config: CalculatorConfig, user: User = Depends(get_current_user)
) -> CalculatorResult:
    """Value every investment (and the compiled selection) in one pass."""
    return run(config)


@router.post(
    "/maturity-check", response_model=list[MaturityDecisionNeeded], responses=VALIDATION_RESPONSES
)
def maturity_check(
    config: CalculatorConfig, user: User = Depends(get_current_user)
) -> list[MaturityDecisionNeeded]:
    """Investments that mature before the common date and still need an explicit after-maturity decision."""
    return pending_decisions(config)


def _cell(value: object) -> str:
    """Text typed by a person, made safe to open in a spreadsheet: a leading = + - @ would run as a formula."""
    text = str(value)
    return "'" + text if text[:1] in ("=", "+", "-", "@", "\t", "\r") else text


@router.post("/export", responses=VALIDATION_RESPONSES, response_class=Response)
def export_csv(config: CalculatorConfig, user: User = Depends(get_current_user)) -> Response:
    """The same result as /run, as CSV (UTF-8 with a byte-order mark so Excel reads the columns)."""
    result = run(config)
    out = io.StringIO()
    w = csv.writer(out, lineterminator="\r\n")
    w.writerow(["ArthaYukti investment calculator"])
    w.writerow(["Valuation", result.mode, result.common_date or "end of each growth period"])
    w.writerow([])
    w.writerow(["Summary"])
    w.writerow(
        [
            "Investment",
            "Status",
            "Start",
            "Valued at",
            "Principal",
            "Value",
            "Gain or loss",
            "Tax",
            "Post-tax value",
            "Inflation-adjusted value",
        ]
    )
    for r in result.investments:
        w.writerow(
            [
                _cell(r.name),
                r.status,
                r.start_month,
                r.valuation_month or "",
                r.principal,
                r.value,
                r.gain,
                r.tax,
                r.post_tax_value,
                r.inflation_adjusted_value,
            ]
        )
    a = result.aggregate
    real = a.inflation_adjusted_value if a.inflation_adjusted_value is not None else ""
    w.writerow(["Total", "", "", "", a.principal, a.value, a.gain, a.tax, a.post_tax_value, real])
    w.writerow([])
    w.writerow(["Annual breakdown"])
    w.writerow(
        [
            "Investment",
            "Year",
            "From",
            "To",
            "Phase",
            "Instalment",
            "Opening",
            "Contributions",
            "Growth",
            "Closing",
            "Cumulative invested",
            "Cumulative gain or loss",
            "Inflation-adjusted closing",
        ]
    )
    for r in result.investments:
        for row in r.annual:
            w.writerow(
                [
                    _cell(r.name),
                    row.year,
                    row.from_month,
                    row.to_month,
                    row.phase,
                    row.instalment,
                    row.opening,
                    row.contributions,
                    row.growth,
                    row.closing,
                    row.cumulative_invested,
                    row.cumulative_gain,
                    row.inflation_adjusted_closing,
                ]
            )
    w.writerow([])
    w.writerow(
        [
            "Compiled by calendar year",
            ", ".join(_cell(i) for i in result.compilation.investment_ids),
        ]
    )
    w.writerow(
        [
            "Year",
            "Contributions",
            "Closing (growing)",
            "Matured, held",
            "Closing total",
            "Cumulative invested",
            "Cumulative gain or loss",
        ]
    )
    for y in result.compilation.years:
        w.writerow(
            [
                y.year,
                y.contributions,
                y.closing_active,
                y.matured_held,
                y.closing_total,
                y.cumulative_invested,
                y.cumulative_gain,
            ]
        )
    return Response(
        content="﻿" + out.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="arthayukti_calculator.csv"'},
    )


def _resolve(
    entry: CalcCompareEntry, db: Session, user: User, index: int
) -> tuple[CalculatorConfig, str, str | None]:
    if entry.scenario_id is not None:
        record = _owned(db, user, entry.scenario_id)
        return (
            CalculatorConfig.model_validate_json(record.config_json),
            entry.label or record.name,
            record.id,
        )
    assert entry.config is not None
    return entry.config, entry.label or f"Scenario {index + 1}", None


@router.post("/compare", response_model=CalcCompareResponse, responses=VALIDATION_RESPONSES)
def compare(
    req: CalcCompareRequest, db: Session = Depends(get_db), user: User = Depends(get_current_user)
) -> CalcCompareResponse:
    """Side-by-side totals. Each entry is valued alone: alternatives are never added to one another."""
    rows: list[CalcCompareRow] = []
    first_total = None
    for index, entry in enumerate(req.entries):
        config, label, scenario_id = _resolve(entry, db, user, index)
        if req.common_date is not None:
            config = config.model_copy(
                update={"mode": "common_date", "common_date": req.common_date, "compile_ids": None}
            )
        result = run(config)
        total = result.aggregate.post_tax_value
        first_total = total if first_total is None else first_total
        rows.append(
            CalcCompareRow(
                label=label,
                scenario_id=scenario_id,
                mode=result.mode,
                common_date=result.common_date,
                aggregate=result.aggregate,
                delta_post_tax_vs_first=total - first_total,
            )
        )
    return CalcCompareResponse(rows=rows)


@router.get("/scenarios", response_model=list[CalcScenarioSummary])
def list_scenarios(
    db: Session = Depends(get_db), user: User = Depends(get_current_user)
) -> list[CalcScenarioSummary]:
    records = (
        db.query(CalculatorScenario)
        .filter(CalculatorScenario.user_id == user.id)
        .order_by(CalculatorScenario.name)
        .all()
    )
    out = []
    for record in records:
        config = CalculatorConfig.model_validate_json(record.config_json)
        out.append(
            CalcScenarioSummary(
                id=record.id,
                name=record.name,
                investments=len(config.investments),
                mode=config.mode,
                updated_at=_stamp(record.updated_at),
            )
        )
    return out


@router.post(
    "/scenarios", response_model=CalcScenarioOut, status_code=201, responses=VALIDATION_RESPONSES
)
def create_scenario(
    body: CalcScenarioIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)
) -> CalcScenarioOut:
    count = db.query(CalculatorScenario).filter(CalculatorScenario.user_id == user.id).count()
    if count >= MAX_SAVED_SCENARIOS:
        raise ApiError(
            422, "limit_reached", f"You can keep up to {MAX_SAVED_SCENARIOS} saved scenarios."
        )
    record = CalculatorScenario(
        user_id=user.id, name=body.name, config_json=body.config.model_dump_json()
    )
    db.add(record)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise ApiError(409, "name_taken", "You already have a scenario with that name.") from None
    db.refresh(record)
    return _out(record)


@router.get("/scenarios/{scenario_id}", response_model=CalcScenarioOut)
def get_scenario(
    scenario_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)
) -> CalcScenarioOut:
    return _out(_owned(db, user, scenario_id))


@router.put(
    "/scenarios/{scenario_id}", response_model=CalcScenarioOut, responses=VALIDATION_RESPONSES
)
def update_scenario(
    scenario_id: str,
    body: CalcScenarioIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> CalcScenarioOut:
    record = _owned(db, user, scenario_id)
    record.name = body.name
    record.config_json = body.config.model_dump_json()
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise ApiError(409, "name_taken", "You already have a scenario with that name.") from None
    db.refresh(record)
    return _out(record)


@router.delete("/scenarios/{scenario_id}", status_code=204)
def delete_scenario(
    scenario_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)
) -> Response:
    db.delete(_owned(db, user, scenario_id))
    db.commit()
    return Response(status_code=204)
