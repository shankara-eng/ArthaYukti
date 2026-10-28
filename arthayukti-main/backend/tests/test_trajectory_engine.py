"""The Financial Trajectory engine: accounting invariants and hand-checked reference cases.

Every expected figure is worked out by hand in the comment beside it. The plans use zero growth and zero returns, so
the arithmetic stays visible. Nothing here reads the database: the engine takes plain inputs.
"""

from decimal import Decimal

import pytest

from app.engine.debt import calculate_amortization_schedule
from app.engine.trajectory import (
    AccountIn,
    GoalEffectIn,
    HoldingIn,
    Inputs,
    LoanIn,
    PlannedEventIn,
    PolicyIn,
    RateIn,
    contains_insurance_spending,
    loan_schedule,
    premium_due,
    run_trajectory,
)
from app.schemas.plan import Plan
from app.schemas.scenario import ExpenseChange, Scenario

D = Decimal


def make_plan(income="100000.00", expenses=(), goals=(), commitments=(), as_of="2027-01", unassigned="0.00"):
    return Plan.model_validate(
        {
            "name": "Test",
            "as_of": as_of,
            "currency": "INR",
            "income_streams": [{"id": "inc", "label": "Salary", "monthly_net": income, "ends_after": None}],
            "expenses": [{"id": f"e{i}", "label": label, "monthly": amount, "essential": True} for i, (label, amount) in enumerate(expenses)],
            "commitments": [{"id": f"c{i}", "label": label, "monthly_payment": amount, "remaining_months": months} for i, (label, amount, months) in enumerate(commitments)],
            "unassigned_savings": unassigned,
            "goals": [
                {
                    "id": gid,
                    "label": gid.title(),
                    "type": gtype,
                    "target_amount_today": target,
                    "target_date": date,
                    "priority": i + 1,
                    "inflation_linked": False,
                    "current_savings": saved,
                }
                for i, (gid, gtype, target, date, saved) in enumerate(goals)
            ],
            "assumptions": {
                "general_inflation_annual": "0.050000",
                "savings_return_annual": "0.000000",
                "income_growth_annual": "0.000000",
                "expense_growth_annual": "0.000000",
            },
        }
    )


def make_inputs(plan, months=12, cash="0.00", **kw):
    base = {
        "plan": plan,
        "horizon_months": months,
        "view": "baseline",
        "selected_goal_ids": [],
        "scenario": None,
        "opening_cash": D(cash),
        "cash_source": "test",
        "accounts": [],
        "holdings": [],
        "loans": [],
        "policies": [],
    }
    base.update(kw)
    return Inputs(**base)


def holding(hid="h1", value="100000.00", asset_type="stock", status="fresh"):
    return HoldingIn(hid, "Holding", asset_type, D(value), "market_snapshot", status, "2027-01-01", "TEST", None)


def policy(**extra):
    base = {
        "id": "p1",
        "name": "Term",
        "policy_type": "term_life",
        "premium": D("12000.00"),
        "frequency": "annual",
        "status": "active",
        "start_date": "2020-06-15",
        "renewal_date": "2027-06-15",
        "expiry_date": None,
        "fund_value": None,
        "maturity_benefit": None,
        "maturity_date": None,
    }
    base.update(extra)
    return PolicyIn(**base)


def events(result, group):
    return [e for row in result["monthly_ledger"] for e in row[group]]


def assert_reconciled(result):
    assert result["summary"]["reconciles"] is True
    for row in result["monthly_ledger"]:
        opening, closing = row["opening_balances"], row["closing_balances"]
        effect = sum(
            (e["net_worth_effect"] for name in row if name.endswith("_events") for e in row[name]),
            D("0.00"),
        )
        assert closing["net_worth"] - opening["net_worth"] == effect  # the ledger explains every change
        assert closing["total_assets"] - closing["total_liabilities"] == closing["net_worth"]
        assert closing["cash"] >= 0  # cash never goes below zero: a gap is a visible shortfall
    for a, b in zip(result["monthly_ledger"], result["monthly_ledger"][1:], strict=False):
        assert a["closing_balances"] == b["opening_balances"]


# ---- the simplest timeline ------------------------------------------------------------------------------------------


def test_income_less_spending_accumulates_as_cash_and_net_worth():
    plan = make_plan("100000.00", [("Rent", "40000.00"), ("Food", "20000.00")])
    result = run_trajectory(make_inputs(plan, 12, cash="100000.00"))
    # 100000 - 60000 = 40000 a month. 100000 + 12 x 40000 = 580000.
    assert result["summary"]["current_net_worth"] == D("100000.00")
    assert result["summary"]["horizon_cash"] == D("580000.00") == result["summary"]["horizon_net_worth"]
    assert [c["months_ahead"] for c in result["checkpoints"]] == [0, 12]
    assert_reconciled(result)


