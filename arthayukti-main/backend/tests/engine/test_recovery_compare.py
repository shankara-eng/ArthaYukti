"""Plan B stage 4: comparison, ranking and explanations. Every number checked here is hand-derived from the example."""

from decimal import Decimal

from app.engine.recovery_compare import RANKING_POLICY, compare, metrics_for
from app.engine.recovery_search import run_search
from app.schemas.recovery_plan import RecoverySearchRequest
from tests.engine.test_recovery_eval import example
from tests.engine.test_recovery_search import request

D = Decimal


def respond(**kw):
    req = request(**kw)
    return compare(run_search(req), req.limits.max_options), req


def test_the_worked_example_gives_one_plan_with_every_figure_from_the_evaluator():
    resp, req = respond()
    assert resp.search.status == "found" and resp.search.complete and resp.frontier_size == 1
    [option] = resp.options
    m = option.metrics
    # Cash ends exactly on the 180,000 floor: no cushion. Flexible spending saved 6 x 5,000; home deferred 6 x 10,000.
    assert m.minimum_liquid == m.final_liquid == D("180000.00") and m.floor_headroom == D("0.00")
    assert m.flexible_reduction_total == D("30000.00")
    assert m.goal_contributions_deferred == D("60000.00")
    assert m.paused_months == 6 and m.reduced_months == 6
    # Education 6 x 10,000 and retirement 6 x 10,000 are still made.
    assert m.goal_contributions_made == D("120000.00")
    assert m.balances_end["education"] == D("180000.00") and m.balances_end["retirement"] == D(
        "460000.00"
    )
    # The changes cover the whole six-month horizon, so nothing comes back inside the modelled period.
    assert m.restoration_complete_month is None
    assert "Not calculated" in m.goal_delay
    assert option.label == "Smallest total sacrifice" and option.rank == 1


def test_explanations_are_built_from_the_numbers():
    resp, _ = respond()
    option = resp.options[0]
    text = " ".join(option.why_it_works)
    assert "Rs 180,000.00" in text and "Rs 0.00 above" in text
    assert (
        "Education contribution Rs 10,000.00" in text
        and "Retirement contribution Rs 10,000.00" in text
    )
    assert "No protected balance is withdrawn" in text
    gives = " ".join(option.what_you_give_up)
    assert "Pause Home contribution from 2026-11 to 2027-04 (6 months)" in gives
    assert "Reduce Flexible spending from Rs 10,000.00 to Rs 5,000.00" in gives
    assert "Rs 60,000.00" in gives and "Rs 30,000.00" in gives
    breaks = " ".join(option.what_would_break_it)
    # The last month still draws 20,000; with no cushion it lasts 0 more months.
    assert "draws Rs 20,000.00" in breaks and "about 0 more months" in breaks
    assert any("it is your rule, not a standard" in a for a in option.key_assumptions)


def test_rejected_alternatives_say_why_they_failed():
    resp, _ = respond()
    assert resp.rejected[0].kind == "reserve_floor" and resp.rejected[0].month == "2027-02"
    one_month = [
        r
        for r in resp.rejected
        if [d.text for d in r.adjustments]
        == ["Pause Home contribution from 2026-11 to 2026-11 (1 month)"]
    ]
    # Pausing home for a single month saves 10,000, which is not enough: cash still falls below 180,000 in month 4.
    assert (
        one_month
        and one_month[0].month == "2027-02"
        and one_month[0].sacrifice_total == D("10000.00")
    )
    assert "below your Rs 180,000.00 floor" in one_month[0].message


def test_several_genuinely_different_plans_are_ranked_by_the_stated_policy():
    resp, _ = respond(floor="100000.00")
    assert 1 < len(resp.options) <= 3 and resp.ranking_policy == RANKING_POLICY
    labels = [o.label for o in resp.options]
    assert labels[0] == "Smallest total sacrifice"
    assert len({o.id for o in resp.options}) == len(resp.options)
    first = resp.options[0].metrics
    assert first.flexible_reduction_total + first.goal_contributions_deferred == D(
        "10000.00"
    )  # one month of home paused
    # The "largest cushion" option really has the most headroom among those shown.
    cushion = next(o for o in resp.options if o.label == "Largest cushion above your floor")
    assert cushion.metrics.floor_headroom == max(o.metrics.floor_headroom for o in resp.options)
    assert resp.trade_off_note is not None and "no single best plan" in resp.trade_off_note


def test_no_feasible_plan_is_explained_honestly_without_changing_anything():
    resp, req = respond(months=8, income_months=8)
    assert resp.search.status == "infeasible" and resp.options == []
    report = resp.infeasibility
    assert report is not None
    assert report.shortfall == D(
        "40000.00"
    )  # 140,000 against the 180,000 floor with every change applied
    assert any("Even with every change you allow" in c for c in report.conflicts)
    joined = " ".join(report.you_could_consider)
    assert (
        "Rs 140,000.00 instead of Rs 180,000.00" in joined and "Nothing has been changed" in joined
    )
    assert "Education contribution" in joined and "has not been applied" in joined
    assert req.input.reserve_floor == D("180000.00")  # the request's constraints were never relaxed


def test_an_incomplete_search_never_claims_there_is_no_solution():
    resp, _ = respond(limits={"max_candidates": 5})
    assert resp.search.status == "incomplete" and not resp.search.complete
    assert (
        resp.infeasibility is not None
    )  # shows the strongest plan, but the status is not "infeasible"
    assert any("stopped after 5" in n for n in resp.search.notes)
    cut_short, _ = respond(floor="100000.00", limits={"max_candidates": 3})
    assert cut_short.search.best_not_proven and cut_short.search.status == "found"


def test_metrics_for_an_unchanged_plan_show_no_sacrifice():
    inp = RecoverySearchRequest.model_validate({"input": example()}).input
    from app.engine.recovery_eval import evaluate_recovery

    m = metrics_for(inp, evaluate_recovery(inp))
    assert m.flexible_reduction_total == D("0.00") and m.goal_contributions_deferred == D("0.00")
    assert m.paused_months == 0 and m.restoration_complete_month is None
