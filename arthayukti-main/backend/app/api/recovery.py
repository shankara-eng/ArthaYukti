"""Plan B: find recovery options, compare them, and keep a versioned Recovery Agreement.

Everything is computed by the deterministic engine in `app/engine/recovery_*.py`. A saved agreement stores only the
draft the person chose (their situation, adjustments, restoration rules and words); the evaluation is recomputed
every time it is read, so a stored or client-sent total is never trusted. Agreements belong to one user.
"""

from datetime import UTC, datetime

from fastapi import APIRouter, Depends
from fastapi.responses import Response
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.common import AUTH_RESPONSES, VALIDATION_RESPONSES
from app.api.deps import get_current_user, get_db
from app.db.models import RecoveryAgreement, RecoveryAgreementVersion, User
from app.engine.recovery_compare import compare, describe
from app.engine.recovery_eval import evaluate_recovery
from app.engine.recovery_review import review_agreement
from app.engine.recovery_search import RecoverySearchError, run_search
from app.errors import ApiError
from app.schemas.recovery import RecoveryEvaluation, RecoveryInput
from app.schemas.recovery_plan import (
    MAX_AGREEMENTS,
    AgreementCreate,
    AgreementDraft,
    AgreementOut,
    AgreementRevise,
    AgreementSummary,
    RecoverySearchRequest,
    RecoverySearchResponse,
    ReviewRequest,
    ReviewResult,
    VersionChange,
    VersionSummary,
)

router = APIRouter(prefix="/recovery", tags=["recovery"], responses=AUTH_RESPONSES)

LIMITATIONS = [
    "This agreement records a plan you chose. It is not a guarantee that your income or your recovery will happen as modelled.",
    "Figures come from your own inputs. No investment returns, inflation, borrowing or asset sales are modelled.",
    "Goal delays are not calculated; the rupees of contributions deferred are shown instead.",
    "A review date does not mean you have recovered. Restoration happens only when the conditions you set are met.",
]


def _stamp(value: datetime) -> str:
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    return value.isoformat()


@router.post("/evaluate", response_model=RecoveryEvaluation, responses=VALIDATION_RESPONSES)
def evaluate(inp: RecoveryInput, user: User = Depends(get_current_user)) -> RecoveryEvaluation:
    """Run one specified plan month by month."""
    return evaluate_recovery(inp)


@router.post("/search", response_model=RecoverySearchResponse, responses=VALIDATION_RESPONSES)
def search(
    req: RecoverySearchRequest, user: User = Depends(get_current_user)
) -> RecoverySearchResponse:
    """Search the changes you allow and compare the plans that satisfy every rule."""
    try:
        outcome = run_search(req)
    except RecoverySearchError as exc:
        raise ApiError(422, "search_failed", str(exc)) from None
    return compare(outcome, req.limits.max_options)


# ---- agreements -------------------------------------------------------------------------------------------------


def _owned(db: Session, user: User, agreement_id: str) -> RecoveryAgreement:
    record = (
        db.query(RecoveryAgreement)
        .filter(RecoveryAgreement.id == agreement_id, RecoveryAgreement.user_id == user.id)
        .first()
    )
    if record is None:
        raise ApiError(404, "not_found", "Agreement not found.")
    return record


def _load(version: RecoveryAgreementVersion) -> AgreementDraft:
    try:
        return AgreementDraft.model_validate_json(version.draft_json)
    except ValueError:
        raise ApiError(
            500, "agreement_unreadable", "This saved agreement could not be read safely."
        ) from None