def test_identical_inputs_give_identical_results():
    plan = make_plan(expenses=[("Rent", "40000.00")])
    inputs = make_inputs(plan, 36, cash="1000.00", loans=[LoanIn("l1", "Car", "auto_loan", D("200000.00"), D("0.09"), D("8000.00"), 30)])
    assert run_trajectory(inputs) == run_trajectory(inputs)


def test_a_projection_never_changes_its_inputs():
    plan = make_plan(expenses=[("Rent", "40000.00")], goals=[("home", "home", "100000.00", "2027-12", "0.00")])
    before = plan.model_dump_json()
    inputs = make_inputs(plan, 24, cash="5000.00", view="selected_goals", selected_goal_ids=["home"])
    run_trajectory(inputs)
    assert plan.model_dump_json() == before


def test_baseline_excludes_future_goals_but_keeps_what_is_already_saved_for_them():
    plan = make_plan("50000.00", [("Life", "30000.00")], goals=[("home", "home", "100000.00", "2027-12", "25000.00")])
    result = run_trajectory(make_inputs(plan, 6))
    # No contribution to the goal: 20000 a month stays in cash. The 25000 already saved is a ring-fenced asset, held.
    assert result["summary"]["horizon_cash"] == D("120000.00")
    assert result["opening_balances"]["goal_funds"] == D("25000.00")
    assert result["summary"]["horizon_net_worth"] == D("145000.00")
    assert result["goals"] == []


# ---- reference cases from the specification --------------------------------------------------------------------------


def test_bank_to_equity_transfer_is_not_an_expense():
    plan = make_plan("0.00")
    base = run_trajectory(make_inputs(plan, 3, cash="100000.00"))
    moved = run_trajectory(
        make_inputs(plan, 3, cash="100000.00", planned_events=[PlannedEventIn("buy1", "2027-02", "investment_purchase", "Buy units", amount=D("50000.00"))])
    )
    row = moved["monthly_ledger"][1]  # February
    event = row["investment_events"][0]
    # Cash -50000, the investment +50000: net worth unchanged.
    assert (event["cash_delta"], event["asset_delta"], event["net_worth_effect"]) == (D("-50000.00"), D("50000.00"), D("0.00"))
    assert row["closing_balances"]["cash"] == D("50000.00") and row["closing_balances"]["market_investments"] == D("50000.00")
    assert moved["summary"]["horizon_net_worth"] == base["summary"]["horizon_net_worth"]
    assert_reconciled(moved)


def test_charges_on_a_purchase_reduce_net_worth_but_the_transfer_does_not():
    plan = make_plan("0.00")
    moved = run_trajectory(
        make_inputs(plan, 2, cash="100000.00", planned_events=[PlannedEventIn("b", "2027-01", "investment_purchase", "Buy", amount=D("50000.00"), charges=D("150.00"))])
    )
    assert moved["summary"]["horizon_net_worth"] == D("99850.00")  # only the 150 of charges is lost
    assert moved["drivers"]["investment_charges"] == D("150.00")


def test_emi_principal_reduces_the_debt_and_only_interest_reduces_net_worth():
    plan = make_plan("0.00")
    loan = LoanIn("l1", "Home loan", "home_loan", D("360000.00"), D("0.10"), D("10000.00"), 60)
    result = run_trajectory(make_inputs(plan, 1, cash="100000.00", loans=[loan]))
    event = events(result, "debt_events")[0]
    # Interest 360000 x 10% / 12 = 3000. Principal 10000 - 3000 = 7000.
    assert (event["interest"], event["principal"]) == (D("3000.00"), D("7000.00"))
    assert (event["cash_delta"], event["liability_delta"], event["net_worth_effect"]) == (D("-10000.00"), D("-7000.00"), D("-3000.00"))
    closing = result["monthly_ledger"][0]["closing_balances"]
    assert (closing["cash"], closing["loans"]) == (D("90000.00"), D("353000.00"))
    # The 10000 leaves cash once: it is not also a 7000 expense on top of the loan.
    assert closing["net_worth"] == D("-263000.00")  # 90000 cash - 353000 debt: only the 3000 of interest was lost
    assert result["summary"]["current_net_worth"] == D("-260000.00")  # 100000 cash - 360000 debt
    assert result["summary"]["horizon_net_worth"] == D("-263000.00")  # the 3000 of interest
    assert_reconciled(result)


