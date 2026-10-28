"""Plan B stage 2: restoration rules.

Same hypothetical household as test_recovery_eval.py. The home contribution is paused and flexible spending cut
"until restored". Expected figures are worked out by hand in the comments.

Reference path with no restoration (outflow 80,000 against 60,000 income, 20,000 a month out of cash):
liquid at the end of month 1..6 (Nov 2026 to Apr 2027) = 280, 260, 240, 220, 200, 180 thousand. From month 7 (May 2027)
income is 100,000, so each month adds 20,000 while the cuts stay: 200, 220, 240 thousand at the end of months 7, 8, 9.
"""

from decimal import Decimal

import pytest
from pydantic import ValidationError

from app.engine.recovery_eval import evaluate_recovery
from app.schemas.recovery import RecoveryInput
from tests.engine.test_recovery_eval import _month, example

D = Decimal


def open_adjustments():
    return [
        {"item_id": "home", "action": "pause", "from_month": "2026-11"},
        {"item_id": "flex", "action": "reduce_to", "from_month": "2026-11", "monthly": "5000.00"},
    ]


def rules(conditions=None, steps=None, guard=True, items=("home", "flex")):
    conditions = conditions or [
        {"type": "income_at_least", "amount": "100000.00"},
        {"type": "liquid_at_least", "amount": "240000.00"},
    ]
    out = []
    for iid in items:
        r = {"item_id": iid, "conditions": conditions, "affordability_guard": guard}
        if steps and iid == "home":
            r["steps"] = steps["amounts"]
            r["step_gap_months"] = steps["gap"]
        out.append(r)
    return out


def build(months=14, income_back=7, restorations=None, adjustments=None, **extra):
    data = example(
        months=months, income_months=income_back - 1, adjustments=adjustments or open_adjustments()
    )
    data["permissions"] = [
        {"item_id": "flex", "action": "reduce_to", "min_monthly": "5000.00"},
        {"item_id": "home", "action": "pause", "max_months": 12},
    ]
    data["restorations"] = restorations if restorations is not None else rules()
    data.update(extra)
    return RecoveryInput.model_validate(data)


def outcome(result, item):
    return next(o for o in result.restorations if o.item_id == item)


def amount(result, item, month):
    row = next(m for m in result.months if m.month == month)
    return next(i.amount for i in row.items if i.item_id == item)


# ---- successful, delayed and partial restoration --------------------------------------------------------------


def test_restoration_happens_once_income_and_cash_conditions_are_both_met():
    result = evaluate_recovery(build())
    # Income is back in May (month 7) but cash is 180,000 then; it first reaches 240,000 at the end of July (month 9),
    # so both items come back in August 2027 (month 10): the research example's "the following month".
    home = outcome(result, "home")
    assert home.status == "restored" and home.triggered_month == "2027-08"
    assert [(s.month, s.monthly) for s in home.steps] == [("2027-08", D("10000.00"))]
    assert amount(result, "home", "2027-07") == D("0.00") and amount(
        result, "home", "2027-08"
    ) == D("10000.00")
    assert amount(result, "flex", "2027-07") == D("5000.00") and amount(
        result, "flex", "2027-08"
    ) == D("10000.00")
    liquid = {m.month: m.liquid_end for m in result.months}
    assert liquid["2027-07"] == D("240000.00")
    # From August the full 95,000 goes out against 100,000 of income: +5,000 a month.
    assert liquid["2027-08"] == D("245000.00") and liquid["2027-09"] == D("250000.00")
    assert result.feasible
    # Protected contributions and mandatory payments never changed in any month.
    for month in result.months:
        amounts = {i.item_id: i.amount for i in month.items}
        assert amounts["edu"] == amounts["retire"] == D("10000.00")
        assert month.mandatory_outflow == D("55000.00")


