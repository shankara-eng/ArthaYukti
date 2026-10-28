"""Plan B: compare the plans a search found, rank them, and explain them from the evaluator's own numbers.

Ranking policy (also returned to the person): plans are ordered by the total rupees they ask you to give up
(flexible spending not spent plus goal contributions not made, compared with the unchanged plan), smallest first;
ties go to the larger cushion above the reserve floor. This is a transparent default, not a statement of what you
should prefer. Up to `max_options` plans are shown and chosen to be genuinely different: the smallest total sacrifice,
the largest cushion, and the one that keeps goal contributions going. If they give up different things, the response
says so and does not call any of them best.

Every figure comes from `evaluate_recovery`. Goal delays are NOT calculated: the existing goal projection allocates
surplus by priority and cannot represent these fixed, paused contributions, so the plans report the rupees of
contributions deferred instead.
"""

from decimal import Decimal

from app.engine.money import ZERO, quantize
from app.engine.recovery_eval import scheduled_amount
from app.engine.recovery_search import Candidate, SearchOutcome
from app.schemas.recovery import Adjustment, CashItem, RecoveryEvaluation, RecoveryInput
from app.schemas.recovery_plan import (
    AdjustmentDescription,
    InfeasibilityReport,
    PlanMetrics,
    PlanOption,
    RecoverySearchResponse,
    RejectedAlternative,
    SearchSummary,
)
from app.timeline import index_to_month, month_to_index

RANKING_POLICY = (
    "Plans are ordered by the total rupees they ask you to give up (flexible spending not spent plus goal "
    "contributions not made, compared with the unchanged plan), smallest first. Ties go to the larger cushion above "
    "your reserve floor. This is a default ordering, not advice about what you should prefer. Goal delays are not "
    "calculated; the rupees of contributions deferred are shown instead."
)

GOAL_DELAY_NOTE = (
    "Not calculated: the goal projection cannot represent these fixed or paused contributions, so see the rupees "
    "of contributions deferred."
)


def _rs(amount: Decimal) -> str:
    return f"Rs {amount:,.2f}"


def describe(a: Adjustment, items: dict[str, CashItem], months_hint: int | None = None) -> str:
    item = items[a.item_id]
    if a.to_month is None:
        span = f"from {a.from_month} until it is restored"
    else:
        count = month_to_index(a.to_month) - month_to_index(a.from_month) + 1
        span = f"from {a.from_month} to {a.to_month} ({count} month{'s' if count != 1 else ''})"
    if a.action == "pause":
        return f"Pause {item.label} {span}"
    assert a.monthly is not None
    return f"Reduce {item.label} from {_rs(item.monthly)} to {_rs(a.monthly)} a month {span}"


def _described(adjs: list[Adjustment], inp: RecoveryInput) -> list[AdjustmentDescription]:
    items = {i.id: i for i in inp.items}
    return [AdjustmentDescription(adjustment=a, text=describe(a, items)) for a in adjs]


def metrics_for(inp: RecoveryInput, ev: RecoveryEvaluation) -> PlanMetrics:
    first = month_to_index(inp.start_month)
    last = first + inp.months - 1
    flex_cut = deferred = made = ZERO
    paused = reduced = 0
    differs_at: dict[str, int] = {}
    items = {i.id: i for i in inp.items}
    for offset, month in enumerate(ev.months):
        index = first + offset
        for row in month.items:
            item = items[row.item_id]
            planned = scheduled_amount(item, index, first, last)
            if planned == ZERO and row.amount == ZERO:
                continue
            short = planned - row.amount
            if item.kind == "flexible":
                flex_cut += short
            elif item.kind == "goal_contribution":
                deferred += short
                made += row.amount
            if short > ZERO:
                differs_at[row.item_id] = index
                if row.amount == ZERO:
                    paused += 1
                else:
                    reduced += 1
    restoration_month: str | None = None
    if differs_at:
        latest = max(differs_at.values())
        if latest < last:
            restoration_month = index_to_month(latest + 1)
    floor = inp.reserve_floor
    return PlanMetrics(
        minimum_liquid=ev.minimum_liquid,
        final_liquid=ev.final_liquid,
        floor_headroom=quantize(ev.minimum_liquid - floor),
        flexible_reduction_total=quantize(flex_cut),
        goal_contributions_deferred=quantize(deferred),
        goal_contributions_made=quantize(made),
        paused_months=paused,
        reduced_months=reduced,
        balances_end=ev.balances_end,
        restoration_complete_month=restoration_month,
        goal_delay=GOAL_DELAY_NOTE,
    )


