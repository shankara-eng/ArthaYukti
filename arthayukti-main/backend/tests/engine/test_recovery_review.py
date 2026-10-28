"""Plan B: reviewing a saved agreement against today's figures (stage 7 regression tests).

The review takes the cash at the start of the review month and the income from then on. Earlier months come from the
agreement as saved. These tests pin what that means for pause allowances, confirmation and restoration.
"""

from decimal import Decimal

from app.engine.recovery_review import review_agreement
from app.schemas.recovery import RecoveryInput
from app.schemas.recovery_plan import AgreementDraft, ReviewRequest
from tests.engine.test_recovery_eval import example

D = Decimal
NEVER = [{"type": "income_at_least", "amount": "900000.00"}]


def draft(months=8, max_pause=3, conditions=NEVER, floor="0.00", confirmed_from=None):
    data = example(months=months, income_months=months, floor=floor, home_pause_max=max_pause)
    data["permissions"] = [{"item_id": "home", "action": "pause", "max_months": max_pause}]
    data["adjustments"] = [{"item_id": "home", "action": "pause", "from_month": "2026-11"}]  # until restored
    data["restorations"] = [{"item_id": "home", "conditions": conditions}]
    if confirmed_from:
        data["recovery_confirmed_from"] = confirmed_from
    return AgreementDraft(input=RecoveryInput.model_validate(data))


def review(d, month, cash="300000.00", income="60000.00", recovered=False):
    return review_agreement(d, ReviewRequest(as_of_month=month, liquid_cash=cash, monthly_income=income, recovery_confirmed=recovered))


def home(result, month):
    row = next(m for m in result.evaluation.months if m.month == month)
    return next(i.amount for i in row.items if i.item_id == "home")


def test_months_already_paused_count_against_the_allowance():
    # Home may be paused for 3 months. By the start of month 3 (2027-01) it has been paused for 2, so only 1 more is allowed:
    # the pause runs in month 3 and the allowance is exceeded in month 4 (2027-02), not three months later.
    result = review(draft(), "2027-01")
    limit = [v for v in result.evaluation.violations if v.kind == "pause_limit"]
    assert len(limit) == 1 and limit[0].month == "2027-02"
    assert result.status == "needs_recalculation"


def test_a_pause_that_has_used_its_whole_allowance_resumes_in_the_review_and_says_so():
    result = review(draft(), "2027-03")  # 4 months already paused, allowance 3
    assert any("already been paused for as long as you allowed" in m for m in result.messages)
    assert home(result, "2027-03") == D("10000.00")  # it resumes rather than being paused further
    assert not result.fits and result.status == "needs_recalculation"
    assert not [v for v in result.evaluation.violations if v.kind == "pause_limit"]


def test_reviewing_twice_gives_the_same_answer_and_never_extends_the_allowance():
    d = draft()
    first, second = review(d, "2027-01"), review(d, "2027-01")
    assert first.model_dump_json() == second.model_dump_json()
    # A later review does not restart the count: the earlier months are still counted.
    later = review(d, "2027-02")  # 3 months already paused: the whole allowance is used
    assert any("already been paused for as long as you allowed" in m for m in later.messages) and not later.fits


def test_a_review_alone_never_restores_anything():
    result = review(draft(max_pause=12), "2027-03", income="60000.00")
    assert home(result, "2027-03") == D("0.00") and home(result, "2027-04") == D("0.00")
    assert result.evaluation.restorations[0].status == "not_triggered"


def test_a_confirmation_saved_in_the_agreement_still_counts_in_a_review():
    conditions = [{"type": "user_confirmed"}]
    d = draft(max_pause=12, conditions=conditions, floor="0.00", confirmed_from="2027-01")
    result = review(d, "2027-03", cash="500000.00", income="100000.00")
    assert result.evaluation.restorations[0].status == "restored"
    assert home(result, "2027-03") == D("10000.00")
    # Without the saved confirmation and without confirming now, nothing is restored.
    unconfirmed = review(draft(max_pause=12, conditions=conditions, floor="0.00"), "2027-03", cash="500000.00", income="100000.00")
    assert unconfirmed.evaluation.restorations[0].status == "not_triggered"
    # Confirming in the review restores from that month.
    confirmed_now = review(draft(max_pause=12, conditions=conditions, floor="0.00"), "2027-03", cash="500000.00", income="100000.00", recovered=True)
    assert confirmed_now.evaluation.restorations[0].status == "restored"


def test_protected_balances_are_rebuilt_from_the_saved_schedule_up_to_the_review_month():
    d = draft(max_pause=12)
    result = review(d, "2027-01")  # two months have passed: Nov and Dec 2026
    # Education 120,000 + 2 x 10,000 before the review month, then 6 more months of 10,000 in the review.
    assert result.evaluation.balances_end["education"] == D("200000.00")
    # Home was paused in both months: it keeps its 200,000.
    assert result.evaluation.balances_end["home"] == D("200000.00")