def test_a_date_arriving_first_does_not_restore_anything():
    conditions = [
        {"type": "date_reached", "month": "2027-05"},
        {"type": "income_at_least", "amount": "100000.00"},
        {"type": "liquid_at_least", "amount": "240000.00"},
    ]
    result = evaluate_recovery(build(restorations=rules(conditions)))
    # The date is May 2027, but cash only reaches 240,000 in July, so the restoration is still August.
    assert outcome(result, "home").triggered_month == "2027-08"
    assert amount(result, "home", "2027-05") == D("0.00") and amount(
        result, "home", "2027-06"
    ) == D("0.00")


def test_a_date_alone_is_never_a_valid_restoration_condition():
    with pytest.raises(ValidationError, match="date alone"):
        build(restorations=rules([{"type": "date_reached", "month": "2027-05"}]))


def test_delayed_recovery_delays_the_restoration():
    # Income returns two months later (month 9, July): cash stays at 20,000 a month drain until then.
    # End of months 7, 8 = 160, 140 thousand (below the floor), so this plan is infeasible; the point is the timing.
    result = evaluate_recovery(build(income_back=9, restorations=rules()))
    assert not result.feasible and result.first_violation_month == "2027-05"
    assert (
        outcome(result, "home").status == "not_triggered"
        or outcome(result, "home").triggered_month >= "2027-09"
    )


def test_partial_restoration_applies_steps_one_at_a_time_and_reports_partial():
    steps = {"amounts": ["5000.00", "10000.00"], "gap": 2}
    # Horizon ends in September 2027 (month 11): the first step lands in August, the second is due in October.
    result = evaluate_recovery(build(months=11, restorations=rules(steps=steps)))
    home = outcome(result, "home")
    assert home.status == "partial" and home.final_monthly == D("5000.00")
    assert [(s.month, s.monthly) for s in home.steps] == [("2027-08", D("5000.00"))]
    assert amount(result, "home", "2027-09") == D("5000.00")
    # With a longer horizon the second step arrives two months after the first.
    longer = evaluate_recovery(build(months=14, restorations=rules(steps=steps)))
    assert [(s.month, s.monthly) for s in outcome(longer, "home").steps] == [
        ("2027-08", D("5000.00")),
        ("2027-10", D("10000.00")),
    ]
    assert outcome(longer, "home").status == "restored"


# ---- restoration must stay affordable --------------------------------------------------------------------------


def confirmed_early(guard):
    # Home is paused until restored; flexible spending is cut for the whole eight months (a fixed change).
    fixed_flex = {
        "item_id": "flex",
        "action": "reduce_to",
        "from_month": "2026-11",
        "to_month": _month(8),
        "monthly": "5000.00",
    }
    return build(
        months=8,
        adjustments=[open_adjustments()[0], fixed_flex],
        restorations=rules([{"type": "user_confirmed"}], guard=guard, items=("home",)),
        recovery_confirmed_from="2027-02",
    )


def test_an_unaffordable_restoration_is_deferred_by_the_guard():
    # The person confirms recovery in February (month 4) while income is still 60,000. Restoring home then would leave
    # cash at 210, 180, 150 thousand over months 4 to 6, so the guard waits. In May (month 7) income is 100,000.
    result = evaluate_recovery(confirmed_early(guard=True))
    home = outcome(result, "home")
    assert home.triggered_month == "2027-02" and home.deferred_months == 3
    assert [(s.month, s.monthly) for s in home.steps] == [("2027-05", D("10000.00"))]
    assert result.feasible and all(m.floor_met for m in result.months)
    assert amount(result, "home", "2027-04") == D("0.00")


def test_without_the_guard_the_restoration_breach_is_reported_not_hidden():
    result = evaluate_recovery(confirmed_early(guard=False))
    assert outcome(result, "home").steps[0].month == "2027-02"
    assert not result.feasible
    breach = [v for v in result.violations if v.kind == "reserve_floor"][0]
    # Home restored in month 4 with flexible cut: outflow 90,000 against 60,000 income is -30,000 a month:
    # end of months 4, 5, 6 = 210, 180, 150 thousand. The first month below 180,000 is month 6 (April), by 30,000.
    assert breach.month == "2027-04" and breach.amount == D("30000.00")
    assert result.protected_balances_withdrawn == D("0.00")


