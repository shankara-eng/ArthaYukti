"""Insurance and Coverage Escalation Engine.

Provides deterministic mathematical calculations for:
- Simple percentage, compound percentage, fixed amount, step-up, inflation-linked escalations
- Contract cap enforcement (max cover, max increase %, max multiple, age limit)
- Health insurance No-Claim Bonus (NCB), claim reductions, and restoration benefits (strictly no double-counting)
- Term life, ULIP, endowment/money-back, motor IDV, and home reinstatement calculations
- Reminder generation and upcoming escalation schedule
"""

from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from app.engine.money import ZERO, engine_context, quantize


@dataclass(frozen=True)
class EscalationCalculationResult:
    prior_cover: Decimal
    increase_amount: Decimal
    resulting_cover: Decimal
    cap_hit: bool
    cap_reason: str | None
    is_terminal: bool  # True if max cover or age limit reached
    unverified_premium: bool
    new_premium: Decimal | None
    underwriting_required: bool


def calculate_escalation_step(
    base_cover: Decimal,
    current_cover: Decimal,
    escalation_type: str,
    completed_steps: int,
    rate: Decimal | None = None,
    fixed_amount: Decimal | None = None,
    step_schedule: list[dict[str, Any]] | None = None,
    inflation_index_ratio: Decimal | None = None,
    max_total_cover: Decimal | None = None,
    max_increase_pct: Decimal | None = None,
    max_cover_multiple: Decimal | None = None,
    current_age: int | None = None,
    age_limit: int | None = None,
    current_premium: Decimal | None = None,
    premium_change_rule: dict[str, Any] | None = None,
    medical_underwriting_required: bool = False,
) -> EscalationCalculationResult:
    """Calculate the next escalation step according to contract rules and caps."""
    with engine_context():
        # 1. Age limit check
        if current_age is not None and age_limit is not None and current_age >= age_limit:
            return EscalationCalculationResult(
                prior_cover=current_cover,
                increase_amount=ZERO,
                resulting_cover=current_cover,
                cap_hit=True,
                cap_reason=f"Age limit of {age_limit} reached (current age {current_age})",
                is_terminal=True,
                unverified_premium=False,
                new_premium=current_premium,
                underwriting_required=False,
            )

        n = completed_steps + 1
        raw_cover = current_cover

        # 2. Compute theoretical escalated cover
        if escalation_type == "fixed_percentage":
            # C_n = C_0 * (1 + r * n) -> incremental or cumulative simple rate
            r = rate or ZERO
            raw_cover = quantize(base_cover * (Decimal(1) + r * Decimal(n)))
        elif escalation_type == "compound_percentage":
            # C_n = C_0 * (1 + r) ^ n
            r = rate or ZERO
            raw_cover = quantize(base_cover * ((Decimal(1) + r) ** Decimal(n)))
        elif escalation_type == "fixed_amount":
            # C_n = C_0 + n * A
            a = fixed_amount or ZERO
            raw_cover = quantize(base_cover + a * Decimal(n))
        elif escalation_type == "step_up":
            # Schedule-based: search for step n or fallback
            schedule = step_schedule or []
            matched = next((s for s in schedule if s.get("step") == n), None)
            if matched:
                if matched.get("rule") == "multiplicative":
                    step_r = Decimal(str(matched.get("rate", "0")))
                    raw_cover = quantize(current_cover * (Decimal(1) + step_r))
                elif matched.get("rule") == "additive_amount":
                    step_a = Decimal(str(matched.get("amount", "0")))
                    raw_cover = quantize(current_cover + step_a)
                elif matched.get("rule") == "target_cover":
                    raw_cover = quantize(Decimal(str(matched.get("target_cover"))))
                else:
                    raw_cover = current_cover
            else:
                raw_cover = current_cover
        elif escalation_type == "inflation_linked":
            # Inflation indexed: C_n = C_0 * (Index_n / Index_0)
            ratio = inflation_index_ratio if inflation_index_ratio is not None else Decimal(1)
            raw_cover = quantize(base_cover * ratio)
        elif escalation_type in ("life_event_enhancement", "bonus_accrual"):
            # Incremental fixed amount or percentage
            inc = fixed_amount or (base_cover * (rate or ZERO))
            raw_cover = quantize(current_cover + inc)
        else:
            # None or unrecognized
            raw_cover = current_cover

        # 3. Cap enforcement: min of raw cover and all applicable contract caps
        capped_cover = raw_cover
        cap_hit = False
        cap_reason = None
        is_terminal = False

        # Max total cover cap
        if max_total_cover is not None and capped_cover >= max_total_cover:
            capped_cover = min(capped_cover, max_total_cover)
            cap_hit = True
            cap_reason = f"Maximum total cover cap of {max_total_cover} reached"
            if capped_cover == max_total_cover:
                is_terminal = True

        # Max increase percentage cap (e.g. max 100% increase over base)
        if max_increase_pct is not None:
            max_allowed_from_pct = quantize(base_cover * (Decimal(1) + max_increase_pct))
            if capped_cover >= max_allowed_from_pct:
                capped_cover = min(capped_cover, max_allowed_from_pct)
                cap_hit = True
                cap_reason = f"Maximum increase percentage cap ({max_increase_pct * 100}%) reached"
                if capped_cover == max_allowed_from_pct:
                    is_terminal = True

        # Max cover multiple cap (e.g. max 2x base sum assured)
        if max_cover_multiple is not None:
            max_allowed_from_mult = quantize(base_cover * max_cover_multiple)
            if capped_cover >= max_allowed_from_mult:
                capped_cover = min(capped_cover, max_allowed_from_mult)
                cap_hit = True
                cap_reason = f"Maximum cover multiple cap ({max_cover_multiple}x) reached"
                if capped_cover == max_allowed_from_mult:
                    is_terminal = True

        # Ensure cover never decreases in an escalation
        if capped_cover < current_cover:
            capped_cover = current_cover

        increase_amount = capped_cover - current_cover

        # 4. Premium calculation rule
        new_premium = current_premium
        unverified_premium = False

        if increase_amount > ZERO and current_premium is not None:
            if premium_change_rule:
                rule_type = premium_change_rule.get("type")
                if rule_type == "proportionate":
                    new_premium = quantize(current_premium * (capped_cover / current_cover))
                elif rule_type == "rate_per_thousand":
                    add_cover_thousands = increase_amount / Decimal(1000)
                    rate_per_k = Decimal(str(premium_change_rule.get("rate_per_thousand", "0")))
                    new_premium = quantize(current_premium + add_cover_thousands * rate_per_k)
                elif rule_type == "fixed_add":
                    add_amt = Decimal(str(premium_change_rule.get("additional_amount", "0")))
                    new_premium = quantize(current_premium + add_amt)
                elif rule_type == "quote_required":
                    unverified_premium = True
                    new_premium = None
                else:
                    unverified_premium = True
            else:
                unverified_premium = True

        return EscalationCalculationResult(
            prior_cover=current_cover,
            increase_amount=increase_amount,
            resulting_cover=capped_cover,
            cap_hit=cap_hit,
            cap_reason=cap_reason,
            is_terminal=is_terminal,
            unverified_premium=unverified_premium,
            new_premium=new_premium,
            underwriting_required=medical_underwriting_required,
        )