def test_loan_balances_equal_the_debt_calculators_schedule_to_the_paisa():
    loan = LoanIn("l1", "Car", "auto_loan", D("250000.00"), D("0.095"), D("9000.00"), 36)
    expected = calculate_amortization_schedule(principal=loan.balance, annual_rate=loan.rate, tenure_months=36, monthly_emi=loan.payment)["schedule"]
    result = run_trajectory(make_inputs(make_plan("0.00"), 40, cash="900000.00", loans=[loan]))
    for item in expected:
        row = result["monthly_ledger"][int(item["month"]) - 1]
        assert row["closing_balances"]["loans"] == D(str(item["remaining_balance"]))
        assert row["debt_events"][0]["principal"] == D(str(item["principal_paid"]))
    last = len(expected)
    assert result["monthly_ledger"][last - 1]["closing_balances"]["loans"] == D("0.00")
    assert not result["monthly_ledger"][last]["debt_events"]  # no payment after the debt is cleared
    assert result["summary"]["projected_debt_free_dates"][0]["month"] == result["monthly_ledger"][last - 1]["month"]
    assert_reconciled(result)


def test_a_projected_payoff_does_not_touch_the_record_and_never_goes_negative():
    loan = LoanIn("l1", "Car", "auto_loan", D("30000.00"), D("0.12"), D("5000.00"), 0)
    result = run_trajectory(make_inputs(make_plan("0.00"), 24, cash="500000.00", loans=[loan]))
    assert loan.balance == D("30000.00")
    assert all(row["closing_balances"]["loans"] >= 0 for row in result["monthly_ledger"])


def test_a_debt_with_a_balance_but_no_payment_keeps_its_balance_and_says_the_payoff_is_unknown():
    loan = LoanIn("l1", "Friend", "personal_loan", D("80000.00"), D("0.00"), D("0.00"), 12)
    result = run_trajectory(make_inputs(make_plan("0.00"), 12, cash="10000.00", loans=[loan]))
    assert not events(result, "debt_events")
    assert result["monthly_ledger"][-1]["closing_balances"]["loans"] == D("80000.00")
    codes = [w["code"] for w in result["warnings"]]
    assert "loan_payment_missing" in codes
    assert result["summary"]["projected_debt_free_dates"][0]["month"] is None
    assert result["completeness"]["status"] == "partial"
    assert any(m["record"] == "debt" and m["field"] == "monthly_emi" for m in result["completeness"]["missing"])


def test_a_payment_below_the_interest_lets_the_balance_grow_and_says_so():
    loan = LoanIn("l1", "Loan", "personal_loan", D("100000.00"), D("0.12"), D("500.00"), 24)
    result = run_trajectory(make_inputs(make_plan("0.00"), 6, cash="100000.00", loans=[loan]))
    balances = [row["closing_balances"]["loans"] for row in result["monthly_ledger"]]
    assert balances == sorted(balances) and balances[-1] > D("100000.00")
    assert "loan_payment_below_interest" in [w["code"] for w in result["warnings"]]
    assert_reconciled(result)


def test_a_recorded_zero_rate_cannot_be_told_from_a_missing_one_so_it_is_flagged():
    loan = LoanIn("l1", "Loan", "personal_loan", D("12000.00"), D("0.00"), D("1000.00"), 12)
    result = run_trajectory(make_inputs(make_plan("0.00"), 12, cash="50000.00", loans=[loan]))
    assert "loan_rate_zero" in [w["code"] for w in result["warnings"]]
    assert any(m["field"] == "interest_rate" for m in result["completeness"]["missing"])


def test_a_loan_payment_recorded_in_both_the_plan_and_the_debts_is_flagged_and_can_be_linked():
    plan = make_plan("100000.00", commitments=[("Home EMI", "10000.00", 60)])
    loan = LoanIn("l1", "Home loan", "home_loan", D("360000.00"), D("0.10"), D("10000.00"), 60)
    unlinked = run_trajectory(make_inputs(plan, 1, cash="0.00", loans=[loan]))
    assert "possible_duplicate_debt" in [w["code"] for w in unlinked["warnings"]]
    assert unlinked["monthly_ledger"][0]["closing_balances"]["cash"] == D("80000.00")  # counted twice
    linked = run_trajectory(make_inputs(plan, 1, cash="0.00", loans=[loan], linked_commitments={"c0": "l1"}))
    assert linked["monthly_ledger"][0]["closing_balances"]["cash"] == D("90000.00")  # once, as the debt
    assert "possible_duplicate_debt" not in [w["code"] for w in linked["warnings"]]