def _explain(
    inp: RecoveryInput, cand: Candidate, m: PlanMetrics
) -> tuple[list[str], list[str], list[str], list[str]]:
    ev = cand.evaluation
    items = {i.id: i for i in inp.items}
    low_month = min(ev.months, key=lambda r: (r.liquid_end, r.month)).month
    works = [
        f"Liquid cash never falls below {_rs(m.minimum_liquid)} (lowest at the end of {low_month}), "
        f"{_rs(m.floor_headroom)} above your {_rs(inp.reserve_floor)} floor."
    ]
    mandatory = max((r.mandatory_outflow for r in ev.months), default=ZERO)
    works.append(
        f"Essentials, debt payments and protected obligations are paid in full every month (up to {_rs(mandatory)} a month)."
    )
    protected = [i for i in inp.items if i.kind == "goal_contribution" and i.protected]
    if protected:
        works.append(
            "Protected contributions continue unchanged: "
            + ", ".join(f"{i.label} {_rs(i.monthly)}" for i in protected)
            + "."
        )
    works.append("No protected balance is withdrawn and nothing is borrowed or sold.")

    gives: list[str] = []
    for a in cand.adjustments:
        gives.append(describe(a, items))
    if m.flexible_reduction_total > ZERO:
        gives.append(f"Flexible spending not spent: {_rs(m.flexible_reduction_total)} in total.")
    if m.goal_contributions_deferred > ZERO:
        gives.append(
            f"Goal contributions deferred: {_rs(m.goal_contributions_deferred)} in total (not made up automatically)."
        )
    for out in ev.restorations:
        label = items[out.item_id].label
        if out.status == "restored":
            gives.append(
                f"{label} returns to {_rs(out.final_monthly)} a month in {out.steps[-1].month}."
            )
        elif out.status == "partial":
            gives.append(
                f"{label} is only partly back ({_rs(out.final_monthly)} a month) by the end of the modelled period."
            )
        elif out.status == "deferred":
            gives.append(
                f"{label}: your conditions were met but restoring it was not yet affordable."
            )
        else:
            gives.append(
                f"{label} is not restored within the modelled period: your conditions were not all met."
            )
    if not gives:
        gives.append("Nothing is changed.")

    assumptions = list(ev.assumptions)
    if inp.reserve_floor > ZERO:
        assumptions.append(
            f"The reserve floor you chose is {_rs(inp.reserve_floor)}; it is your rule, not a standard."
        )

    breaks: list[str] = []
    drains = [r for r in ev.months if r.cash_change < ZERO]
    if drains and ev.months[-1].cash_change < ZERO:
        per = -ev.months[-1].cash_change
        extra = int(m.floor_headroom // per)
        breaks.append(
            f"The last month still draws {_rs(per)} from cash. If that continued, the {_rs(m.floor_headroom)} cushion "
            f"would last about {extra} more month{'s' if extra != 1 else ''}."
        )
    if drains:
        each = quantize(m.floor_headroom / len(drains))
        breaks.append(
            f"Cash falls in {len(drains)} month{'s' if len(drains) != 1 else ''}. About {_rs(each)} more spending or "
            "less income in each of them would use up the cushion."
        )
    if ev.income_end_unknown:
        breaks.append(
            "The income reduction has no stated end: a longer reduction than modelled would break this plan."
        )
    if not breaks:
        breaks.append(
            "Cash does not fall in any month, so only a lower income or higher costs than entered would break it."
        )
    return works, gives, assumptions, breaks


def _pick_options(
    frontier: list[Candidate], metrics: dict[str, PlanMetrics], max_options: int
) -> list[tuple[Candidate, str]]:
    if not frontier:
        return []
    ranked = sorted(frontier, key=lambda c: (c.sacrifice, -metrics[c.id].floor_headroom, c.id))
    picks: list[tuple[Candidate, str]] = [(ranked[0], "Smallest total sacrifice")]
    chosen = {ranked[0].id}

    def add(c: Candidate, label: str) -> None:
        if c.id not in chosen and len(picks) < max_options:
            chosen.add(c.id)
            picks.append((c, label))

    add(
        max(ranked, key=lambda c: (metrics[c.id].floor_headroom, -c.sacrifice)),
        "Largest cushion above your floor",
    )
    add(
        min(ranked, key=lambda c: (metrics[c.id].goal_contributions_deferred, c.sacrifice)),
        "Keeps goal contributions going",
    )
    for c in ranked:
        add(c, "Another plan that works")
    return picks


def _infeasibility(inp: RecoveryInput, out: SearchOutcome) -> InfeasibilityReport | None:
    strongest = out.strongest
    if strongest is None:
        return None
    ev = strongest.evaluation
    worst = max(ev.violations, key=lambda v: v.amount) if ev.violations else None
    first = ev.violations[0].message if ev.violations else "No violation."
    shortfall = worst.amount if worst else ZERO
    conflicts: list[str] = []
    if worst is not None:
        conflicts.append(
            f"Even with every change you allow, {worst.message[0].lower() + worst.message[1:]}"
            if worst.kind != "pause_limit"
            else worst.message
        )
    if any(v.kind == "mandatory_shortfall" for v in ev.violations):
        conflicts.append(
            "Income cannot cover the payments you marked as mandatory in at least one month."
        )
    consider: list[str] = []
    if worst is not None and worst.kind == "reserve_floor":
        consider.append(
            f"A reserve floor of {_rs(inp.reserve_floor - worst.amount)} instead of {_rs(inp.reserve_floor)} "
            "would let this plan work. Nothing has been changed."
        )
    for i in inp.items:
        if i.kind == "goal_contribution" and i.protected and i.monthly > ZERO:
            consider.append(
                f"{i.label} ({_rs(i.monthly)} a month) is protected. Allowing it to pause is the largest remaining change "
                "you could choose; it has not been applied."
            )
        elif i.kind == "flexible":
            allowed = {p.action for p in inp.permissions if p.item_id == i.id}
            if "reduce_to" not in allowed:
                consider.append(
                    f"You have not allowed any reduction of {i.label} ({_rs(i.monthly)} a month)."
                )
    return InfeasibilityReport(
        strongest_plan=_described(strongest.adjustments, inp),
        first_violation=first,
        shortfall=shortfall,
        conflicts=conflicts,
        you_could_consider=consider,
    )


def compare(out: SearchOutcome, max_options: int) -> RecoverySearchResponse:
    inp = out.base_input
    metrics = {c.id: metrics_for(inp, c.evaluation) for c in out.frontier}
    picks = _pick_options(out.frontier, metrics, max_options)
    options: list[PlanOption] = []
    for rank, (cand, label) in enumerate(picks, start=1):
        m = metrics[cand.id]
        works, gives, assumptions, breaks = _explain(inp, cand, m)
        options.append(
            PlanOption(
                id=cand.id,
                label=label,
                rank=rank,
                adjustments=_described(cand.adjustments, inp),
                metrics=m,
                evaluation=cand.evaluation,
                why_it_works=works,
                what_you_give_up=gives,
                key_assumptions=assumptions,
                what_would_break_it=breaks,
            )
        )
    note: str | None = None
    if len(options) > 1:
        kinds = {
            ("goal" if metrics[o.id].goal_contributions_deferred > ZERO else "")
            + ("flex" if metrics[o.id].flexible_reduction_total > ZERO else "")
            for o in options
        }
        if len(kinds) > 1:
            note = (
                "These plans give up different things (some defer goal contributions, some cut flexible spending). "
                "There is no single best plan: the order only reflects total rupees given up."
            )
    items = {i.id: i for i in inp.items}
    rejected = [
        RejectedAlternative(
            adjustments=[
                AdjustmentDescription(adjustment=a, text=describe(a, items)) for a in r.adjustments
            ],
            sacrifice_total=quantize(r.sacrifice),
            kind=r.kind,  # type: ignore[arg-type]
            month=r.month,
            message=r.message,
        )
        for r in out.rejected[:20]
    ]
    infeasibility = None if out.status == "found" else _infeasibility(inp, out)
    summary = SearchSummary(
        status=out.status,  # type: ignore[arg-type]
        complete=out.complete,
        space_size=out.space_size,
        evaluated=out.evaluated,
        duplicates_skipped=out.duplicates,
        errors=out.errors,
        feasible_found=out.feasible_found,
        best_not_proven=bool(out.feasible_found) and not out.complete,
        rejected_by_kind=out.rejected_by_kind,
        ignored_permissions=out.ignored,
        notes=out.notes,
    )
    return RecoverySearchResponse(
        search=summary,
        options=options,
        ranking_policy=RANKING_POLICY,
        trade_off_note=note,
        rejected=rejected,
        infeasibility=infeasibility,
        frontier_size=len(out.frontier),
    )
