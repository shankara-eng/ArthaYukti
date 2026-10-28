"""Calculation endpoints. The trade-off matrix follows in a later milestone."""

from fastapi import APIRouter

from app.api.common import VALIDATION_RESPONSES
from app.engine.compare import compare
from app.engine.fixes import find_fixes
from app.engine.projection import project
from app.engine.tradeoffs import compute_tradeoffs
from app.errors import ApiError
from app.schemas.requests import (
    CompareRequest,
    FixRequest,
    ProjectionRequest,
    TradeoffRequest,
)
from app.schemas.results import CompareResult, FixResult, ProjectionResult, TradeoffResult

router = APIRouter(tags=["analysis"])


@router.post("/projections", response_model=ProjectionResult, responses=VALIDATION_RESPONSES)
def create_projection(request: ProjectionRequest) -> ProjectionResult:
    """Baseline, shock and reprioritisation: all are a plan plus an optional scenario."""
    try:
        return project(request.plan, request.scenario, request.include_monthly)
    except ValueError as error:
        raise ApiError(422, "scenario_invalid", str(error)) from error


@router.post("/tradeoffs", response_model=TradeoffResult, responses=VALIDATION_RESPONSES)
def create_tradeoffs(request: TradeoffRequest) -> TradeoffResult:
    """Trade-off matrix: re-run the engine prioritising each goal in turn."""
    try:
        return compute_tradeoffs(request.plan, request.scenario)
    except ValueError as error:
        raise ApiError(422, "scenario_invalid", str(error)) from error


@router.post("/fixes", response_model=FixResult, responses=VALIDATION_RESPONSES)
def create_fixes(request: FixRequest) -> FixResult:
    """Verified minimal changes that bring the failing goals back on time."""
    try:
        return find_fixes(request.plan, request.scenario)
    except ValueError as error:
        raise ApiError(422, "scenario_invalid", str(error)) from error


@router.post("/compare", response_model=CompareResult, responses=VALIDATION_RESPONSES)
def compare_scenarios(request: CompareRequest) -> CompareResult:
    """Two or three scenarios side by side, measured against the first."""
    try:
        return compare(request.plan, request.scenarios)
    except ValueError as error:
        raise ApiError(422, "scenario_invalid", str(error)) from error