def test_loans_in_the_plan_alone_are_spending_with_an_unknown_split():
    plan = make_plan("100000.00", commitments=[("Car EMI", "12000.00", 60)])
    result = run_trajectory(make_inputs(plan, 1))
    assert result["monthly_ledger"][0]["closing_balances"]["cash"] == D("88000.00")
    assert "plan_loans_unsplit" in [w["code"] for w in result["warnings"]]
    assert result["monthly_ledger"][0]["closing_balances"]["loans"] == D("0.00")


# ---- insurance --------------------------------------------------------------------------------------------------------


def test_an_annual_premium_is_paid_once_in_its_month_and_cover_is_not_an_asset():
    result = run_trajectory(make_inputs(make_plan("0.00"), 12, cash="100000.00", policies=[policy()]))
    premiums = events(result, "insurance_events")
    assert [e["month"] for e in premiums] == ["2027-06"] and premiums[0]["cash_delta"] == D("-12000.00")
    assert result["summary"]["horizon_net_worth"] == D("88000.00")
    assert result["opening_balances"]["total_assets"] == D("100000.00")  # a 1 crore cover adds nothing
    assert_reconciled(result)


def test_a_premium_already_in_planned_spending_is_not_taken_twice():
    plan = make_plan("0.00", [("Insurance premium", "1000.00")])
    assert contains_insurance_spending(plan)
    counted_once = run_trajectory(make_inputs(plan, 12, cash="100000.00", policies=[policy()], premiums_in_spending=True))
    taken_twice = run_trajectory(make_inputs(plan, 12, cash="100000.00", policies=[policy()], premiums_in_spending=False))
    # 12 x 1000 of spending. With the link, the policy's 12000 is not added on top (not 24000 out, not 12000 + 12000).
    assert counted_once["summary"]["horizon_cash"] == D("88000.00")
    assert taken_twice["summary"]["horizon_cash"] == D("76000.00")
    note = [e for e in events(counted_once, "insurance_events")][0]
    assert note["cash_delta"] == D("0.00") and "already counted" in note["note"]
    assert counted_once["drivers"]["premiums_paid"] == D("0.00")


def test_premium_schedules_follow_the_frequency_and_stop_at_expiry_or_when_not_active():
    def months(**extra):
        r = run_trajectory(make_inputs(make_plan("0.00"), 24, cash="900000.00", policies=[policy(**extra)]))
        return [e["month"] for e in events(r, "insurance_events")]

    assert months(frequency="annual") == ["2027-06", "2028-06"]
    assert months(frequency="quarterly", premium=D("3000.00")) == ["2027-03", "2027-06", "2027-09", "2027-12", "2028-03", "2028-06", "2028-09", "2028-12"]
    assert len(months(frequency="monthly", premium=D("1000.00"))) == 24
    assert months(expiry_date="2027-06-30") == ["2027-06"]  # the expiry month's premium is the last
    assert months(status="lapsed") == [] and months(status="expired") == []
    assert premium_due(policy(frequency="annual"), 2027 * 12 + 5)  # June


def test_renewal_prices_are_held_unless_the_person_sets_a_growth():
    held = run_trajectory(make_inputs(make_plan("0.00"), 24, cash="900000.00", policies=[policy()]))
    grown = run_trajectory(make_inputs(make_plan("0.00"), 24, cash="900000.00", policies=[policy()], premium_growth=D("0.10")))
    assert [e["cash_delta"] for e in events(held, "insurance_events")] == [D("-12000.00")] * 2
    assert [e["cash_delta"] for e in events(grown, "insurance_events")] == [D("-12000.00"), D("-13200.00")]
    assert "renewal_price_unknown" in [w["code"] for w in held["warnings"]]


def test_a_documented_maturity_benefit_arrives_once_in_its_month():
    pol = policy(policy_type="endowment_money_back", frequency="annual", premium=D("0.00"), maturity_benefit=D("250000.00"), maturity_date="2027-09-30")
    result = run_trajectory(make_inputs(make_plan("0.00"), 24, cash="10000.00", policies=[pol]))
    benefits = [e for e in events(result, "insurance_events") if e["kind"] == "maturity_benefit"]
    assert [(e["month"], e["cash_delta"]) for e in benefits] == [("2027-09", D("250000.00"))]
    assert result["summary"]["horizon_cash"] == D("260000.00")  # received once, not again next year
    assert_reconciled(result)