def _facets(draft: AgreementDraft) -> dict[str, str]:
    inp = draft.input
    items = {i.id: i for i in inp.items}
    labels = {i.id: i.label for i in inp.items}
    out: dict[str, str] = {
        "Reserve floor": f"Rs {inp.reserve_floor:,.2f}",
        "Starting liquid cash": f"Rs {inp.liquid_cash:,.2f}",
        "Review month": inp.review_month or "none",
        "Recovery confirmed from": inp.recovery_confirmed_from or "not confirmed",
        "Chosen plan": draft.selected_label or "none",
        "Why you chose it": draft.rationale or "none",
        "If recovery has not happened": draft.fallback_note or "none",
        "Adjustments": "; ".join(describe(a, items) for a in inp.adjustments) or "none",
        "Restoration rules": "; ".join(
            f"{labels[r.item_id]}: "
            + " and ".join(
                {
                    "income_at_least": f"income at least Rs {c.amount}"
                    if c.amount is not None
                    else "",
                    "liquid_at_least": f"cash at least Rs {c.amount}"
                    if c.amount is not None
                    else "",
                    "user_confirmed": "you confirm recovery",
                    "date_reached": f"{c.month} reached",
                }[c.type]
                for c in r.conditions
            )
            + (f", steps {', '.join(str(s) for s in r.steps)}" if r.steps else ", all at once")
            + ("" if r.affordability_guard else ", no affordability guard")
            for r in inp.restorations
        )
        or "none",
        "Allowed changes": "; ".join(
            f"{labels[p.item_id]}: {p.action}"
            + (
                f" up to {p.max_months} months"
                if p.max_months
                else f" to no less than Rs {p.min_monthly}"
            )
            for p in inp.permissions
        )
        or "none",
    }
    for i in inp.items:
        out[f"{i.label} (monthly)"] = f"Rs {i.monthly:,.2f}"
    return out


def _changes(previous: AgreementDraft | None, current: AgreementDraft) -> list[VersionChange]:
    if previous is None:
        return []
    before, after = _facets(previous), _facets(current)
    return [
        VersionChange(
            field=k, before=before.get(k, "not present"), after=after.get(k, "not present")
        )
        for k in after
        if before.get(k) != after[k]
    ]


def _out(
    record: RecoveryAgreement, version: RecoveryAgreementVersion | None = None
) -> AgreementOut:
    versions = list(record.versions)
    chosen = version or versions[-1]
    previous = next((v for v in versions if v.version == chosen.version - 1), None)
    draft = _load(chosen)
    return AgreementOut(
        id=record.id,
        name=record.name,
        version=chosen.version,
        created_at=_stamp(record.created_at),
        updated_at=_stamp(chosen.created_at),
        draft=draft,
        evaluation=evaluate_recovery(draft.input),
        changes_from_previous=_changes(_load(previous) if previous else None, draft),
        versions=[
            VersionSummary(
                version=v.version,
                created_at=_stamp(v.created_at),
                change_note=v.change_note,
                selected_label=v.selected_label,
            )
            for v in versions
        ],
        limitations=LIMITATIONS,
    )


def _require_feasible(draft: AgreementDraft) -> None:
    evaluation = evaluate_recovery(draft.input)
    if not evaluation.feasible:
        raise ApiError(
            422,
            "plan_not_feasible",
            "This plan breaks your own rules, so it cannot be saved as an agreement: "
            + evaluation.violations[0].message,
        )


@router.post(
    "/agreements", response_model=AgreementOut, status_code=201, responses=VALIDATION_RESPONSES
)
def create_agreement(
    body: AgreementCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)
) -> AgreementOut:
    """Save the chosen plan as version 1. Sending the same `client_token` again returns the agreement already saved."""
    if body.client_token:
        existing = (
            db.query(RecoveryAgreement)
            .filter(
                RecoveryAgreement.user_id == user.id,
                RecoveryAgreement.client_token == body.client_token,
            )
            .first()
        )
        if existing is not None:
            return _out(existing)
    if (
        db.query(RecoveryAgreement).filter(RecoveryAgreement.user_id == user.id).count()
        >= MAX_AGREEMENTS
    ):
        raise ApiError(422, "limit_reached", f"You can keep up to {MAX_AGREEMENTS} agreements.")
    _require_feasible(body.draft)
    record = RecoveryAgreement(
        user_id=user.id, name=body.name, current_version=1, client_token=body.client_token
    )
    record.versions.append(
        RecoveryAgreementVersion(
            version=1,
            draft_json=body.draft.model_dump_json(),
            change_note="First version.",
            selected_label=body.draft.selected_label,
        )
    )
    db.add(record)
    try:
        db.commit()  # the agreement and its first version are saved together or not at all
    except IntegrityError:
        db.rollback()
        raise ApiError(409, "name_taken", "You already have an agreement with that name.") from None
    db.refresh(record)
    return _out(record)