def test_restoration_never_touches_protected_commitments():
    # Mandatory payments and protected contributions are identical in every month, restored or not.
    for guard in (True, False):
        result = evaluate_recovery(confirmed_early(guard))
        assert {m.mandatory_outflow for m in result.months} == {D("55000.00")}
        for month in result.months:
            amounts = {i.item_id: i.amount for i in month.items}
            assert amounts["edu"] == amounts["retire"] == D("10000.00")
    bad = example(adjustments=[{"item_id": "edu", "action": "pause", "from_month": "2026-11"}])
    bad["permissions"].append({"item_id": "edu", "action": "pause", "max_months": 6})
    bad["restorations"] = rules(items=("edu",))
    with pytest.raises(ValidationError, match="protected"):
        RecoveryInput.model_validate(bad)
    with pytest.raises(ValidationError, match="cannot exceed"):
        build(restorations=rules(steps={"amounts": ["10000.01"], "gap": 1}))


# ---- unknown duration, missing conditions, determinism, review --------------------------------------------------


def test_unknown_duration_never_assumes_recovery():
    data = build(months=8).model_dump(mode="json")
    data["income"] = [{"from_month": "2026-11", "monthly_net": "60000.00"}]  # no end month
    result = evaluate_recovery(RecoveryInput.model_validate(data))
    assert result.income_end_unknown
    assert (
        outcome(result, "home").status == "not_triggered"
        and outcome(result, "flex").status == "not_triggered"
    )
    assert any("no stated end" in a for a in result.assumptions)
    assert amount(result, "home", _month(8)) == D("0.00")  # still paused in the last month


def test_a_condition_that_is_never_met_leaves_the_item_changed():
    impossible = [{"type": "income_at_least", "amount": "500000.00"}]
    result = evaluate_recovery(build(restorations=rules(impossible)))
    assert all(o.status == "not_triggered" and o.steps == [] for o in result.restorations)
    assert amount(result, "home", _month(14)) == D("0.00")


def test_an_open_ended_change_needs_a_restoration_rule():
    with pytest.raises(ValidationError, match="restoration rule"):
        build(restorations=[])


def test_an_open_ended_pause_counts_against_its_maximum():
    data = build(
        months=14, restorations=rules([{"type": "income_at_least", "amount": "500000.00"}])
    ).model_dump(mode="json")
    data["permissions"][1]["max_months"] = 3
    result = evaluate_recovery(RecoveryInput.model_validate(data))
    limit = [v for v in result.violations if v.kind == "pause_limit"]
    assert len(limit) == 1 and limit[0].month == "2027-02"  # the 4th month paused
    assert not result.feasible


def test_the_same_input_always_gives_the_same_result_and_the_input_is_unchanged():
    inp = build()
    before = inp.model_dump_json()
    one, two = evaluate_recovery(inp), evaluate_recovery(inp)
    assert one.model_dump_json() == two.model_dump_json() and inp.model_dump_json() == before


def test_a_review_month_reports_status_and_restores_nothing():
    without = evaluate_recovery(build())
    early = evaluate_recovery(build(review_month="2027-03"))
    late = evaluate_recovery(build(review_month="2027-12"))
    assert {i.status for i in early.review.items} == {"not_triggered"}
    assert {i.status for i in late.review.items} == {"restored"}
    # A review date does not change a single figure.
    assert [m.model_dump() for m in early.months] == [m.model_dump() for m in without.months]
    assert [o.model_dump() for o in early.restorations] == [
        o.model_dump() for o in without.restorations
    ]


def test_a_confirmation_alone_is_enough_but_only_from_its_month():
    result = evaluate_recovery(
        build(
            months=10,
            restorations=rules([{"type": "user_confirmed"}]),
            recovery_confirmed_from="2027-08",
        )
    )
    assert outcome(result, "home").triggered_month == "2027-08"
    assert amount(result, "home", "2027-07") == D("0.00")