# =========================================================================
# Policy Specific Calculations
# =========================================================================


def calculate_health_ncb(
    base_sum_insured: Decimal,
    accumulated_ncb: Decimal,
    ncb_rate_pct: Decimal,
    max_ncb_pct: Decimal,
    claim_occurred: bool,
    claim_reduction_rule: str = "percentage_reduction",  # percentage_reduction, full_reset, step_down
    reduction_pct: Decimal | None = None,
) -> dict[str, Any]:
    """Calculate Health insurance No-Claim Bonus (NCB) and effective cover.

    CRITICAL: Base cover, accumulated NCB, and restoration benefits must NEVER be double-counted.
    """
    with engine_context():
        max_ncb_amount = quantize(base_sum_insured * (max_ncb_pct / Decimal(100)))

        if claim_occurred:
            if claim_reduction_rule == "full_reset":
                new_ncb = ZERO
            elif claim_reduction_rule == "percentage_reduction":
                red_rate = (reduction_pct or ncb_rate_pct) / Decimal(100)
                reduction = quantize(base_sum_insured * red_rate)
                new_ncb = max(ZERO, accumulated_ncb - reduction)
            elif claim_reduction_rule == "step_down":
                step_amt = quantize(base_sum_insured * (ncb_rate_pct / Decimal(100)))
                new_ncb = max(ZERO, accumulated_ncb - step_amt)
            else:
                new_ncb = accumulated_ncb
        else:
            # Accrue NCB for claim-free year
            accrual = quantize(base_sum_insured * (ncb_rate_pct / Decimal(100)))
            new_ncb = min(max_ncb_amount, accumulated_ncb + accrual)

        effective_sum_insured = base_sum_insured + new_ncb

        return {
            "base_sum_insured": base_sum_insured,
            "previous_ncb": accumulated_ncb,
            "new_ncb": new_ncb,
            "max_ncb_amount": max_ncb_amount,
            "effective_sum_insured": effective_sum_insured,
            "ncb_percentage_of_base": quantize((new_ncb / base_sum_insured) * Decimal(100))
            if base_sum_insured > ZERO
            else ZERO,
            "claim_occurred": claim_occurred,
        }