def test_an_undocumented_benefit_is_not_invented():
    pol = policy(policy_type="endowment_money_back", premium=D("0.00"))
    result = run_trajectory(make_inputs(make_plan("0.00"), 12, cash="10000.00", policies=[pol]))
    assert "benefit_unknown" in [w["code"] for w in result["warnings"]]
    assert result["summary"]["horizon_cash"] == D("10000.00")


def test_a_ulip_fund_value_is_counted_once_and_an_unknown_one_is_left_out_and_reported():
    known = run_trajectory(make_inputs(make_plan("0.00"), 6, cash="10000.00", policies=[policy(policy_type="ulip", premium=D("0.00"), fund_value=D("200000.00"))]))
    assert known["opening_balances"]["insurance_fund_value"] == D("200000.00")
    assert known["summary"]["current_assets"] == D("210000.00")  # fund value once; the sum assured is cover, not an asset
    unknown = run_trajectory(make_inputs(make_plan("0.00"), 6, cash="10000.00", policies=[policy(policy_type="ulip", premium=D("0.00"))]))
    assert unknown["opening_balances"]["insurance_fund_value"] == D("0.00")
    assert "ulip_fund_unknown" in [w["code"] for w in unknown["warnings"]]


# ---- deposits, investments and assets ----------------------------------------------------------------------------------


def test_a_deposit_principal_maturing_becomes_cash_and_net_worth_does_not_change():
    account = AccountIn("fd1", "Bank FD", D("100000.00"), "fixed_deposit", False)
    plain = run_trajectory(make_inputs(make_plan("0.00"), 12, cash="5000.00", accounts=[account]))
    matured = run_trajectory(
        make_inputs(make_plan("0.00"), 12, cash="5000.00", accounts=[account], planned_events=[PlannedEventIn("m", "2027-06", "deposit_maturity", "FD matures", account_id="fd1")])
    )
    row = matured["monthly_ledger"][5]
    assert row["closing_balances"]["cash"] == D("105000.00") and row["closing_balances"]["deposits_and_investment_accounts"] == D("0.00")
    assert matured["summary"]["horizon_net_worth"] == plain["summary"]["horizon_net_worth"] == D("105000.00")
    assert "deposit_terms_not_recorded" in [w["code"] for w in plain["warnings"]]
    assert_reconciled(matured)


def test_a_documented_maturity_value_above_the_balance_adds_only_the_interest():
    account = AccountIn("fd1", "Bank FD", D("100000.00"), "fixed_deposit", False)
    result = run_trajectory(
        make_inputs(make_plan("0.00"), 12, cash="0.00", accounts=[account], planned_events=[PlannedEventIn("m", "2027-06", "deposit_maturity", "FD", account_id="fd1", maturity_amount=D("107000.00"))])
    )
    assert result["summary"]["horizon_cash"] == D("107000.00") and result["summary"]["horizon_net_worth"] == D("107000.00")  # the 7000 is income


def test_values_are_held_constant_without_a_return_assumption_and_say_so():
    result = run_trajectory(make_inputs(make_plan("0.00"), 24, holdings=[holding(value="100000.00")]))
    assert result["summary"]["horizon_net_worth"] == D("100000.00")
    assert not events(result, "investment_events")
    assert any("Held at the recorded value" in a["value"] for a in result["effective_assumptions"])


def test_a_return_assumption_grows_the_opening_balance_monthly_and_is_labelled():
    rates = [RateIn("class", "market_investments", D("0.12"))]
    result = run_trajectory(make_inputs(make_plan("0.00"), 2, holdings=[holding(value="100000.00")], rates=rates))
    first, second = events(result, "investment_events")
    # 100000 x 12% / 12 = 1000.00; next month 101000 x 1% = 1010.00. Growth is not cash.
    assert (first["asset_delta"], first["cash_delta"]) == (D("1000.00"), D("0.00"))
    assert second["asset_delta"] == D("1010.00")
    assert result["summary"]["horizon_net_worth"] == D("102010.00")
    assert any(a["kind"] == "user_assumed" and "12.00%" in a["value"] for a in result["effective_assumptions"])


def test_a_zero_rate_assumption_adds_nothing():
    result = run_trajectory(make_inputs(make_plan("0.00"), 12, holdings=[holding()], rates=[RateIn("holding", "h1", D("0.00"))]))
    assert result["summary"]["horizon_net_worth"] == D("100000.00") and not events(result, "investment_events")


