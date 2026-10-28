"""Reading a typed question into structured hints, then handing it to the deterministic engines.

This is keyword and pattern matching, not a language model, and it says so in its output. It can
only suggest goals and constraints for the person to confirm. It never produces a monetary result:
every figure in a response comes from the rescue engine.
"""

import re
from dataclasses import dataclass
from decimal import Decimal
from typing import Any

from app.engine.rescue import RescueAnalysisResult, run_rescue_analysis
from app.schemas.plan import Plan
from app.schemas.scenario import Scenario

EXTRACTION_METHOD = "keyword_rules"

# An amount is only trusted when the text marks it as money: a currency word or symbol, a unit
# such as lakh or crore, or at least five digits. "in 2 years" must never become Rs 2.
_AMOUNT = re.compile(
    r"(?P<cur>rs\.?|inr|₹)?\s*(?P<num>\d[\d,]*(?:\.\d+)?)\s*(?P<unit>lakh|lac|crore|k)?\b"
    r"(?!\s*(?:years?|yrs?|months?|weeks?|days?|%|percent))"
)


@dataclass
class ParsedFinancialIntent:
    identified_goals: list[dict[str, Any]]
    detected_constraints: list[str]
    missing_critical_info: list[str]
    plain_english_summary: str
    plain_hindi_summary: str


def _find_amount(text: str, keywords: str) -> Decimal | None:
    keyword = re.search(keywords, text)
    if not keyword:
        return None
    for match in _AMOUNT.finditer(text, keyword.end()):
        if match.start() - keyword.end() > 60:
            break
        raw = Decimal(match.group("num").replace(",", ""))
        unit = match.group("unit")
        if not (match.group("cur") or unit or len(match.group("num").replace(",", "")) >= 5):
            continue
        return _parse_inr_amount(raw, unit)
    return None


def parse_natural_language_intent(
    user_prompt: str, base_plan: Plan | None = None
) -> ParsedFinancialIntent:
    """Pick out goals, amounts and constraints that the text states in plain words."""
    text = user_prompt.lower()
    identified_goals: list[dict[str, Any]] = []
    detected_constraints: list[str] = []
    missing_critical_info: list[str] = []

    if any(p in text for p in ("no debt", "avoid debt", "without loan", "without debt")):
        detected_constraints.append("avoid_new_debt")
    if "emergency fund" in text or "reserve" in text:
        detected_constraints.append("maintain_emergency_reserve")
    if "rent" in text and "buy" in text:
        detected_constraints.append("compare_rent_vs_buy")
    if "car" in text and any(p in text for p in ("public transport", "cab", "metro")):
        detected_constraints.append("compare_transit_vs_car")

    for goal_type, label, keywords in (
        ("custom", "Car purchase", r"\b(car|vehicle|auto)\b"),
        ("home", "Home purchase", r"\b(home|house|flat|apartment)\b"),
        ("education", "Education", r"\b(education|tuition|college|school|mba)\b"),
    ):
        amount = _find_amount(text, keywords)
        if amount is not None:
            identified_goals.append(
                {"type": goal_type, "label": label, "target_amount_today": str(amount)}
            )
        elif re.search(keywords, text):
            missing_critical_info.append(f"How much the {label.lower()} costs, in rupees")

    if not any(g for g in identified_goals) and not missing_critical_info:
        missing_critical_info.append("Which goal or decision you want to look at")
    missing_critical_info.append("When you want each goal to be done")
    if not base_plan:
        missing_critical_info.append("Your monthly income and spending")

    english = (
        f"Found {len(identified_goals)} goal(s) with an amount and "
        f"{len(detected_constraints)} constraint(s) in your question. "
        "Please check them. These are suggestions from keyword matching, not calculations."
    )
    hindi = (
        f"आपके सवाल में {len(identified_goals)} राशि वाले लक्ष्य और "
        f"{len(detected_constraints)} शर्तें मिलीं। कृपया इन्हें जाँच लें। "
        "ये शब्द पहचानकर बने सुझाव हैं, गणना नहीं।"
    )
    return ParsedFinancialIntent(
        identified_goals=identified_goals,
        detected_constraints=detected_constraints,
        missing_critical_info=missing_critical_info,
        plain_english_summary=english,
        plain_hindi_summary=hindi,
    )


def consult_and_rescue(
    user_prompt: str,
    plan: Plan,
    scenario: Scenario | None = None,
) -> dict[str, Any]:
    """Read the question, then run the rescue engine on the plan that was sent with it."""
    parsed = parse_natural_language_intent(user_prompt, plan)

    rescue_res: RescueAnalysisResult = run_rescue_analysis(
        plan=plan,
        scenario=scenario,
        avoid_new_debt="avoid_new_debt" in parsed.detected_constraints,
        housing_mode="rent_vs_buy"
        if "compare_rent_vs_buy" in parsed.detected_constraints
        else None,
        transit_mode=(
            "transit_vs_car" if "compare_transit_vs_car" in parsed.detected_constraints else None
        ),
    )

    return {
        "intent": {
            "extraction_method": EXTRACTION_METHOD,
            "identified_goals": parsed.identified_goals,
            "detected_constraints": parsed.detected_constraints,
            "missing_critical_info": parsed.missing_critical_info,
            "plain_english_summary": parsed.plain_english_summary,
            "plain_hindi_summary": parsed.plain_hindi_summary,
        },
        "is_baseline_feasible": rescue_res.is_baseline_feasible,
        "recommended_alternative_id": rescue_res.recommended_alternative_id,
        "binding_constraint": rescue_res.binding_constraint,
        "unresolved_gap": rescue_res.unresolved_gap,
        "ranking_criteria": rescue_res.ranking_criteria,
        "missing_information": rescue_res.missing_information,
        "alternatives": [
            {
                "alternative_id": a.alternative_id,
                "title": a.title,
                "description": a.description,
                "strategy": a.strategy,
                "is_feasible": a.is_feasible,
                "total_shortfall_today": a.total_shortfall_today,
                "monthly_savings_change": a.monthly_savings_change,
                "constraints_satisfied": a.constraints_satisfied,
                "constraints_violated": a.constraints_violated,
                "tradeoffs": a.tradeoffs_summary,
                "assumptions": a.assumptions,
            }
            for a in rescue_res.alternatives
        ],
        "calculation_run_id": rescue_res.run_id,
    }


def _parse_inr_amount(raw: Decimal, unit_str: str | None) -> Decimal:
    unit = (unit_str or "").lower().strip()
    if unit in ("lakh", "lac"):
        return raw * Decimal(100000)
    if unit == "crore":
        return raw * Decimal(10000000)
    if unit == "k":
        return raw * Decimal(1000)
    return raw
