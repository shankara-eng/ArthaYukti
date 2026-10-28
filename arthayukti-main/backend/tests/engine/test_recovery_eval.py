"""Plan B stage 1: the isolated recovery evaluator.

The golden case is the hypothetical example in ArthaYukti-Market-Research.pdf (pages 26 to 31). Expected figures
are worked out by hand in the comments, never read back from the evaluator.

Accounting reconciliation of the example: income 100,000 against 95,000 of listed outflows and transfers leaves 5,000,
which is the "additional reserve contribution". That 5,000 is the residual staying in liquid cash, so it is not an
outflow. With income 60,000 and the same 95,000 the deficit is 35,000 a month, as the report says.
"""

from decimal import Decimal

import pytest
from pydantic import ValidationError

from app.engine.recovery_eval import evaluate_recovery
from app.schemas.recovery import RecoveryInput

D = Decimal
FLOOR = "180000.00"


def item(id, label, kind, monthly, **kw):
    return {"id": id, "label": label, "kind": kind, "monthly": monthly, **kw}


def example(
    months=6,
    income_months=6,
    adjustments=(),
    floor=FLOOR,
    liquid="300000.00",
    home_pause_max=12,
    extra_items=(),
):
    """Ananya: income 100,000 -> 60,000 for `income_months` from 2026-11, then 100,000 again."""
    income = [
        {"from_month": "2026-11", "to_month": f"{_month(income_months)}", "monthly_net": "60000.00"}
    ]
    if months > income_months:
        income.append({"from_month": _month(income_months + 1), "monthly_net": "100000.00"})
    return {
        "start_month": "2026-11",
        "months": months,
        "liquid_cash": liquid,
        "reserve_floor": floor,
        "income": income,
        "items": [
            item("living", "Living essentials", "essential", "30000.00"),
            item("parents", "Parent support", "protected_obligation", "10000.00"),
            item("emi", "Loan EMI", "mandatory_debt", "10000.00"),
            item("insurance", "Insurance", "protected_obligation", "5000.00"),
            item("flex", "Flexible spending", "flexible", "10000.00"),
            item(
                "retire",
                "Retirement contribution",
                "goal_contribution",
                "10000.00",
                balance_id="retirement",
            ),
            item(
                "edu",
                "Education contribution",
                "goal_contribution",
                "10000.00",
                balance_id="education",
            ),
            item(
                "home",
                "Home contribution",
                "goal_contribution",
                "10000.00",
                protected=False,
                balance_id="home",
            ),
            *extra_items,
        ],
        "protected_balances": [
            {"id": "education", "label": "Education savings", "balance": "120000.00"},
            {"id": "home", "label": "Home savings", "balance": "200000.00"},
            {"id": "retirement", "label": "Retirement investments", "balance": "400000.00"},
        ],
        "permissions": [
            {"item_id": "flex", "action": "reduce_to", "min_monthly": "5000.00"},
            {"item_id": "home", "action": "pause", "max_months": home_pause_max},
        ],
        "adjustments": list(adjustments),
    }


def _month(n):
    """Month n of the example: 1 is 2026-11."""
    y, m = divmod(2026 * 12 + 10 + n - 1, 12)
    return f"{y:04d}-{m + 1:02d}"


def pause_home(months):
    return {
        "item_id": "home",
        "action": "pause",
        "from_month": "2026-11",
        "to_month": _month(months),
    }


def cut_flex(months):
    return {
        "item_id": "flex",
        "action": "reduce_to",
        "from_month": "2026-11",
        "to_month": _month(months),
        "monthly": "5000.00",
    }


def run(**kw):
    return evaluate_recovery(RecoveryInput.model_validate(example(**kw)))


# ---- the research example --------------------------------------------------------------------------------


def test_baseline_before_the_disruption_leaves_5000_a_month_in_cash():
    # 100,000 - (30+10+10+5+10) - (10+10+10) = 100,000 - 65,000 - 30,000 = 5,000: the "additional reserve contribution".
    base = RecoveryInput.model_validate(
        {
            **example(months=1, income_months=1),
            "income": [{"from_month": "2026-11", "monthly_net": "100000.00"}],
        }
    )
    result = evaluate_recovery(base)
    assert result.months[0].cash_change == D("5000.00")
    assert result.months[0].liquid_end == D("305000.00")


