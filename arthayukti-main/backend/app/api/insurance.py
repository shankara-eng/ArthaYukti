import json
import uuid
from datetime import UTC, datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.common import AUTH_RESPONSES
from app.api.deps import get_current_user, get_db
from app.db.models import (
    CoverageEscalation,
    CoverageEscalationHistory,
    InsurancePolicy,
    InsuranceReminder,
    User,
)
from app.engine.insurance import (
    calculate_escalation_step,
    compute_next_escalation_date,
)
from app.schemas.insurance import (
    EscalationCreateRequest,
    EscalationHistoryResponse,
    EscalationResponse,
    InsuranceDashboardSummary,
    InsuranceReminderItem,
    PolicyCreateRequest,
    PolicyResponse,
    ProcessEscalationEventRequest,
)

router = APIRouter(prefix="/insurance", tags=["insurance"], responses=AUTH_RESPONSES)


# =========================================================================
# Insurance Policies
# =========================================================================


@router.post("/policies", response_model=PolicyResponse, status_code=status.HTTP_201_CREATED)
def create_policy(
    req: PolicyCreateRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> PolicyResponse:
    """Create a new normalized insurance policy."""
    owner = user
    policy_id = str(uuid.uuid4())
    details_str = json.dumps(req.policy_details) if req.policy_details else None

    policy = InsurancePolicy(
        id=policy_id,
        user_id=owner.id,
        policy_number=req.policy_number,
        policy_type=req.policy_type,
        insurer_name=req.insurer_name,
        plan_name=req.plan_name,
        start_date=req.start_date,
        renewal_date=req.renewal_date,
        expiry_date=req.expiry_date,
        base_sum_assured=req.base_sum_assured,
        current_effective_sum_assured=req.base_sum_assured,
        premium_amount=req.premium_amount,
        premium_frequency=req.premium_frequency,
        status=req.status,
        policy_details_json=details_str,
    )
    db.add(policy)
    db.commit()
    db.refresh(policy)

    return _to_policy_response(policy)


@router.get("/policies", response_model=list[PolicyResponse])
def list_policies(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[PolicyResponse]:
    """List all insurance policies belonging to the current user."""
    owner = user
    policies = (
        db.query(InsurancePolicy)
        .filter(InsurancePolicy.user_id == owner.id)
        .order_by(InsurancePolicy.created_at.desc())
        .all()
    )
    return [_to_policy_response(p) for p in policies]


@router.get("/policies/{policy_id}", response_model=PolicyResponse)
def get_policy(
    policy_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> PolicyResponse:
    """Get insurance policy by ID with tenant isolation."""
    owner = user
    policy = (
        db.query(InsurancePolicy)
        .filter(InsurancePolicy.id == policy_id, InsurancePolicy.user_id == owner.id)
        .first()
    )
    if not policy:
        raise HTTPException(status_code=404, detail="Policy not found")
    return _to_policy_response(policy)


@router.delete("/policies/{policy_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_policy(
    policy_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> None:
    """Delete an insurance policy and associated schedules."""
    owner = user
    policy = (
        db.query(InsurancePolicy)
        .filter(InsurancePolicy.id == policy_id, InsurancePolicy.user_id == owner.id)
        .first()
    )
    if not policy:
        raise HTTPException(status_code=404, detail="Policy not found")
    db.delete(policy)
    db.commit()


# =========================================================================
# Coverage Escalation
# =========================================================================


@router.post("/escalations", response_model=EscalationResponse, status_code=status.HTTP_201_CREATED)
def create_escalation(
    req: EscalationCreateRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> EscalationResponse:
    """Create a coverage escalation schedule for a verified policy."""
    owner = user
    policy = (
        db.query(InsurancePolicy)
        .filter(InsurancePolicy.id == req.policy_id, InsurancePolicy.user_id == owner.id)
        .first()
    )
    if not policy:
        raise HTTPException(status_code=404, detail="Policy not found or unauthorized")

    first_date = req.first_escalation_date or policy.start_date
    next_date = compute_next_escalation_date(
        first_date, req.escalation_frequency, req.custom_interval_months
    )

    esc_id = str(uuid.uuid4())
    escalation = CoverageEscalation(
        id=esc_id,
        user_id=owner.id,
        policy_id=policy.id,
        escalation_type=req.escalation_type,
        base_sum_assured=policy.base_sum_assured,
        current_effective_sum_assured=policy.current_effective_sum_assured,
        escalation_rate=req.escalation_rate,
        fixed_escalation_amount=req.fixed_escalation_amount,
        escalation_frequency=req.escalation_frequency,
        custom_interval_months=req.custom_interval_months,
        first_escalation_date=first_date,
        next_escalation_date=next_date,
        maximum_total_cover=req.maximum_total_cover,
        maximum_increase_percentage=req.maximum_increase_percentage,
        maximum_cover_multiple=Decimal(str(req.maximum_cover_multiple))
        if req.maximum_cover_multiple
        else None,
        premium_increases_with_cover=req.premium_increases_with_cover,
        premium_change_rule=req.premium_change_rule,
        medical_underwriting_required=req.medical_underwriting_required,
        age_limit=req.age_limit,
        escalation_status="active",
        escalation_terms=req.escalation_terms,
        notes=req.notes,
    )
    db.add(escalation)
    db.commit()
    db.refresh(escalation)

    # Automatically register an upcoming increase reminder
    reminder = InsuranceReminder(
        user_id=owner.id,
        policy_id=policy.id,
        reminder_type="upcoming_increase",
        due_date=next_date,
        message=f"Scheduled coverage escalation for {policy.plan_name} on {next_date}.",
    )
    db.add(reminder)
    db.commit()

    return _to_escalation_response(escalation)


@router.get("/escalations/{escalation_id}", response_model=EscalationResponse)
def get_escalation(
    escalation_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> EscalationResponse:
    """Retrieve coverage escalation configuration."""
    owner = user
    esc = (
        db.query(CoverageEscalation)
        .filter(CoverageEscalation.id == escalation_id, CoverageEscalation.user_id == owner.id)
        .first()
    )
    if not esc:
        raise HTTPException(status_code=404, detail="Escalation not found")
    return _to_escalation_response(esc)


@router.post("/escalations/{escalation_id}/process-event", response_model=EscalationHistoryResponse)
def process_escalation_event(
    escalation_id: str,
    req: ProcessEscalationEventRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> EscalationHistoryResponse:
    """Process an escalation increase event deterministically with idempotency protection."""
    owner = user
    esc = (
        db.query(CoverageEscalation)
        .filter(CoverageEscalation.id == escalation_id, CoverageEscalation.user_id == owner.id)
        .first()
    )
    if not esc:
        raise HTTPException(status_code=404, detail="Escalation record not found")

    policy = db.query(InsurancePolicy).filter(InsurancePolicy.id == esc.policy_id).first()
    if not policy:
        raise HTTPException(status_code=404, detail="Associated policy not found")

    effective_date = (
        req.effective_date or esc.next_escalation_date or datetime.now(UTC).strftime("%Y-%m-%d")
    )
    idempotency_key = req.idempotency_key or f"esc_{esc.id}_{effective_date}_{req.event_type}"

    # Check for duplicate event processing (idempotency guard)
    existing_history = (
        db.query(CoverageEscalationHistory)
        .filter(
            CoverageEscalationHistory.escalation_id == esc.id,
            CoverageEscalationHistory.idempotency_key == idempotency_key,
        )
        .first()
    )
    if existing_history:
        return _to_history_response(existing_history)

    # Count prior completed events
    completed_steps = (
        db.query(CoverageEscalationHistory)
        .filter(CoverageEscalationHistory.escalation_id == esc.id)
        .count()
    )

    # Calculate step
    calc = calculate_escalation_step(
        base_cover=esc.base_sum_assured,
        current_cover=esc.current_effective_sum_assured,
        escalation_type=esc.escalation_type,
        completed_steps=completed_steps,
        rate=esc.escalation_rate,
        fixed_amount=esc.fixed_escalation_amount,
        max_total_cover=esc.maximum_total_cover,
        max_increase_pct=esc.maximum_increase_percentage,
        max_cover_multiple=esc.maximum_cover_multiple,
        age_limit=esc.age_limit,
        current_premium=policy.premium_amount,
        medical_underwriting_required=esc.medical_underwriting_required,
    )

    # Persist history
    history = CoverageEscalationHistory(
        id=str(uuid.uuid4()),
        escalation_id=esc.id,
        policy_id=policy.id,
        effective_date=effective_date,
        event_type=req.event_type,
        prior_cover=calc.prior_cover,
        increase_amount=calc.increase_amount,
        resulting_cover=calc.resulting_cover,
        premium_before=policy.premium_amount,
        premium_after=calc.new_premium if not calc.unverified_premium else policy.premium_amount,
        underwriting_requirement="Medical Underwriting Required"
        if calc.underwriting_required
        else None,
        source="SYSTEM_CALCULATION",
        calculation_version="v1.0",
        notes=req.notes or calc.cap_reason,
        idempotency_key=idempotency_key,
    )
    db.add(history)

    # Update current covers
    esc.current_effective_sum_assured = calc.resulting_cover
    policy.current_effective_sum_assured = calc.resulting_cover
    if calc.new_premium and not calc.unverified_premium:
        policy.premium_amount = calc.new_premium

    if calc.is_terminal:
        esc.escalation_status = "completed"
        esc.next_escalation_date = None
    else:
        esc.next_escalation_date = compute_next_escalation_date(
            effective_date, esc.escalation_frequency, esc.custom_interval_months
        )

    db.commit()
    db.refresh(history)

    return _to_history_response(history)


@router.get("/escalations/{escalation_id}/history", response_model=list[EscalationHistoryResponse])
def get_escalation_history(
    escalation_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[EscalationHistoryResponse]:
    """Get audit trail of all completed escalation events."""
    owner = user
    esc = (
        db.query(CoverageEscalation)
        .filter(CoverageEscalation.id == escalation_id, CoverageEscalation.user_id == owner.id)
        .first()
    )
    if not esc:
        raise HTTPException(status_code=404, detail="Escalation record not found")

    items = (
        db.query(CoverageEscalationHistory)
        .filter(CoverageEscalationHistory.escalation_id == esc.id)
        .order_by(CoverageEscalationHistory.effective_date.desc())
        .all()
    )
    return [_to_history_response(i) for i in items]


# =========================================================================
# Dashboard & Reminders
# =========================================================================


@router.get("/dashboard", response_model=InsuranceDashboardSummary)
def get_insurance_dashboard(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> InsuranceDashboardSummary:
    """Return aggregated insurance dashboard metrics across all policies."""
    owner = user
    policies = db.query(InsurancePolicy).filter(InsurancePolicy.user_id == owner.id).all()
    escalations = (
        db.query(CoverageEscalation)
        .filter(
            CoverageEscalation.user_id == owner.id, CoverageEscalation.escalation_status == "active"
        )
        .all()
    )
    reminders = (
        db.query(InsuranceReminder)
        .filter(InsuranceReminder.user_id == owner.id, InsuranceReminder.is_acknowledged.is_(False))
        .all()
    )

    total_base = sum((p.base_sum_assured for p in policies), Decimal("0.00"))
    total_effective = sum((p.current_effective_sum_assured for p in policies), Decimal("0.00"))
    total_growth = total_effective - total_base

    # Next increase
    next_increase_amt = None
    next_increase_date = None
    if escalations:
        sorted_esc = sorted(
            [e for e in escalations if e.next_escalation_date],
            key=lambda e: e.next_escalation_date,
        )
        if sorted_esc:
            earliest = sorted_esc[0]
            next_increase_date = earliest.next_escalation_date
            if earliest.fixed_escalation_amount:
                next_increase_amt = earliest.fixed_escalation_amount
            elif earliest.escalation_rate:
                next_increase_amt = (earliest.base_sum_assured * earliest.escalation_rate).quantize(
                    Decimal("0.01")
                )

    # Health policies NCB
    health_policies = [p for p in policies if p.policy_type == "health"]
    effective_health = sum(
        (p.current_effective_sum_assured for p in health_policies), Decimal("0.00")
    )
    base_health = sum((p.base_sum_assured for p in health_policies), Decimal("0.00"))
    health_ncb = effective_health - base_health

    max_possible = None
    caps = [e.maximum_total_cover for e in escalations if e.maximum_total_cover]
    if caps:
        max_possible = sum(caps, Decimal("0.00"))

    return InsuranceDashboardSummary(
        total_base_cover=total_base,
        total_effective_cover=total_effective,
        total_cover_growth=total_growth,
        next_increase_amount=next_increase_amt,
        next_increase_date=next_increase_date,
        maximum_possible_cover=max_possible,
        health_ncb_total=health_ncb,
        effective_health_sum_insured=effective_health,
        upcoming_alerts_count=len(reminders),
    )


@router.get("/reminders", response_model=list[InsuranceReminderItem])
def list_reminders(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[InsuranceReminderItem]:
    """List active insurance reminders and policy alerts."""
    owner = user
    reminders = (
        db.query(InsuranceReminder)
        .filter(InsuranceReminder.user_id == owner.id, InsuranceReminder.is_acknowledged.is_(False))
        .order_by(InsuranceReminder.due_date.asc())
        .all()
    )
    return [
        InsuranceReminderItem(
            id=r.id,
            policy_id=r.policy_id,
            reminder_type=r.reminder_type,
            due_date=r.due_date,
            message=r.message,
            is_acknowledged=r.is_acknowledged,
        )
        for r in reminders
    ]


@router.post("/reminders/{reminder_id}/ack")
def acknowledge_reminder(
    reminder_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    """Acknowledge and dismiss an insurance alert."""
    owner = user
    reminder = (
        db.query(InsuranceReminder)
        .filter(InsuranceReminder.id == reminder_id, InsuranceReminder.user_id == owner.id)
        .first()
    )
    if not reminder:
        raise HTTPException(status_code=404, detail="Reminder not found")
    reminder.is_acknowledged = True
    db.commit()
    return {"status": "acknowledged"}


# =========================================================================
# Serializers
# =========================================================================


def _to_policy_response(p: InsurancePolicy) -> PolicyResponse:
    details = json.loads(p.policy_details_json) if p.policy_details_json else None
    return PolicyResponse(
        id=p.id,
        policy_number=p.policy_number,
        policy_type=p.policy_type,
        insurer_name=p.insurer_name,
        plan_name=p.plan_name,
        start_date=p.start_date,
        renewal_date=p.renewal_date,
        expiry_date=p.expiry_date,
        base_sum_assured=p.base_sum_assured,
        current_effective_sum_assured=p.current_effective_sum_assured,
        premium_amount=p.premium_amount,
        premium_frequency=p.premium_frequency,
        status=p.status,
        policy_details=details,
        created_at=p.created_at.isoformat(),
        updated_at=p.updated_at.isoformat(),
    )


def _to_escalation_response(e: CoverageEscalation) -> EscalationResponse:
    return EscalationResponse(
        id=e.id,
        policy_id=e.policy_id,
        escalation_type=e.escalation_type,
        base_sum_assured=e.base_sum_assured,
        current_effective_sum_assured=e.current_effective_sum_assured,
        escalation_rate=e.escalation_rate,
        fixed_escalation_amount=e.fixed_escalation_amount,
        escalation_frequency=e.escalation_frequency,
        custom_interval_months=e.custom_interval_months,
        first_escalation_date=e.first_escalation_date,
        next_escalation_date=e.next_escalation_date,
        maximum_total_cover=e.maximum_total_cover,
        maximum_increase_percentage=e.maximum_increase_percentage,
        maximum_cover_multiple=e.maximum_cover_multiple,
        premium_increases_with_cover=e.premium_increases_with_cover,
        medical_underwriting_required=e.medical_underwriting_required,
        age_limit=e.age_limit,
        escalation_status=e.escalation_status,
        notes=e.notes,
        created_at=e.created_at.isoformat(),
        updated_at=e.updated_at.isoformat(),
    )


def _to_history_response(h: CoverageEscalationHistory) -> EscalationHistoryResponse:
    return EscalationHistoryResponse(
        id=h.id,
        escalation_id=h.escalation_id,
        policy_id=h.policy_id,
        effective_date=h.effective_date,
        event_type=h.event_type,
        prior_cover=h.prior_cover,
        increase_amount=h.increase_amount,
        resulting_cover=h.resulting_cover,
        premium_before=h.premium_before,
        premium_after=h.premium_after,
        underwriting_requirement=h.underwriting_requirement,
        source=h.source,
        idempotency_key=h.idempotency_key,
        created_at=h.created_at.isoformat(),
    )