@router.get("/agreements", response_model=list[AgreementSummary])
def list_agreements(
    db: Session = Depends(get_db), user: User = Depends(get_current_user)
) -> list[AgreementSummary]:
    records = (
        db.query(RecoveryAgreement)
        .filter(RecoveryAgreement.user_id == user.id)
        .order_by(RecoveryAgreement.updated_at.desc())
        .all()
    )
    out: list[AgreementSummary] = []
    for r in records:
        latest = r.versions[-1]
        draft = _load(latest)
        out.append(
            AgreementSummary(
                id=r.id,
                name=r.name,
                version=latest.version,
                updated_at=_stamp(latest.created_at),
                feasible=evaluate_recovery(draft.input).feasible,
                review_month=draft.input.review_month,
            )
        )
    return out


@router.get("/agreements/{agreement_id}", response_model=AgreementOut)
def get_agreement(
    agreement_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)
) -> AgreementOut:
    return _out(_owned(db, user, agreement_id))


@router.get("/agreements/{agreement_id}/versions/{version}", response_model=AgreementOut)
def get_version(
    agreement_id: str,
    version: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> AgreementOut:
    record = _owned(db, user, agreement_id)
    found = next((v for v in record.versions if v.version == version), None)
    if found is None:
        raise ApiError(404, "not_found", "Version not found.")
    return _out(record, found)


@router.put(
    "/agreements/{agreement_id}", response_model=AgreementOut, responses=VALIDATION_RESPONSES
)
def revise_agreement(
    agreement_id: str,
    body: AgreementRevise,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> AgreementOut:
    """Add a new version. The previous one is kept. `expected_version` must match the latest, or nothing is saved."""
    record = _owned(db, user, agreement_id)
    if body.expected_version != record.current_version:
        raise ApiError(
            409,
            "version_conflict",
            f"This agreement is now at version {record.current_version}; you were editing version {body.expected_version}. Reload it first.",
        )
    _require_feasible(body.draft)
    next_version = record.current_version + 1
    record.versions.append(
        RecoveryAgreementVersion(
            version=next_version,
            draft_json=body.draft.model_dump_json(),
            change_note=body.change_note,
            selected_label=body.draft.selected_label,
        )
    )
    record.current_version = next_version
    record.updated_at = datetime.now(UTC)
    if body.name:
        record.name = body.name
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise ApiError(
            409, "name_taken", "That name is taken, or this version was saved by another request."
        ) from None
    db.refresh(record)
    return _out(record)


@router.post(
    "/agreements/{agreement_id}/review", response_model=ReviewResult, responses=VALIDATION_RESPONSES
)
def review(
    agreement_id: str,
    body: ReviewRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ReviewResult:
    """Check the latest version against today's figures. Nothing is saved or changed."""
    record = _owned(db, user, agreement_id)
    try:
        return review_agreement(_load(record.versions[-1]), body)
    except ValueError as exc:
        raise ApiError(422, "review_invalid", str(exc).splitlines()[0]) from None


@router.delete("/agreements/{agreement_id}", status_code=204)
def delete_agreement(
    agreement_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)
) -> Response:
    db.delete(_owned(db, user, agreement_id))
    db.commit()
    return Response(status_code=204)