def test_without_changes_the_deficit_is_35000_and_the_reserve_reaches_90000():
    # 95,000 out against 60,000 in: -35,000 a month. 300,000 - 6 x 35,000 = 90,000.
    result = run()
    assert {m.cash_change for m in result.months} == {D("-35000.00")}
    assert result.final_liquid == D("90000.00")
    # Month 3 is 300,000 - 105,000 = 195,000 (still above 180,000); month 4 is 160,000 (first breach).
    assert [m.liquid_end for m in result.months[:4]] == [
        D("265000.00"),
        D("230000.00"),
        D("195000.00"),
        D("160000.00"),
    ]
    assert result.first_violation_month == _month(4)
    assert not result.feasible


def test_pausing_only_the_home_contribution_leaves_150000_and_violates_the_floor():
    # Outflow 85,000: deficit 25,000 a month. 300,000 - 6 x 25,000 = 150,000, which is 30,000 below the floor.
    result = run(adjustments=[pause_home(6)])
    assert result.final_liquid == D("150000.00")
    assert not result.feasible
    last = [v for v in result.violations if v.kind == "reserve_floor"][-1]
    assert last.month == _month(6) and last.amount == D("30000.00")


def test_pausing_home_and_cutting_flexible_spending_ends_exactly_on_the_floor():
    # Outflow 80,000: deficit 20,000 a month. 300,000 - 6 x 20,000 = 180,000: exactly the floor, which passes.
    result = run(adjustments=[pause_home(6), cut_flex(6)])
    assert result.final_liquid == D("180000.00")
    assert result.feasible and result.violations == []
    assert result.minimum_liquid == D("180000.00")
    assert all(m.floor_met for m in result.months)


def test_protected_contributions_and_balances_are_untouched_in_the_selected_plan():
    result = run(adjustments=[pause_home(6), cut_flex(6)])
    for month in result.months:
        amounts = {i.item_id: (i.amount, i.adjusted) for i in month.items}
        assert amounts["edu"] == (D("10000.00"), False)
        assert amounts["retire"] == (D("10000.00"), False)
        assert amounts["home"] == (D("0.00"), True)
    # Education 120,000 + 6 x 10,000; retirement 400,000 + 6 x 10,000; home 200,000 paused. Nothing is withdrawn.
    assert result.balances_end == {
        "education": D("180000.00"),
        "home": D("200000.00"),
        "retirement": D("460000.00"),
    }
    assert result.protected_balances_withdrawn == D("0.00")


def test_an_eight_month_reduction_reports_the_floor_violation_instead_of_recovering():
    # Same protections and cuts held for eight months (the pause limit is widened so only the cash question is tested).
    result = run(months=8, income_months=8, adjustments=[pause_home(8), cut_flex(8)])
    # 300,000 - 7 x 20,000 = 160,000 (month 7, 20,000 under the floor); 140,000 in month 8.
    assert [m.liquid_end for m in result.months[-2:]] == [D("160000.00"), D("140000.00")]
    assert not result.feasible
    assert [v.month for v in result.violations if v.kind == "reserve_floor"] == [
        _month(7),
        _month(8),
    ]
    assert result.first_violation_month == _month(7)
    # Nothing was relaxed: contributions are as stated and no protected balance was used.
    assert result.protected_balances_withdrawn == D("0.00")
    assert result.balances_end["education"] == D("200000.00")  # 120,000 + 8 x 10,000


# ---- boundaries and failures -------------------------------------------------------------------------------


def test_exactly_at_the_floor_passes_and_one_paisa_below_fails():
    on = run(adjustments=[pause_home(6), cut_flex(6)], floor="180000.00")
    assert on.feasible
    over = run(adjustments=[pause_home(6), cut_flex(6)], floor="180000.01")
    assert not over.feasible
    assert over.violations[-1].amount == D("0.01") and over.violations[-1].kind == "reserve_floor"


def test_a_mandatory_payment_that_cash_cannot_cover_is_reported_not_skipped():
    # Cash runs out when income is below the mandatory payments.
    tight = RecoveryInput.model_validate(
        {
            **example(),
            "liquid_cash": "0.00",
            "reserve_floor": "0.00",
            "income": [{"from_month": "2026-11", "monthly_net": "50000.00"}],
        }
    )
    out = evaluate_recovery(tight)
    first = out.months[0]
    # Mandatory is 30+10+10+5 = 55,000 against 50,000 of income and no cash: 5,000 is missing.
    assert first.mandatory_outflow == D("55000.00") and first.mandatory_shortfall == D("5000.00")
    assert out.violations[0].kind == "mandatory_shortfall" and out.violations[0].amount == D(
        "5000.00"
    )
    assert not out.feasible and out.protected_balances_withdrawn == D("0.00")
    assert out.balances_end["education"] == D(
        "180000.00"
    )  # contributions still credited; nothing was drawn to cover cash


