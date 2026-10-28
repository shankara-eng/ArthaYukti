"""Plan B stage 3: the bounded, deterministic search over permitted changes.

Hand check for the six-month example (income 60,000, outflow 95,000, 300,000 cash, floor 180,000): the six-month
deficit is 6 x 35,000 = 210,000 and may be at most 120,000, so the plan must save at least 90,000 over six months.
The most the permissions allow is pausing home (6 x 10,000 = 60,000) plus cutting flexible spending to 5,000
(6 x 5,000 = 30,000), which is exactly 90,000. So there is exactly one feasible plan.
"""

from decimal import Decimal

import pytest
from pydantic import ValidationError

from app.engine.recovery_search import RecoverySearchError, run_search
from app.schemas.recovery import RecoveryInput
from app.schemas.recovery_plan import RecoverySearchRequest
from tests.engine.test_recovery_eval import example

D = Decimal


def request(months=6, income_months=6, floor="180000.00", limits=None, **kw):
    data = example(months=months, income_months=income_months, floor=floor, home_pause_max=12)
    return RecoverySearchRequest.model_validate(
        {
            "input": data,
            "adjust_months": months if months == income_months else income_months,
            **({"limits": limits} if limits else {}),
            **kw,
        }
    )


def test_the_worked_example_has_exactly_one_feasible_plan():
    out = run_search(request())
    assert out.status == "found" and out.complete
    assert out.space_size == 42 and out.feasible_found == 1
    plan = out.frontier[0]
    described = {(a.item_id, a.action, a.to_month, a.monthly) for a in plan.adjustments}
    assert described == {
        ("home", "pause", "2027-04", None),
        ("flex", "reduce_to", "2027-04", D("5000.00")),
    }
    assert plan.evaluation.final_liquid == D("180000.00") and plan.evaluation.feasible
    # The unchanged plan is reported separately and fails in month 4.
    assert out.unchanged.first_violation_month == "2027-02"


def test_pausing_only_or_cutting_only_never_appears_among_the_feasible_plans():
    out = run_search(request())
    for plan in out.frontier:
        assert {a.item_id for a in plan.adjustments} == {"home", "flex"}
    kinds = out.rejected_by_kind
    assert kinds.get("reserve_floor", 0) == out.evaluated - out.feasible_found


def test_protected_items_are_never_adjusted_even_if_a_change_was_allowed():
    data = example(months=6, income_months=6)
    data["permissions"] += [
        {"item_id": "edu", "action": "pause", "max_months": 6},
        {"item_id": "emi", "action": "pause", "max_months": 6},
    ]
    out = run_search(RecoverySearchRequest.model_validate({"input": data}))
    assert any("Education contribution" in n and "protected" in n for n in out.ignored)
    assert any("Loan EMI" in n for n in out.ignored)
    for plan in out.frontier:
        assert {a.item_id for a in plan.adjustments} <= {"home", "flex"}


def test_an_exhaustive_search_with_no_plan_reports_infeasible_not_incomplete():
    # Eight months at 60,000 needs 160,000 saved but at most 80,000 + 40,000 = 120,000 can be (the pause limit is wide).
    out = run_search(request(months=8, income_months=8))
    assert out.status == "infeasible" and out.complete and out.feasible_found == 0
    assert out.strongest is not None
    # 300,000 - 8 x (35,000 - 15,000) = 140,000: 40,000 below the floor, with every permitted change applied.
    assert out.strongest.evaluation.final_liquid == D("140000.00")
    assert out.frontier == []


def test_a_search_cut_short_by_the_limit_is_incomplete_and_never_says_no_solution():
    out = run_search(request(limits={"max_candidates": 5}))
    assert out.status == "incomplete" and not out.complete
    assert out.evaluated + out.duplicates + out.errors == 5 and out.space_size == 42
    assert any("stopped after 5" in n for n in out.notes)
    # A limit that is large enough finds the plan the small one missed.
    assert run_search(request(limits={"max_candidates": 100})).status == "found"


def test_a_plan_found_before_the_limit_is_flagged_as_not_proven_best():
    out = run_search(request(floor="100000.00", limits={"max_candidates": 3}))
    assert out.status == "found" and not out.complete
    assert out.feasible_found >= 1


def test_refusing_an_item_removes_it_from_the_search():
    out = run_search(request(excluded_item_ids=["flex"]))
    # Pausing home for six months alone leaves 150,000, below the floor: nothing works without the flexible cut.
    assert out.status == "infeasible" and out.complete
    assert any("you refused" in n for n in out.ignored)
    assert all(a.item_id != "flex" for plan in [out.strongest] if plan for a in plan.adjustments)


def test_equivalent_candidates_are_counted_once():
    data = example(months=6, income_months=6)
    data["items"][-1]["to_month"] = (
        "2027-01"  # home only runs for three months, so longer pauses change nothing more
    )
    data["permissions"] = [{"item_id": "home", "action": "pause", "max_months": 6}]
    out = run_search(RecoverySearchRequest.model_validate({"input": data}))
    assert (
        out.duplicates == 3 and out.evaluated == 4
    )  # pauses of 4, 5 and 6 months repeat the 3-month pause