def test_a_holding_specific_assumption_beats_the_class_assumption():
    rates = [RateIn("class", "market_investments", D("0.12")), RateIn("holding", "h1", D("0.00"))]
    result = run_trajectory(make_inputs(make_plan("0.00"), 3, holdings=[holding("h1"), holding("h2", "50000.00")], rates=rates))
    assert all(e["source_id"] == "h2" for e in events(result, "investment_events"))


def test_a_holding_with_no_usable_value_is_left_out_and_reported_never_counted_as_zero():
    unknown = HoldingIn("h9", "Mystery", "stock", None, "none", "unavailable", None, None, "No stored price and no value entered.")
    result = run_trajectory(make_inputs(make_plan("0.00"), 6, cash="1000.00", holdings=[unknown]))
    assert "value_unknown" in [w["code"] for w in result["warnings"]]
    assert result["completeness"]["status"] == "partial"
    assert any(m["record_id"] == "h9" for m in result["completeness"]["missing"])


def test_a_stale_quote_keeps_the_last_value_and_is_marked():
    result = run_trajectory(make_inputs(make_plan("0.00"), 6, holdings=[holding(status="stale")]))
    assert result["opening_balances"]["market_investments"] == D("100000.00")
    warning = next(w for w in result["warnings"] if w["code"] == "stale_quote")
    assert "2027-01-01" in warning["message"] and "TEST" in warning["message"]
    assert result["completeness"]["stale_quotes"] == 1


def test_physical_assets_are_constant_and_a_mortgaged_property_shows_both_sides():
    house = holding("home", "8000000.00", "real_estate")
    loan = LoanIn("l1", "Home loan", "home_loan", D("3000000.00"), D("0.09"), D("40000.00"), 240)
    result = run_trajectory(make_inputs(make_plan("0.00"), 12, cash="500000.00", holdings=[house], loans=[loan]))
    opening = result["opening_balances"]
    assert (opening["physical_and_other_assets"], opening["loans"]) == (D("8000000.00"), D("3000000.00"))
    assert opening["net_worth"] == D("5500000.00")  # 0.5m cash + 8m property - 3m loan, the loan not netted inside the property
    closing = result["monthly_ledger"][-1]["closing_balances"]
    assert closing["physical_and_other_assets"] == D("8000000.00")  # no invented appreciation


# ---- cash shortfall -----------------------------------------------------------------------------------------------------


def test_an_uncovered_gap_is_recorded_not_hidden():
    plan = make_plan("10000.00", [("Life", "30000.00")])
    result = run_trajectory(make_inputs(plan, 5, cash="50000.00"))
    cash = [row["closing_balances"]["cash"] for row in result["monthly_ledger"]]
    shortfall = [row["closing_balances"]["unfunded_shortfall"] for row in result["monthly_ledger"]]
    # -20000 a month. Cash 30000, 10000, then it cannot cover: 10000, 30000, 50000 short.
    assert cash == [D("30000.00"), D("10000.00"), D("0.00"), D("0.00"), D("0.00")]
    assert shortfall == [D("0.00"), D("0.00"), D("10000.00"), D("30000.00"), D("50000.00")]
    assert [row["uncovered_cash_deficit"] for row in result["monthly_ledger"]][2:] == [D("10000.00"), D("20000.00"), D("20000.00")]
    assert result["summary"]["horizon_net_worth"] == D("-50000.00")  # 50000 - 5 x 20000
    assert "cash_shortfall" in [w["code"] for w in result["warnings"]]
    assert_reconciled(result)


def test_a_scenario_income_loss_is_applied_only_in_the_scenario_view():
    plan = make_plan("50000.00", [("Life", "30000.00")])
    shock = Scenario.model_validate({"name": "Job loss", "events": [{"type": "income_change", "from_month": "2027-02", "to_month": "2027-04", "multiplier": "0.0000"}]})
    base = run_trajectory(make_inputs(plan, 6, cash="0.00"))
    hit = run_trajectory(make_inputs(plan, 6, cash="0.00", view="scenario", scenario=shock))
    assert base["summary"]["horizon_net_worth"] == D("120000.00")
    assert hit["summary"]["horizon_net_worth"] == D("120000.00") - D("150000.00") + D("0.00")  # 3 months x 50000 of income lost
    assert hit["comparison"]["net_worth_difference"] == D("-150000.00")
    assert_reconciled(hit)


# ---- goals ---------------------------------------------------------------------------------------------------------------


GOAL_PLAN = dict(income="50000.00", expenses=[("Life", "30000.00")])