def calculate_motor_idv(
    ex_showroom_price: Decimal,
    vehicle_age_months: int,
    custom_depreciation_pct: Decimal | None = None,
) -> dict[str, Any]:
    """Calculate Motor insurance Insured's Declared Value (IDV) based on IRDAI depreciation schedule."""
    with engine_context():
        if custom_depreciation_pct is not None:
            dep_pct = custom_depreciation_pct
        else:
            # Standard IRDAI depreciation schedule:
            # Up to 6 months: 5%
            # 6m - 1 yr: 15%
            # 1 yr - 2 yr: 20%
            # 2 yr - 3 yr: 30%
            # 3 yr - 4 yr: 40%
            # 4 yr - 5 yr: 50%
            # > 5 yrs: agreement/market valuation (default 60%)
            if vehicle_age_months <= 6:
                dep_pct = Decimal("5.0")
            elif vehicle_age_months <= 12:
                dep_pct = Decimal("15.0")
            elif vehicle_age_months <= 24:
                dep_pct = Decimal("20.0")
            elif vehicle_age_months <= 36:
                dep_pct = Decimal("30.0")
            elif vehicle_age_months <= 48:
                dep_pct = Decimal("40.0")
            elif vehicle_age_months <= 60:
                dep_pct = Decimal("50.0")
            else:
                dep_pct = Decimal("60.0")

        depreciation_amount = quantize(ex_showroom_price * (dep_pct / Decimal(100)))
        current_idv = max(ZERO, ex_showroom_price - depreciation_amount)

        return {
            "ex_showroom_price": ex_showroom_price,
            "vehicle_age_months": vehicle_age_months,
            "depreciation_percentage": dep_pct,
            "depreciation_amount": depreciation_amount,
            "insured_declared_value": current_idv,
        }


def calculate_ulip_projection(
    annual_premium: Decimal,
    years_completed: int,
    assumed_annual_return: Decimal,
    mortality_charge_annual: Decimal,
    fund_management_charge_pct: Decimal,
    sum_assured: Decimal,
) -> dict[str, Any]:
    """Calculate ULIP fund value and distinguish fund value from death benefit."""
    with engine_context():
        fund_value = ZERO
        net_return_rate = assumed_annual_return - (fund_management_charge_pct / Decimal(100))

        for _ in range(years_completed):
            invested_this_year = max(ZERO, annual_premium - mortality_charge_annual)
            fund_value = quantize(
                (fund_value + invested_this_year) * (Decimal(1) + net_return_rate)
            )

        # Death benefit is typically max(Sum Assured, Fund Value) for Type I, or Sum Assured + Fund Value for Type II
        death_benefit_type_1 = max(sum_assured, fund_value)
        death_benefit_type_2 = sum_assured + fund_value

        return {
            "annual_premium": annual_premium,
            "years_completed": years_completed,
            "fund_value": fund_value,
            "sum_assured": sum_assured,
            "death_benefit_type_1_max": death_benefit_type_1,
            "death_benefit_type_2_combined": death_benefit_type_2,
            "lock_in_period_years": 5,
            "is_locked_in": years_completed < 5,
        }


