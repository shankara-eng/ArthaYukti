from decimal import Decimal

from app.engine.insurance import (
    calculate_escalation_step,
    compute_next_escalation_date,
)


def test_simple_percentage_escalation():
    """Formula: C_n = C_0 * (1 + r * n).
    Base: 10,00,000, rate: 10% (0.10).
    Step 1 (n=1): 10,00,000 * (1 + 0.10 * 1) = 11,00,000. Increase: 1,00,000.
    Step 2 (n=2): 10,00,000 * (1 + 0.10 * 2) = 12,00,000. Increase: 1,00,000.
    """
    base = Decimal("1000000.00")
    rate = Decimal("0.100000")

    # Step 1
    res1 = calculate_escalation_step(
        base_cover=base,
        current_cover=base,
        escalation_type="fixed_percentage",
        completed_steps=0,
        rate=rate,
    )
    assert res1.resulting_cover == Decimal("1100000.00")
    assert res1.increase_amount == Decimal("100000.00")
    assert res1.cap_hit is False

    # Step 2
    res2 = calculate_escalation_step(
        base_cover=base,
        current_cover=res1.resulting_cover,
        escalation_type="fixed_percentage",
        completed_steps=1,
        rate=rate,
    )
    assert res2.resulting_cover == Decimal("1200000.00")
    assert res2.increase_amount == Decimal("100000.00")


def test_compound_percentage_escalation():
    """Formula: C_n = C_0 * (1 + r)^n.
    Base: 50,00,000, rate: 5% (0.05).
    Step 1 (n=1): 50,00,000 * 1.05 = 52,50,000.
    Step 2 (n=2): 50,00,000 * 1.05^2 = 55,12,500.
    """
    base = Decimal("5000000.00")
    rate = Decimal("0.050000")

    res1 = calculate_escalation_step(
        base_cover=base,
        current_cover=base,
        escalation_type="compound_percentage",
        completed_steps=0,
        rate=rate,
    )
    assert res1.resulting_cover == Decimal("5250000.00")
    assert res1.increase_amount == Decimal("250000.00")

    res2 = calculate_escalation_step(
        base_cover=base,
        current_cover=res1.resulting_cover,
        escalation_type="compound_percentage",
        completed_steps=1,
        rate=rate,
    )
    assert res2.resulting_cover == Decimal("5512500.00")
    assert res2.increase_amount == Decimal("262500.00")


def test_fixed_amount_escalation():
    """Formula: C_n = C_0 + n * A.
    Base: 25,00,000, fixed amount: 2,50,000 per anniversary.
    Step 1: 27,50,000.
    Step 2: 30,00,000.
    """
    base = Decimal("2500000.00")
    fixed_amt = Decimal("250000.00")

    res1 = calculate_escalation_step(
        base_cover=base,
        current_cover=base,
        escalation_type="fixed_amount",
        completed_steps=0,
        fixed_amount=fixed_amt,
    )
    assert res1.resulting_cover == Decimal("2750000.00")
    assert res1.increase_amount == Decimal("250000.00")

    res2 = calculate_escalation_step(
        base_cover=base,
        current_cover=res1.resulting_cover,
        escalation_type="fixed_amount",
        completed_steps=1,
        fixed_amount=fixed_amt,
    )
    assert res2.resulting_cover == Decimal("3000000.00")
    assert res2.increase_amount == Decimal("250000.00")


def test_cap_enforcement_maximum_total_cover():
    """Cover must be capped at maximum_total_cover."""
    base = Decimal("5000000.00")
    rate = Decimal("0.200000")  # +10,00,000 per step
    cap = Decimal("6500000.00")

    # Step 1: 60,00,000 (below cap)
    res1 = calculate_escalation_step(
        base_cover=base,
        current_cover=base,
        escalation_type="fixed_percentage",
        completed_steps=0,
        rate=rate,
        max_total_cover=cap,
    )
    assert res1.resulting_cover == Decimal("6000000.00")
    assert res1.cap_hit is False

    # Step 2: raw 70,00,000 -> capped at 65,00,000
    res2 = calculate_escalation_step(
        base_cover=base,
        current_cover=res1.resulting_cover,
        escalation_type="fixed_percentage",
        completed_steps=1,
        rate=rate,
        max_total_cover=cap,
    )
    assert res2.resulting_cover == Decimal("6500000.00")
    assert res2.increase_amount == Decimal("500000.00")
    assert res2.cap_hit is True
    assert res2.is_terminal is True


def test_cap_enforcement_multiple():
    """Cap at maximum_cover_multiple (e.g. 2.0x base cover = 1 crore)."""
    base = Decimal("5000000.00")
    multiple = Decimal("2.0")  # max 1,00,00,000

    res = calculate_escalation_step(
        base_cover=base,
        current_cover=Decimal("9500000.00"),
        escalation_type="fixed_amount",
        completed_steps=4,
        fixed_amount=Decimal("1000000.00"),
        max_cover_multiple=multiple,
    )
    assert res.resulting_cover == Decimal("10000000.00")
    assert res.increase_amount == Decimal("500000.00")
    assert res.cap_hit is True


def test_age_limit_enforcement():
    """If age >= age_limit, escalation terminates and increase is 0."""
    base = Decimal("5000000.00")
    res = calculate_escalation_step(
        base_cover=base,
        current_cover=Decimal("7000000.00"),
        escalation_type="fixed_percentage",
        completed_steps=2,
        rate=Decimal("0.10"),
        current_age=60,
        age_limit=60,
    )
    assert res.increase_amount == Decimal("0.00")
    assert res.resulting_cover == Decimal("7000000.00")
    assert res.is_terminal is True
    assert "Age limit" in (res.cap_reason or "")


def test_step_up_schedule():
    """Step-up schedule supports both multiplicative and additive amounts."""
    schedule = [
        {"step": 1, "rule": "multiplicative", "rate": "0.10"},
        {"step": 2, "rule": "additive_amount", "amount": "200000"},
    ]
    base = Decimal("1000000.00")
    res1 = calculate_escalation_step(
        base_cover=base,
        current_cover=base,
        escalation_type="step_up",
        completed_steps=0,
        step_schedule=schedule,
    )
    assert res1.resulting_cover == Decimal("1100000.00")

    res2 = calculate_escalation_step(
        base_cover=base,
        current_cover=res1.resulting_cover,
        escalation_type="step_up",
        completed_steps=1,
        step_schedule=schedule,
    )
    assert res2.resulting_cover == Decimal("1300000.00")


def test_premium_change_calculation():
    """Calculate proportionate premium increase when cover increases."""
    base = Decimal("10000000.00")
    curr_cover = Decimal("10000000.00")
    curr_prem = Decimal("24000.00")

    res = calculate_escalation_step(
        base_cover=base,
        current_cover=curr_cover,
        escalation_type="fixed_percentage",
        completed_steps=0,
        rate=Decimal("0.10"),
        current_premium=curr_prem,
        premium_change_rule={"type": "proportionate"},
    )
    # Cover grows by 10% (1.1x) -> Premium grows by 10%: 24,000 * 1.10 = 26,400.00
    assert res.resulting_cover == Decimal("11000000.00")
    assert res.new_premium == Decimal("26400.00")
    assert res.unverified_premium is False


def test_date_handling_leap_year():
    """Leap day anniversary Feb 29 rolls safely to Feb 28 in non-leap years."""
    next_d = compute_next_escalation_date("2024-02-29", "annual")
    assert next_d == "2025-02-28"

    next_custom = compute_next_escalation_date("2024-01-31", "custom", custom_months=1)
    assert next_custom == "2024-02-28"