def test_dominated_plans_are_pruned_and_the_cheapest_feasible_plan_leads():
    out = run_search(request(floor="100000.00"))
    # Pausing home for one month saves 10,000, which is exactly the saving needed with a 100,000 floor.
    assert out.frontier[0].sacrifice == D("10000.00")
    vectors = [f.vector for f in out.frontier]
    for a in vectors:
        for b in vectors:
            assert a == b or not all(x >= y for x, y in zip(a, b, strict=True))
    sacrifices = [f.sacrifice for f in out.frontier]
    assert sacrifices == sorted(sacrifices)


def test_the_search_is_deterministic():
    a, b = run_search(request(floor="120000.00")), run_search(request(floor="120000.00"))
    assert [c.id for c in a.frontier] == [c.id for c in b.frontier]
    assert [(r.month, r.sacrifice) for r in a.rejected] == [
        (r.month, r.sacrifice) for r in b.rejected
    ]
    assert (a.space_size, a.evaluated, a.duplicates) == (b.space_size, b.evaluated, b.duplicates)


def test_rejections_name_the_first_violation_and_month():
    out = run_search(request())
    first = out.rejected[0]  # the least change: nothing adjusted
    assert (
        first.kind == "reserve_floor" and first.month == "2027-02" and first.sacrifice == D("0.00")
    )
    assert "2027-02" in first.message


def test_open_ended_changes_are_offered_only_when_a_restoration_rule_exists():
    plain = run_search(request())
    assert not any(a.to_month is None for p in plain.frontier for a in p.adjustments)
    data = example(months=10, income_months=6, floor="180000.00", home_pause_max=12)
    data["restorations"] = [
        {
            "item_id": "home",
            "conditions": [
                {"type": "income_at_least", "amount": "100000.00"},
                {"type": "liquid_at_least", "amount": "180000.00"},
            ],
        },
        {
            "item_id": "flex",
            "conditions": [
                {"type": "income_at_least", "amount": "100000.00"},
                {"type": "liquid_at_least", "amount": "180000.00"},
            ],
        },
    ]
    out = run_search(RecoverySearchRequest.model_validate({"input": data, "adjust_months": 6}))
    assert out.status == "found"
    # The open-ended options are in the space: 8 pause options x 11 reduction options (each reduction level also has an
    # until-restored twin) = 88, against 42 without rules. Here income returns in month 7 with cash exactly at the floor,
    # so the restored plan equals the fixed six-month plan and is counted once as a duplicate.
    assert out.space_size == 88 and out.duplicates >= 1


def test_the_request_rules():
    data = example()
    data["adjustments"] = [
        {"item_id": "home", "action": "pause", "from_month": "2026-11", "to_month": "2026-12"}
    ]
    with pytest.raises(ValidationError, match="without adjustments"):
        RecoverySearchRequest.model_validate({"input": data})
    with pytest.raises(ValidationError, match="unknown items"):
        RecoverySearchRequest.model_validate({"input": example(), "excluded_item_ids": ["nope"]})
    with pytest.raises(ValidationError):
        RecoverySearchRequest.model_validate({"input": example(), "adjust_from": "2030-01"})
    with pytest.raises(ValidationError):
        RecoverySearchRequest.model_validate({"input": example(), "limits": {"max_candidates": 0}})


def test_a_systemic_failure_stops_the_search(monkeypatch):
    import app.engine.recovery_search as search

    def boom(inp):
        raise ValueError("boom")

    monkeypatch.setattr(search, "evaluate_recovery", boom)
    with pytest.raises(RecoverySearchError, match="boom"):
        run_search(request())


def test_the_search_does_not_change_its_input():
    req = request()
    before = req.model_dump_json()
    run_search(req)
    assert req.model_dump_json() == before
    assert isinstance(req.input, RecoveryInput)


def test_a_very_wide_reduction_range_still_gives_a_bounded_number_of_options():
    data = example(months=6, income_months=6)
    data["items"][4]["monthly"] = (
        "900000000.00"  # flexible spending of Rs 90 crore a month, reducible to nothing
    )
    data["permissions"] = [{"item_id": "flex", "action": "reduce_to", "min_monthly": "0.00"}]
    out = run_search(RecoverySearchRequest.model_validate({"input": data}))
    assert out.space_size <= 27  # no change, about 24 levels and the minimum


def test_a_long_search_is_held_to_a_work_budget_whatever_limit_was_asked_for():
    from app.engine.recovery_search import WORK_BUDGET

    data = example(months=120, income_months=120, home_pause_max=120)
    out = run_search(RecoverySearchRequest.model_validate({"input": data, "adjust_months": 120, "limits": {"max_candidates": 20000}}))
    assert out.evaluated + out.duplicates + out.errors <= WORK_BUDGET // 120
    assert out.status in ("incomplete", "infeasible", "found")
    if not out.complete:
        assert any("size limit for a 120-month search" in n for n in out.notes)
        assert out.status != "infeasible"  # a search cut short never claims there is no solution
