"""Scenario, edge-case and invariant tests for the projection engine."""

import random
from decimal import Decimal

import pytest

from app.engine.projection import monthly_surplus_series, project
from app.schemas.scenario import Scenario
from tests.engine.helpers import ZERO_RATES, goal, load_sample_plan, make_plan


def D(value: str) -> Decimal:
    return Decimal(value)


def scenario(**fields) -> Scenario:
    return Scenario.model_validate(fields)


def one_goal_plan(**overrides):
    return make_plan(
        income="100000.00",
        expenses="60000.00",
        goals=[goal("g", "480000.00", "2027-10", 1)],
        **overrides,
    )


def outcomes(result):
    return {o.goal_id: o for o in result.goals}


# --- shocks -----------------------------------------------------------------


def test_t5_income_loss_draws_savings_then_recovers():
    result = project(
        one_goal_plan(),
        scenario(
            events=[
                {
                    "type": "income_change",
                    "stream_id": None,
                    "from_month": "2027-02",
                    "to_month": "2027-03",
                    "multiplier": "0",
                }
            ]
        ),
    )
    g = outcomes(result)["g"]
    assert [row.goals[0].withdrawal for row in result.monthly[3:5]] == [D("60000"), D("60000")]
    assert g.total_withdrawn == D("120000.00")
    assert g.status == "delayed"
    assert g.projected_completion == "2028-03"
    assert g.delay_months == 5
    assert result.summary.uncovered_deficit_months == []


def test_t6_unexpected_expense_is_drawn_from_the_goal():
    result = project(
        one_goal_plan(),
        scenario(
            events=[
                {
                    "type": "one_time_expense",
                    "month": "2027-01",
                    "amount": "100000.00",
                    "label": "Medical bill",
                }
            ]
        ),
    )
    g = outcomes(result)["g"]
    assert result.monthly[2].goals[0].withdrawal == D("60000.00")
    assert g.delay_months == 3
    assert g.projected_completion == "2028-01"


def test_deficit_beyond_all_savings_is_reported_not_hidden():
    result = project(
        one_goal_plan(),
        scenario(
            events=[
                {
                    "type": "income_change",
                    "stream_id": None,
                    "from_month": "2027-02",
                    "to_month": "2027-08",
                    "multiplier": "0",
                }
            ]
        ),
    )
    assert result.summary.uncovered_deficit_months
    assert result.summary.plan_feasible is False
    assert any(w.code == "uncovered_deficit" for w in result.warnings)


def test_deficit_draws_emergency_fund_first_then_lowest_priority():
    plan = make_plan(
        income="50000.00",
        expenses="50000.00",
        goals=[
            goal("holiday", "100000.00", "2030-01", 1, saved="40000.00"),
            {
                **goal("buffer", "100000.00", "2030-01", 2, saved="30000.00"),
                "type": "emergency_fund",
            },
            goal("car", "100000.00", "2030-01", 3, saved="40000.00"),
        ],
    )
    result = project(
        plan,
        scenario(
            events=[
                {
                    "type": "one_time_expense",
                    "month": "2026-11",
                    "amount": "50000.00",
                    "label": "Repair",
                }
            ]
        ),
    )
    first = {g.goal_id: g for g in result.monthly[0].goals}
    assert first["buffer"].withdrawal == D("30000.00")
    assert first["car"].withdrawal == D("20000.00")
    assert first["holiday"].withdrawal == D("0.00")


# --- inflation, growth, rates ------------------------------------------------


def test_inflation_linked_goal_uses_the_rate_and_override():
    base = {**goal("g", "100000.00", "2027-10", 1), "inflation_linked": True}
    plan = make_plan(income="100000.00", expenses="0.00", goals=[base])
    plan = plan.model_copy(
        update={
            "assumptions": plan.assumptions.model_copy(
                update={"general_inflation_annual": D("0.12")}
            )
        }
    )
    g = outcomes(project(plan))["g"]
    assert g.inflated_target_at_deadline == D("112682.50")
    assert g.target_amount_today == D("100000.00")

    overridden = plan.model_copy(
        update={"goals": [plan.goals[0].model_copy(update={"inflation_rate_override": D("0")})]}
    )
    assert outcomes(project(overridden))["g"].inflated_target_at_deadline == D("100000.00")


def test_shortfall_is_reported_in_todays_money_too():
    plan = make_plan(
        income="10000.00",
        expenses="0.00",
        goals=[{**goal("g", "1000000.00", "2027-10", 1), "inflation_linked": True}],
    )
    plan = plan.model_copy(
        update={
            "assumptions": plan.assumptions.model_copy(
                update={"general_inflation_annual": D("0.12")}
            )
        }
    )
    g = outcomes(project(plan))["g"]
    assert g.shortfall_at_deadline_nominal > g.shortfall_at_deadline_today > 0


