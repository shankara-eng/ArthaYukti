"""Builders for hand-checkable plans used by the golden tests."""

import json
from pathlib import Path

from app.schemas.plan import Plan

SAMPLES = Path(__file__).resolve().parents[3] / "contracts" / "samples"

ZERO_RATES = {
    "general_inflation_annual": "0",
    "savings_return_annual": "0",
    "income_growth_annual": "0",
    "expense_growth_annual": "0",
}


def goal(id: str, target: str, date: str, priority: int, saved: str = "0.00") -> dict:
    return {
        "id": id,
        "label": id.upper(),
        "type": "custom",
        "target_amount_today": target,
        "target_date": date,
        "priority": priority,
        "inflation_linked": False,
        "inflation_rate_override": None,
        "current_savings": saved,
    }


def make_plan(
    *,
    income: str,
    expenses: str,
    goals: list[dict],
    commitments: list[dict] | None = None,
    as_of: str = "2026-11",
) -> Plan:
    return Plan.model_validate(
        {
            "name": "Test plan",
            "as_of": as_of,
            "currency": "INR",
            "income_streams": [{"id": "salary", "label": "Salary", "monthly_net": income}],
            "expenses": [{"id": "living", "label": "Living", "monthly": expenses}],
            "commitments": commitments or [],
            "goals": goals,
            "assumptions": ZERO_RATES,
        }
    )


def load_sample_plan(sample_id: str) -> Plan:
    data = json.loads((SAMPLES / f"{sample_id}.json").read_text(encoding="utf-8"))
    return Plan.model_validate(data["plan"])
