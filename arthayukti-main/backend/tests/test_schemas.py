import copy
import json

import pytest
from pydantic import TypeAdapter, ValidationError

from app.schemas.plan import Plan, PlanWithGoals
from app.schemas.scenario import Scenario
from tests.engine.helpers import SAMPLES, goal, make_plan


def base() -> dict:
    return copy.deepcopy(
        json.loads((SAMPLES / "tiny_delayed_goal.json").read_text(encoding="utf-8"))["plan"]
    )


def test_bundled_samples_validate():
    for path in SAMPLES.glob("*.json"):
        data = json.loads(path.read_text(encoding="utf-8"))
        Plan.model_validate(data["plan"])
        for scenario in data["scenarios"]:
            Scenario.model_validate(scenario)


def mutate_and_expect_error(mutator, fragment: str) -> None:
    data = base()
    mutator(data)
    with pytest.raises(ValidationError) as excinfo:
        Plan.model_validate(data)
    assert fragment in str(excinfo.value)


def test_target_date_must_not_be_before_as_of():
    mutate_and_expect_error(
        lambda d: d["goals"][0].update(target_date="2026-10"),
        "target_date must not be before as_of",
    )
    mutate_and_expect_error(
        lambda d: d["goals"][0].update(target_date="2025-01"),
        "target_date must not be before as_of",
    )


def test_a_goal_may_be_due_in_the_first_plan_month():
    data = base()
    data["goals"][0]["target_date"] = data["as_of"]
    Plan.model_validate(data)


def test_target_date_must_be_within_the_horizon():
    mutate_and_expect_error(lambda d: d["goals"][0].update(target_date="2080-01"), "months away")


def test_priorities_must_be_unique_and_contiguous():
    data = base()
    data["goals"].append({**goal("second", "100000.00", "2027-10", 1)})
    with pytest.raises(ValidationError, match="unique and run 1..n"):
        Plan.model_validate(data)
    data["goals"][1]["priority"] = 3
    with pytest.raises(ValidationError, match="unique and run 1..n"):
        Plan.model_validate(data)


def test_duplicate_ids_are_rejected():
    data = base()
    data["goals"].append({**goal("home_deposit", "100000.00", "2027-10", 2)})
    with pytest.raises(ValidationError, match="goal ids must be unique"):
        Plan.model_validate(data)


def test_goal_count_is_limited():
    goals = [goal(f"g{i}", "100000.00", "2027-10", i) for i in range(1, 10)]
    with pytest.raises(ValidationError):
        make_plan(income="90000.00", expenses="0.00", goals=goals)


def test_a_plan_can_be_saved_without_goals_but_goal_based_work_and_income_are_still_required():
    # Income and spending come first, so a plan with no goals yet is a valid thing to keep ...
    data = base()
    data["goals"] = []
    assert Plan.model_validate(data).goals == []
    # ... but anything that works out goals refuses it, with the same validation error as before.
    with pytest.raises(ValidationError, match="at least one goal"):
        TypeAdapter(PlanWithGoals).validate_python(data)
    assert len(TypeAdapter(PlanWithGoals).validate_python(base()).goals) >= 1
    # At least one income stream is still required.
    data = base()
    data["income_streams"] = []
    with pytest.raises(ValidationError):
        Plan.model_validate(data)


@pytest.mark.parametrize(
    ("path", "value"),
    [
        (("income_streams", 0, "monthly_net"), "-1.00"),
        (("goals", 0, "target_amount_today"), "0.00"),
        (("goals", 0, "target_amount_today"), "1000000000.01"),
        (("goals", 0, "target_amount_today"), "100.123"),
        (("goals", 0, "target_amount_today"), "1e5"),
        (("goals", 0, "target_amount_today"), "NaN"),
        (("goals", 0, "target_amount_today"), 600000),
        (("goals", 0, "target_amount_today"), 600000.5),
        (("goals", 0, "current_savings"), "-5.00"),
        (("assumptions", "general_inflation_annual"), "1.50"),
        (("assumptions", "savings_return_annual"), "-0.01"),
        (("assumptions", "income_growth_annual"), "-0.50"),
        (("as_of",), "2026-13"),
        (("as_of",), "26-11"),
        (("goals", 0, "target_date"), "2027-1"),
        (("currency",), "USD"),
    ],
)
def test_invalid_values_are_rejected(path, value):
    data = base()
    target = data
    for key in path[:-1]:
        target = target[key]
    target[path[-1]] = value
    with pytest.raises(ValidationError):
        Plan.model_validate(data)


def test_unknown_fields_are_rejected():
    data = base()
    data["surprise"] = True
    with pytest.raises(ValidationError):
        Plan.model_validate(data)


def test_rates_have_no_defaults():
    data = base()
    del data["assumptions"]["general_inflation_annual"]
    with pytest.raises(ValidationError):
        Plan.model_validate(data)


def test_income_stream_cannot_end_before_the_plan_starts():
    mutate_and_expect_error(
        lambda d: d["income_streams"][0].update(ends_after="2026-01"), "ends_after is before as_of"
    )


def test_event_range_must_be_ordered():
    with pytest.raises(ValidationError, match="to_month must not be before from_month"):
        Scenario.model_validate(
            {
                "events": [
                    {
                        "type": "income_change",
                        "stream_id": None,
                        "from_month": "2027-05",
                        "to_month": "2027-01",
                        "multiplier": "0",
                    }
                ]
            }
        )


def test_goal_override_must_change_something():
    with pytest.raises(ValidationError, match="must change"):
        Scenario.model_validate({"goal_overrides": [{"goal_id": "g"}]})


def test_unknown_event_type_is_rejected():
    with pytest.raises(ValidationError):
        Scenario.model_validate({"events": [{"type": "lottery_win", "month": "2027-01"}]})
