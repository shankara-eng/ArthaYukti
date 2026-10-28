from decimal import Decimal

from app.engine.insurance import calculate_health_ncb


def test_health_ncb_claim_free_accrual():
    """Health NCB increases by ncb_rate_pct on claim-free renewal, capped at max_ncb_pct.
    Base sum insured: 10,00,000.
    Rate: 10% (1,00,000 per claim-free year).
    Max cap: 50% (5,00,000 max NCB).
    """
    base = Decimal("1000000.00")
    rate = Decimal("10.0")
    max_cap = Decimal("50.0")

    # Year 1 claim free
    y1 = calculate_health_ncb(
        base_sum_insured=base,
        accumulated_ncb=Decimal("0.00"),
        ncb_rate_pct=rate,
        max_ncb_pct=max_cap,
        claim_occurred=False,
    )
    assert y1["new_ncb"] == Decimal("100000.00")
    assert y1["effective_sum_insured"] == Decimal("1100000.00")
    assert y1["max_ncb_amount"] == Decimal("500000.00")

    # Year 2 claim free
    y2 = calculate_health_ncb(
        base_sum_insured=base,
        accumulated_ncb=y1["new_ncb"],
        ncb_rate_pct=rate,
        max_ncb_pct=max_cap,
        claim_occurred=False,
    )
    assert y2["new_ncb"] == Decimal("200000.00")
    assert y2["effective_sum_insured"] == Decimal("1200000.00")


def test_health_ncb_cap_reached():
    """Health NCB accrual stops once max_ncb_pct is reached."""
    base = Decimal("1000000.00")
    y_capped = calculate_health_ncb(
        base_sum_insured=base,
        accumulated_ncb=Decimal("450000.00"),
        ncb_rate_pct=Decimal("10.0"),  # would add 1,00,000 -> 5,50,000
        max_ncb_pct=Decimal("50.0"),  # max 5,00,000
        claim_occurred=False,
    )
    assert y_capped["new_ncb"] == Decimal("500000.00")
    assert y_capped["effective_sum_insured"] == Decimal("1500000.00")


def test_health_ncb_claim_reduction():
    """When a claim occurs, NCB is reduced per contract rule without going negative."""
    base = Decimal("1000000.00")

    # 1. Percentage reduction rule (e.g. loses 10% on claim)
    reduced = calculate_health_ncb(
        base_sum_insured=base,
        accumulated_ncb=Decimal("300000.00"),
        ncb_rate_pct=Decimal("10.0"),
        max_ncb_pct=Decimal("50.0"),
        claim_occurred=True,
        claim_reduction_rule="percentage_reduction",
        reduction_pct=Decimal("10.0"),  # loses 1,00,000
    )
    assert reduced["new_ncb"] == Decimal("200000.00")
    assert reduced["effective_sum_insured"] == Decimal("1200000.00")

    # 2. Full reset rule
    reset_res = calculate_health_ncb(
        base_sum_insured=base,
        accumulated_ncb=Decimal("300000.00"),
        ncb_rate_pct=Decimal("10.0"),
        max_ncb_pct=Decimal("50.0"),
        claim_occurred=True,
        claim_reduction_rule="full_reset",
    )
    assert reset_res["new_ncb"] == Decimal("0.00")
    assert reset_res["effective_sum_insured"] == base


def test_no_double_counting_restoration_and_ncb():
    """Restoration benefit is an exhaustion trigger, never added unconditionally to base cover."""
    base = Decimal("500000.00")
    accumulated_ncb = Decimal("150000.00")

    res = calculate_health_ncb(
        base_sum_insured=base,
        accumulated_ncb=accumulated_ncb,
        ncb_rate_pct=Decimal("10.0"),
        max_ncb_pct=Decimal("50.0"),
        claim_occurred=False,
    )
    # Total available standard claim limit is strictly Base + New NCB = 5,00,000 + 2,00,000 = 7,00,000
    assert res["effective_sum_insured"] == Decimal("700000.00")
    assert res["effective_sum_insured"] == res["base_sum_insured"] + res["new_ncb"]