def test_savings_return_grows_a_balance():
    plan = make_plan(
        income="0.00",
        expenses="0.00",
        goals=[goal("g", "200000.00", "2027-10", 1, saved="100000.00")],
    )
    plan = plan.model_copy(
        update={
            "assumptions": plan.assumptions.model_copy(update={"savings_return_annual": D("0.12")})
        }
    )
    result = project(plan)
    # 1% a month on 100000.00, interest rounded to the paisa each month (ledger rounding).
    # An independent hand ledger gives 112682.51; unrounded compounding gives 112682.50.
    assert result.goals[0].balance_at_deadline == D("112682.51")


def test_income_and_expenses_step_up_each_anniversary():
    plan = make_plan(
        income="100000.00", expenses="60000.00", goals=[goal("g", "100000.00", "2030-01", 1)]
    )
    plan = plan.model_copy(
        update={
            "assumptions": plan.assumptions.model_copy(
                update={"income_growth_annual": D("0.10"), "expense_growth_annual": D("0.05")}
            )
        }
    )
    series = monthly_surplus_series(plan, None, 14)
    assert series[0] == D("40000.00")
    assert series[11] == D("40000.00")
    assert series[12] == D("110000.00") - D("63000.00")


def test_income_stream_stops_after_its_end_month():
    plan = make_plan(
        income="100000.00", expenses="60000.00", goals=[goal("g", "100000.00", "2030-01", 1)]
    )
    plan = plan.model_copy(
        update={
            "income_streams": [plan.income_streams[0].model_copy(update={"ends_after": "2027-01"})]
        }
    )
    series = monthly_surplus_series(plan, None, 4)
    assert series == [D("40000.00"), D("40000.00"), D("40000.00"), D("-60000.00")]


# --- allocation edge cases ---------------------------------------------------


def test_unassigned_savings_go_to_goals_by_priority_up_to_need():
    plan = make_plan(
        income="0.00",
        expenses="0.00",
        goals=[goal("a", "60000.00", "2027-10", 1), goal("b", "60000.00", "2027-10", 2)],
    ).model_copy(update={"unassigned_savings": D("80000.00")})
    result = project(plan)
    first = {g.goal_id: g for g in result.monthly[0].goals}
    assert first["a"].balance == D("60000.00")
    assert first["b"].balance == D("20000.00")


def test_goal_funded_at_the_start_completes_in_month_one():
    plan = make_plan(
        income="10000.00",
        expenses="0.00",
        goals=[goal("g", "50000.00", "2027-10", 1, saved="50000.00")],
    )
    g = outcomes(project(plan))["g"]
    assert g.status == "on_track"
    assert g.projected_completion == "2026-11"
    assert g.delay_months == 0


def test_impossible_goals_are_not_achievable_and_never_crash():
    plan = make_plan(
        income="40000.00",
        expenses="60000.00",
        goals=[goal("g", "500000.00", "2027-10", 1)],
    )
    result = project(plan)
    g = result.goals[0]
    assert g.status == "not_achievable"
    assert g.projected_completion is None
    assert g.delay_months is None
    assert g.total_contributed == D("0.00")
    assert result.summary.plan_feasible is False
    assert result.summary.overcommitment_ratio is None


def test_priority_order_in_a_scenario_matches_reordering_the_plan():
    plan = make_plan(
        income="50000.00",
        expenses="0.00",
        goals=[
            goal("a", "300000.00", "2027-04", 1),
            goal("b", "300000.00", "2027-10", 2),
        ],
    )
    via_scenario = outcomes(project(plan, scenario(priority_order=["b", "a"])))
    swapped = make_plan(
        income="50000.00",
        expenses="0.00",
        goals=[
            goal("a", "300000.00", "2027-04", 2),
            goal("b", "300000.00", "2027-10", 1),
        ],
    )
    direct = outcomes(project(swapped))
    assert via_scenario == direct


def test_crowded_out_by_names_the_goal_that_took_the_money():
    plan = make_plan(
        income="50000.00",
        expenses="0.00",
        goals=[
            goal("a", "300000.00", "2027-04", 1),
            goal("b", "300000.00", "2027-10", 2),
        ],
    )
    result = outcomes(project(plan, scenario(priority_order=["b", "a"])))
    assert [c.goal_id for c in result["a"].crowded_out_by] == ["b"]
    assert result["b"].crowded_out_by == []


def test_extra_monthly_savings_closes_the_gap():
    plan = load_sample_plan("tiny_delayed_goal")
    fixed = project(plan, scenario(extra_monthly_savings="10000.00"))
    assert fixed.goals[0].status == "on_track"
    assert fixed.summary.plan_feasible is True


def test_goal_override_moves_the_deadline():
    plan = load_sample_plan("tiny_delayed_goal")
    moved = project(
        plan, scenario(goal_overrides=[{"goal_id": "home_deposit", "target_date": "2028-02"}])
    )
    assert moved.goals[0].status == "on_track"


# --- errors the API reports as 422 ------------------------------------------


@pytest.mark.parametrize(
    "bad",
    [
        {"priority_order": ["g", "ghost"]},
        {"priority_order": []},
        {"goal_overrides": [{"goal_id": "ghost", "target_date": "2028-01"}]},
        {"goal_overrides": [{"goal_id": "g", "target_date": "2026-10"}]},
        {
            "events": [
                {
                    "type": "income_change",
                    "stream_id": "ghost",
                    "from_month": "2027-01",
                    "to_month": "2027-02",
                    "multiplier": "0",
                }
            ]
        },
    ],
)
def test_inconsistent_scenarios_raise_value_error(bad):
    with pytest.raises(ValueError):
        project(one_goal_plan(), scenario(**bad))