def calculate_endowment_bonus(
    sum_assured: Decimal,
    reversionary_bonus_rate_per_thousand: Decimal,
    years_completed: int,
    terminal_bonus_rate_pct: Decimal = Decimal(0),
    is_maturity: bool = False,
) -> dict[str, Any]:
    """Calculate accrued bonuses for traditional with-profits endowment policies."""
    with engine_context():
        # Reversionary bonus: usually per Rs 1000 of sum assured per year
        annual_rev_bonus = quantize(
            (sum_assured / Decimal(1000)) * reversionary_bonus_rate_per_thousand
        )
        accrued_reversionary_bonus = quantize(annual_rev_bonus * Decimal(years_completed))

        terminal_bonus = ZERO
        if is_maturity and terminal_bonus_rate_pct > ZERO:
            terminal_bonus = quantize(sum_assured * (terminal_bonus_rate_pct / Decimal(100)))

        total_effective_benefit = sum_assured + accrued_reversionary_bonus + terminal_bonus

        return {
            "sum_assured_guaranteed": sum_assured,
            "annual_reversionary_bonus": annual_rev_bonus,
            "accrued_reversionary_bonus": accrued_reversionary_bonus,
            "terminal_bonus_non_guaranteed": terminal_bonus,
            "total_effective_benefit": total_effective_benefit,
            "years_completed": years_completed,
        }


def calculate_home_insurance_valuation(
    built_up_area_sqft: Decimal,
    construction_cost_per_sqft: Decimal,
    content_value: Decimal,
    land_market_value: Decimal,
) -> dict[str, Any]:
    """Calculate home insurance reinstatement value (strictly separate from land value)."""
    with engine_context():
        # Structure reinstatement cost = built up area * construction cost
        structure_reinstatement_value = quantize(built_up_area_sqft * construction_cost_per_sqft)
        total_sum_insured = structure_reinstatement_value + content_value

        return {
            "built_up_area_sqft": built_up_area_sqft,
            "construction_cost_per_sqft": construction_cost_per_sqft,
            "structure_reinstatement_value": structure_reinstatement_value,
            "content_value": content_value,
            "total_insurable_sum_insured": total_sum_insured,
            "land_market_value_uninsured": land_market_value,  # Excluded from insurance cover
            "note": "Land market value is not insurable under standard home insurance policies; only building structure reinstatement and contents are covered.",
        }


def compute_next_escalation_date(
    current_date: str,
    frequency: str,
    custom_months: int | None = None,
) -> str:
    """Calculate the next escalation date handling leap days and month ends gracefully."""
    d = datetime.strptime(current_date, "%Y-%m-%d").date()
    if frequency == "annual" or frequency == "policy_anniversary":
        try:
            next_d = d.replace(year=d.year + 1)
        except ValueError:
            # Leap day Feb 29 -> Feb 28 in non-leap year
            next_d = d.replace(year=d.year + 1, day=28)
    elif frequency == "every_5_years":
        try:
            next_d = d.replace(year=d.year + 5)
        except ValueError:
            next_d = d.replace(year=d.year + 5, day=28)
    elif frequency == "custom" and custom_months:
        total_months = d.year * 12 + d.month - 1 + custom_months
        y, m = divmod(total_months, 12)
        # Handle month end clamping
        target_day = min(d.day, 28)
        next_d = date(y, m + 1, target_day)
    else:
        # Default 1 year
        try:
            next_d = d.replace(year=d.year + 1)
        except ValueError:
            next_d = d.replace(year=d.year + 1, day=28)
    return next_d.strftime("%Y-%m-%d")