def test_the_evaluator_cannot_reduce_a_protected_contribution_or_a_mandatory_item():
    for bad in ("edu", "retire", "living", "emi", "parents", "insurance"):
        data = example(
            adjustments=[
                {"item_id": bad, "action": "pause", "from_month": "2026-11", "to_month": "2026-12"}
            ]
        )
        data["permissions"].append({"item_id": bad, "action": "pause", "max_months": 6})
        with pytest.raises(ValidationError, match="protected"):
            RecoveryInput.model_validate(data)


def test_an_adjustment_needs_permission_and_must_respect_its_limits():
    with pytest.raises(ValidationError, match="not allowed"):
        RecoveryInput.model_validate(
            {**example(), "adjustments": [pause_home(2)], "permissions": []}
        )
    with pytest.raises(ValidationError, match="longer than the 3 months"):
        RecoveryInput.model_validate(example(adjustments=[pause_home(4)], home_pause_max=3))
    below = {**cut_flex(6), "monthly": "4999.99"}
    with pytest.raises(ValidationError, match="lowest amount"):
        RecoveryInput.model_validate(example(adjustments=[below]))
    raising = {**cut_flex(6), "monthly": "10000.01"}
    with pytest.raises(ValidationError, match="cannot raise"):
        RecoveryInput.model_validate(example(adjustments=[raising]))


def test_income_must_be_stated_for_every_month_and_unknown_duration_is_explicit():
    gap = {
        **example(),
        "income": [{"from_month": "2026-11", "to_month": "2027-03", "monthly_net": "60000.00"}],
    }
    with pytest.raises(ValidationError, match="every modelled month"):
        RecoveryInput.model_validate(gap)
    overlap = {
        **example(),
        "income": [
            {"from_month": "2026-11", "monthly_net": "60000.00"},
            {"from_month": "2027-01", "monthly_net": "1.00"},
        ],
    }
    with pytest.raises(ValidationError, match="exactly once"):
        RecoveryInput.model_validate(overlap)
    unknown = {
        **example(),
        "income": [{"from_month": "2026-11", "monthly_net": "60000.00"}],
    }  # no end month
    result = evaluate_recovery(RecoveryInput.model_validate(unknown))
    assert result.income_end_unknown
    assert any("no stated end" in a for a in result.assumptions)
    assert not evaluate_recovery(RecoveryInput.model_validate(example())).income_end_unknown


@pytest.mark.parametrize(
    "field, value",
    [
        ("liquid_cash", "-1.00"),
        ("reserve_floor", "-5.00"),
        ("liquid_cash", "abc"),
        ("liquid_cash", 300000),
        ("months", 0),
        ("months", 121),
        ("start_month", "2026-13"),
    ],
)
def test_negative_or_malformed_values_are_rejected(field, value):
    with pytest.raises(ValidationError):
        RecoveryInput.model_validate({**example(), field: value})


def test_item_amounts_and_unknown_references_are_validated():
    data = example()
    data["items"][0]["monthly"] = "-1.00"
    with pytest.raises(ValidationError):
        RecoveryInput.model_validate(data)
    data = example(extra_items=[item("edu", "Duplicate", "flexible", "1.00")])
    with pytest.raises(ValidationError, match="unique"):
        RecoveryInput.model_validate(data)
    data = example()
    data["items"][5]["balance_id"] = "no-such-balance"
    with pytest.raises(ValidationError, match="protected balance"):
        RecoveryInput.model_validate(data)


# ---- purity -----------------------------------------------------------------------------------------------


def test_the_input_is_not_changed_and_the_same_input_gives_the_same_result():
    inp = RecoveryInput.model_validate(example(adjustments=[pause_home(6), cut_flex(6)]))
    before = inp.model_dump_json()
    first = evaluate_recovery(inp)
    second = evaluate_recovery(inp)
    assert inp.model_dump_json() == before
    assert first.model_dump_json() == second.model_dump_json()


def test_net_worth_counts_transfers_to_goals_as_saving_not_spending():
    result = run(adjustments=[pause_home(6), cut_flex(6)])
    m = result.months[0]
    # Cash falls by 20,000, but 20,000 of it went into education and retirement: net worth is unchanged.
    assert m.cash_change == D("-20000.00") and m.goal_transfers == D("20000.00")
    assert m.net_worth_change == D("0.00")