def test_events_outside_the_plan_are_flagged():
    result = project(
        one_goal_plan(),
        scenario(
            events=[
                {
                    "type": "one_time_expense",
                    "month": "2020-01",
                    "amount": "1000.00",
                    "label": "Old",
                }
            ]
        ),
    )
    assert any(w.code == "event_outside_plan" for w in result.warnings)


# --- invariants over seeded random plans -------------------------------------


def random_plan(rng: random.Random):
    count = rng.randint(1, 5)
    priorities = list(range(1, count + 1))
    rng.shuffle(priorities)
    goals = []
    for index, priority in enumerate(priorities):
        target = rng.randint(50, 3000) * 1000
        months_ahead = rng.randint(3, 150)
        year, month = divmod(2026 * 12 + 10 + months_ahead, 12)
        saved = rng.randint(0, target // 1000 // 2) * 1000
        kind = "emergency_fund" if rng.random() < 0.15 else "custom"
        goals.append(
            {
                **goal(
                    f"g{index}",
                    f"{target}.00",
                    f"{year:04d}-{month + 1:02d}",
                    priority,
                    f"{saved}.00",
                ),
                "type": kind,
                "inflation_linked": rng.random() < 0.6,
            }
        )
    plan = make_plan(
        income=f"{rng.randint(20, 250) * 1000}.00",
        expenses=f"{rng.randint(0, 200) * 1000}.00",
        goals=goals,
    )
    return plan.model_copy(
        update={
            "assumptions": plan.assumptions.model_copy(
                update={
                    "general_inflation_annual": D(f"0.0{rng.randint(0, 9)}"),
                    "savings_return_annual": D(f"0.0{rng.randint(0, 8)}"),
                    "income_growth_annual": D(f"0.0{rng.randint(0, 6)}"),
                }
            ),
            "unassigned_savings": D(f"{rng.randint(0, 100) * 1000}.00"),
        }
    )


def random_scenario(rng: random.Random):
    events = []
    if rng.random() < 0.7:
        start = rng.randint(1, 30)
        year, month = divmod(2026 * 12 + 9 + start, 12)
        end_year, end_month = divmod(2026 * 12 + 9 + start + rng.randint(0, 8), 12)
        events.append(
            {
                "type": "income_change",
                "stream_id": None,
                "from_month": f"{year:04d}-{month + 1:02d}",
                "to_month": f"{end_year:04d}-{end_month + 1:02d}",
                "multiplier": rng.choice(["0", "0.5"]),
            }
        )
    if rng.random() < 0.5:
        events.append(
            {
                "type": "one_time_expense",
                "month": "2027-03",
                "amount": f"{rng.randint(1, 300) * 1000}.00",
                "label": "Bill",
            }
        )
    return scenario(events=events)


def starting_assets(plan):
    return plan.unassigned_savings + sum((g.current_savings for g in plan.goals), Decimal(0))


@pytest.mark.parametrize("seed", range(40))
def test_money_is_conserved_and_never_negative(seed):
    rng = random.Random(seed)
    plan, scn = random_plan(rng), random_scenario(rng)
    result = project(plan, scn)
    assets = starting_assets(plan)
    for row in result.monthly:
        growth = sum((g.growth for g in row.goals), Decimal(0))
        now = row.free_cash + sum((g.balance for g in row.goals), Decimal(0))
        assert now - assets == row.surplus + row.uncovered_deficit + growth, row.month
        assert row.free_cash >= 0
        assert all(g.balance >= 0 for g in row.goals)
        assets = now


@pytest.mark.parametrize("seed", range(20))
def test_results_are_deterministic_and_ignore_input_order(seed):
    rng = random.Random(1000 + seed)
    plan, scn = random_plan(rng), random_scenario(rng)
    first = project(plan, scn)
    assert project(plan, scn) == first
    shuffled = plan.model_copy(update={"goals": list(reversed(plan.goals))})
    assert project(shuffled, scn) == first


@pytest.mark.parametrize("seed", range(30))
def test_extra_savings_never_delay_any_goal(seed):
    rng = random.Random(2000 + seed)
    plan = random_plan(rng)
    base = outcomes(project(plan, include_monthly=False))
    richer = outcomes(
        project(plan, scenario(extra_monthly_savings="5000.00"), include_monthly=False)
    )
    never = 10**6
    for goal_id, before in base.items():
        after = richer[goal_id]

        def month_index(value):
            if value is None:
                return never
            year, month = value.split("-")
            return int(year) * 12 + int(month)

        assert month_index(after.projected_completion) <= month_index(before.projected_completion)


def test_zero_rates_helper_stays_in_sync_with_the_schema():
    assert set(ZERO_RATES) == {
        "general_inflation_annual",
        "savings_return_annual",
        "income_growth_annual",
        "expense_growth_annual",
    }
