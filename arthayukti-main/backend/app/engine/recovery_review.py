"""Plan B: a review of a saved Recovery Agreement against what is true now.

The person gives the month, today's liquid cash and today's monthly income. The agreement's own items, permissions,
adjustments and restoration rules are re-run from that month on. Income is assumed to stay at the figure given until
the end of the agreement (and the result says so); a restoration only happens if its conditions hold, and the
person's own confirmation is used only if they confirm it here.

How the past is handled: the figures you type are the cash at the START of the review month (the previous month-end)
and the income from then on. Months before it are taken from the agreement as saved: protected balances are rebuilt
from its schedule, and months already paused count against each permitted pause length, so a pause cannot be extended
by reviewing again. If a pause has already used its whole allowance, the item resumes in the review and the result
says so. Limitation: if you did not actually follow the saved schedule, the rebuilt balances and the pause count are
not what really happened; this version cannot take your real past figures.
"""

from decimal import Decimal

from app.engine.money import ZERO
from app.engine.recovery_eval import evaluate_recovery, scheduled_amount
from app.schemas.recovery import Adjustment, CashItem, ProtectedBalance, RecoveryInput
from app.schemas.recovery_plan import AgreementDraft, ReviewRequest, ReviewResult
from app.timeline import index_to_month, month_to_index


def review_agreement(draft: AgreementDraft, req: ReviewRequest) -> ReviewResult:
    inp = draft.input
    first = month_to_index(inp.start_month)
    last = first + inp.months - 1
    as_of = month_to_index(req.as_of_month)
    if not first <= as_of <= last:
        raise ValueError("The review month must fall inside the agreement's modelled months.")

    original = evaluate_recovery(inp)
    items = {i.id: i for i in inp.items}
    balances: dict[str, Decimal] = {b.id: b.balance for b in inp.protected_balances}
    for offset, row in enumerate(original.months):
        if first + offset >= as_of:
            break
        for r in row.items:
            bid = items[r.item_id].balance_id
            if bid is not None:
                balances[bid] += r.amount

    new_items: list[CashItem] = []
    for item in inp.items:
        start = month_to_index(item.from_month) if item.from_month else first
        end = month_to_index(item.to_month) if item.to_month else last
        if end < as_of:
            new_items.append(
                item.model_copy(update={"monthly": ZERO, "from_month": None, "to_month": None})
            )
        else:
            new_items.append(
                item.model_copy(
                    update={
                        "from_month": index_to_month(start) if start > as_of else None,
                        "to_month": item.to_month,
                    }
                )
            )

    # Months already paused before the review month, from the agreement as saved.
    paused_before: dict[str, int] = {}
    for offset, row in enumerate(original.months):
        index = first + offset
        if index >= as_of:
            break
        for r in row.items:
            planned = scheduled_amount(items[r.item_id], index, first, last)
            if planned > ZERO and r.amount == ZERO:
                paused_before[r.item_id] = paused_before.get(r.item_id, 0) + 1

    adjustments: list[Adjustment] = []
    for a in inp.adjustments:
        end = month_to_index(a.to_month) if a.to_month else None
        if end is not None and end < as_of:
            continue
        start = max(month_to_index(a.from_month), as_of)
        adjustments.append(a.model_copy(update={"from_month": index_to_month(start)}))

    permissions = []
    notes: list[str] = []
    for perm in inp.permissions:
        if perm.action != "pause":
            permissions.append(perm)
            continue
        left = (perm.max_months or 0) - paused_before.get(perm.item_id, 0)
        if left >= 1:
            permissions.append(perm.model_copy(update={"max_months": left}))
            continue
        # The whole allowance was used before the review month: the item resumes rather than being paused further.
        still_paused = [a for a in adjustments if a.item_id == perm.item_id and a.action == "pause"]
        if still_paused:
            adjustments = [a for a in adjustments if a not in still_paused]
            notes.append(
                f"{items[perm.item_id].label} has already been paused for as long as you allowed, so it resumes "
                f"from {req.as_of_month} in this review."
            )
    confirmed_from = month_to_index(inp.recovery_confirmed_from) if inp.recovery_confirmed_from else None
    if req.recovery_confirmed:
        confirmed = req.as_of_month
    elif confirmed_from is not None:
        # A confirmation saved in the agreement still stands; one dated after the review month waits for its month.
        confirmed = index_to_month(max(confirmed_from, as_of))
    else:
        confirmed = None
    data = {
        "start_month": req.as_of_month,
        "months": last - as_of + 1,
        "liquid_cash": req.liquid_cash,
        "reserve_floor": inp.reserve_floor,
        "income": [{"from_month": req.as_of_month, "monthly_net": req.monthly_income}],
        "items": [i.model_dump(mode="json") for i in new_items],
        "protected_balances": [
            ProtectedBalance(id=b.id, label=b.label, balance=balances[b.id]).model_dump(mode="json")
            for b in inp.protected_balances
        ],
        "permissions": [p.model_dump(mode="json") for p in permissions],
        "adjustments": [a.model_dump(mode="json") for a in adjustments],
        "restorations": [r.model_dump(mode="json") for r in inp.restorations],
        "recovery_confirmed_from": confirmed,
    }
    current = evaluate_recovery(RecoveryInput.model_validate(data))
    messages: list[str] = list(notes)
    fits = current.feasible and not notes
    if current.feasible:
        messages.append(
            f"With Rs {req.liquid_cash:,.2f} in cash and Rs {req.monthly_income:,.2f} of monthly income from "
            f"{req.as_of_month}, the agreement still keeps cash at or above your Rs {inp.reserve_floor:,.2f} floor "
            f"(lowest Rs {current.minimum_liquid:,.2f})."
        )
    else:
        messages.append("The agreement no longer fits these figures. It needs to be recalculated.")
        messages.extend(v.message for v in current.violations[:3])
    labels = {i.id: i.label for i in inp.items}
    for out in current.restorations:
        if out.status == "restored":
            messages.append(
                f"{labels[out.item_id]} would be back to Rs {out.final_monthly:,.2f} by {out.steps[-1].month}."
            )
        elif out.status == "not_triggered":
            messages.append(
                f"{labels[out.item_id]}: your restoration conditions are not met yet, so it stays changed."
            )
        elif out.status == "deferred":
            messages.append(
                f"{labels[out.item_id]}: conditions are met, but restoring it is not affordable yet."
            )
        else:
            messages.append(
                f"{labels[out.item_id]} would be only partly restored (Rs {out.final_monthly:,.2f}) in the period."
            )
    messages.append(
        "Income is assumed to stay at the figure you gave; nothing here is a guarantee."
    )
    return ReviewResult(
        as_of_month=req.as_of_month,
        fits=fits,
        status="still_fits" if fits else "needs_recalculation",
        evaluation=current,
        messages=messages,
    )