@pytest.mark.parametrize("kind,home_effect", [("home", True), ("education", False)])
def test_goal_funding_is_a_transfer_and_the_goal_effect_follows_its_type(kind, home_effect):
    plan = make_plan(**GOAL_PLAN, goals=[("g", kind, "100000.00", "2027-12", "0.00")])
    result = run_trajectory(make_inputs(plan, 24, view="selected_goals", selected_goal_ids=["g"]))
    ledger = result["monthly_ledger"]
    # Surplus is 20000 a month. Funding the goal moves cash to the goal's fund: net worth is 20000 x t until the goal's date.
    for t in range(1, 12):
        assert ledger[t - 1]["net_worth"] == D(20000 * t)
    spent = D("100000.00")
    after = ledger[11]  # December 2027, the goal's date
    if home_effect:
        # A home: the fund becomes a property asset. Not an expense, so net worth carries on.
        assert after["net_worth"] == D("240000.00")
        assert after["closing_balances"]["physical_and_other_assets"] == spent and after["closing_balances"]["goal_funds"] == D("0.00")
        assert result["comparison"]["net_worth_difference"] == D("0.00")
    else:
        # Education: the funded amount is spent and has no matching asset.
        assert after["net_worth"] == D("240000.00") - spent
        assert result["comparison"]["net_worth_difference"] == -spent
        assert result["drivers"]["goal_spending"] == spent
    assert result["goals"][0]["effect_month"] == "2027-12" and result["goals"][0]["status"] == "on_track"
    assert_reconciled(result)


def test_goal_contributions_are_not_a_second_expense():
    plan = make_plan(**GOAL_PLAN, goals=[("g", "retirement", "1000000.00", "2030-12", "0.00")])
    withgoal = run_trajectory(make_inputs(plan, 12, view="selected_goals", selected_goal_ids=["g"]))
    baseline = run_trajectory(make_inputs(plan, 12))
    # A retirement fund stays an asset: the same net worth with and without the goal.
    assert withgoal["summary"]["horizon_net_worth"] == baseline["summary"]["horizon_net_worth"] == D("240000.00")
    assert withgoal["summary"]["horizon_cash"] < baseline["summary"]["horizon_cash"]
    assert sum(e["cash_delta"] for e in events(withgoal, "goal_events") if e["kind"] == "goal_contribution") < 0


def test_the_goal_engine_and_the_trajectory_agree_on_cash_through_a_deficit_and_a_goal():
    plan = make_plan(
        "50000.00",
        [("Life", "30000.00")],
        goals=[("home", "home", "300000.00", "2028-06", "10000.00"), ("reserve", "emergency_fund", "60000.00", "2027-12", "0.00")],
    )
    shock = Scenario.model_validate({"name": "Gap", "events": [{"type": "expense_change", "from_month": "2027-04", "to_month": "2027-09", "delta_monthly": "30000.00"}]})
    result = run_trajectory(make_inputs(plan, 36, cash="20000.00", view="scenario", selected_goal_ids=["home", "reserve"], scenario=shock))
    assert_reconciled(result)
    assert {g["goal_id"] for g in result["goals"]} == {"home", "reserve"}


def test_a_goal_that_is_funded_before_its_date_waits_for_the_date():
    plan = make_plan(**GOAL_PLAN, goals=[("g", "education", "40000.00", "2027-12", "0.00")])
    result = run_trajectory(make_inputs(plan, 14, view="selected_goals", selected_goal_ids=["g"]))
    spends = [e for e in events(result, "goal_events") if e["kind"] == "goal_spending"]
    assert [e["month"] for e in spends] == ["2027-12"]  # funded by February, spent in December


def test_a_custom_goal_effect_is_never_guessed_and_a_chosen_one_is_applied():
    plan = make_plan(**GOAL_PLAN, goals=[("g", "custom", "40000.00", "2027-06", "0.00")])
    held = run_trajectory(make_inputs(plan, 12, view="selected_goals", selected_goal_ids=["g"]))
    assert not [e for e in events(held, "goal_events") if e["kind"] in ("goal_spending", "goal_asset_purchase")]
    assert "goal_effect_unchosen" in [w["code"] for w in held["warnings"]]
    chosen = run_trajectory(make_inputs(plan, 12, view="selected_goals", selected_goal_ids=["g"], goal_effects=[GoalEffectIn("g", "spend")]))
    assert [e["month"] for e in events(chosen, "goal_events") if e["kind"] == "goal_spending"] == ["2027-06"]


def test_an_emergency_fund_is_ring_fenced_cash_and_changes_no_wealth():
    plan = make_plan(**GOAL_PLAN, goals=[("g", "emergency_fund", "60000.00", "2027-06", "0.00")])
    with_goal = run_trajectory(make_inputs(plan, 12, view="selected_goals", selected_goal_ids=["g"]))
    base = run_trajectory(make_inputs(plan, 12))
    assert with_goal["summary"]["horizon_net_worth"] == base["summary"]["horizon_net_worth"]
    assert not [e for e in events(with_goal, "goal_events") if e["kind"] in ("goal_spending", "goal_asset_purchase")]


def test_a_loan_payoff_goal_linked_to_a_debt_reduces_it_once_and_later_payments_follow():
    loan = LoanIn("l1", "Car", "auto_loan", D("200000.00"), D("0.10"), D("10000.00"), 30)
    plan = make_plan("80000.00", [("Life", "30000.00")], goals=[("g", "loan_payoff", "50000.00", "2027-06", "0.00")])
    result = run_trajectory(
        make_inputs(plan, 30, cash="0.00", loans=[loan], view="selected_goals", selected_goal_ids=["g"], goal_effects=[GoalEffectIn("g", "debt_reduction", "l1")])
    )
    prepay = [e for e in events(result, "goal_events") if e["kind"] == "goal_debt_reduction"]
    assert len(prepay) == 1 and prepay[0]["month"] == "2027-06"
    assert prepay[0]["asset_delta"] == D("-50000.00") and prepay[0]["liability_delta"] == D("-50000.00") and prepay[0]["net_worth_effect"] == D("0.00")
    # Later payments follow the reduced balance: it clears sooner than the same loan with no prepayment.
    plain = run_trajectory(make_inputs(plan, 30, cash="0.00", loans=[loan]))
    assert result["summary"]["projected_debt_free_dates"][0]["month"] < plain["summary"]["projected_debt_free_dates"][0]["month"]
    row = result["monthly_ledger"][5]
    reduced = loan_schedule(loan, 30, {6: D("50000.00")})
    assert row["closing_balances"]["loans"] == reduced["rows"][6]["balance_after"] - D("50000.00")
    assert_reconciled(result)


# ---- horizon, scale and guards ----------------------------------------------------------------------------------------------


def test_the_longest_horizon_runs_and_reconciles():
    plan = make_plan("90000.00", [("Life", "50000.00")], goals=[("g", "retirement", "5000000.00", "2060-01", "0.00")])
    loan = LoanIn("l1", "Home", "home_loan", D("2500000.00"), D("0.085"), D("30000.00"), 120)
    result = run_trajectory(make_inputs(plan, 600, cash="100000.00", loans=[loan], holdings=[holding()], view="selected_goals", selected_goal_ids=["g"]))
    assert len(result["monthly_ledger"]) == 600 and result["checkpoints"][-1]["months_ahead"] == 600
    assert_reconciled(result)


def test_a_one_month_horizon_works():
    result = run_trajectory(make_inputs(make_plan("1000.00"), 1, cash="0.00"))
    assert result["summary"]["horizon_net_worth"] == D("1000.00") and len(result["checkpoints"]) == 2


def test_no_records_at_all_is_insufficient_not_a_zero_net_worth_presented_as_fact():
    result = run_trajectory(make_inputs(make_plan("0.00"), 12, cash="0.00"))
    assert result["completeness"]["status"] == "insufficient" and result["completeness"]["recorded"] is False


def test_ages_are_shown_only_when_a_reference_age_exists():
    plan = make_plan("1000.00")
    assert run_trajectory(make_inputs(plan, 24, cash="1.00"))["checkpoints"][-1]["age"] is None
    aged = run_trajectory(make_inputs(plan, 24, cash="1.00", reference_age=40))
    assert [c["age"] for c in aged["checkpoints"]] == [40, 41, 42]


def test_a_scenario_that_does_not_name_the_selected_goals_is_refused():
    plan = make_plan(**GOAL_PLAN, goals=[("a", "home", "100000.00", "2027-12", "0.00"), ("b", "education", "50000.00", "2028-12", "0.00")])
    scenario = Scenario(name="Order", priority_order=["a", "b"])
    with pytest.raises(ValueError):
        run_trajectory(make_inputs(plan, 12, view="scenario", selected_goal_ids=["a"], scenario=scenario))


def test_scenario_models_import_cleanly():
    assert ExpenseChange  # the scenario events the trajectory accepts are the planner's own
