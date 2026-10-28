"""Plan B: a deterministic, bounded search over the changes a person has allowed.

For every item the person allows to change, the search builds a short, ordered list of options (no change, then
pauses of increasing length, then deeper and deeper reductions, each over the chosen window, plus "until restored"
when the item has a restoration rule). A candidate plan is one option per item. Candidates are visited in order of
how much they ask the person to give up, evaluated with `evaluate_recovery`, de-duplicated by what they actually
change month by month, and filtered so that no plan that is beaten on every month by another feasible plan is kept.

Nothing here sells assets, borrows, withdraws protected money or touches an item that is protected, mandatory or
refused. The outcome says plainly whether the whole supported space was searched (`complete`) or the candidate
limit cut it short.
"""

import hashlib
import heapq
from dataclasses import dataclass, field
from decimal import ROUND_CEILING, Decimal

from pydantic import ValidationError

from app.engine.money import ZERO
from app.engine.recovery_eval import evaluate_recovery
from app.schemas.recovery import Adjustment, CashItem, RecoveryEvaluation, RecoveryInput
from app.schemas.recovery_plan import RecoverySearchRequest
from app.timeline import index_to_month, month_to_index

SYSTEMIC_ERROR_THRESHOLD = 20
MAX_REDUCTION_LEVELS = Decimal(24)
# Work cap, in candidate-months (candidates checked x months modelled). It bounds the time one request can take
# (about ten seconds at the worst) whatever limit was asked for, and it is a count, so the result stays deterministic.
WORK_BUDGET = 100_000


class RecoverySearchError(ValueError):
    """Every candidate failed to evaluate: the request itself is unusable."""


@dataclass
class _Option:
    adjustment: Adjustment | None
    sacrifice: Decimal  # rupees given up if this option is chosen, used only to order candidates


@dataclass
class Candidate:
    adjustments: list[Adjustment]
    evaluation: RecoveryEvaluation
    sacrifice: (
        Decimal  # rupees not spent or saved compared with the unchanged plan, from the evaluation
    )
    vector: tuple[Decimal, ...]  # what every changeable item pays each month

    @property
    def id(self) -> str:
        raw = "|".join(a.model_dump_json() for a in self.adjustments) or "no-change"
        return "plan-" + hashlib.sha1(raw.encode()).hexdigest()[:8]


@dataclass
class Rejected:
    adjustments: list[Adjustment]
    sacrifice: Decimal
    kind: str
    month: str
    message: str


@dataclass
class SearchOutcome:
    status: str
    complete: bool
    space_size: int
    evaluated: int
    duplicates: int
    errors: int
    feasible_found: int
    rejected_by_kind: dict[str, int]
    ignored: list[str]
    notes: list[str]
    frontier: list[Candidate]
    rejected: list[Rejected]
    unchanged: RecoveryEvaluation | None
    strongest: (
        Candidate | None
    )  # the plan that uses every change allowed, to explain an infeasible result
    base_input: RecoveryInput
    adjustable_ids: list[str] = field(default_factory=list)


def _is_adjustable(item: CashItem) -> bool:
    return item.kind == "flexible" or (item.kind == "goal_contribution" and not item.protected)


def _options_for_item(
    item: CashItem, req: RecoverySearchRequest, w_from: int, w_to: int
) -> list[_Option]:
    inp = req.input
    months = w_to - w_from + 1
    rules = {r.item_id for r in inp.restorations}
    perms = {p.action: p for p in inp.permissions if p.item_id == item.id}
    out: list[_Option] = [_Option(None, ZERO)]
    start = index_to_month(w_from)
    if "pause" in perms:
        limit = perms["pause"].max_months or 0
        for d in range(1, min(limit, months) + 1):
            out.append(
                _Option(
                    Adjustment(
                        item_id=item.id,
                        action="pause",
                        from_month=start,
                        to_month=index_to_month(w_from + d - 1),
                    ),
                    item.monthly * d,
                )
            )
        if item.id in rules:
            out.append(
                _Option(
                    Adjustment(item_id=item.id, action="pause", from_month=start),
                    item.monthly * months + Decimal("0.01"),
                )
            )
    if "reduce_to" in perms:
        floor_amount = perms["reduce_to"].min_monthly
        assert floor_amount is not None
        if floor_amount < item.monthly:
            levels: list[Decimal] = []
            # At most about MAX_REDUCTION_LEVELS levels per item, however wide the permitted range is.
            step = max(
                req.limits.reduce_step,
                ((item.monthly - floor_amount) / MAX_REDUCTION_LEVELS).quantize(
                    Decimal("0.01"), rounding=ROUND_CEILING
                ),
            )
            amount = item.monthly - step
            while amount > floor_amount:
                levels.append(amount)
                amount -= step
            levels.append(floor_amount)
            for level in levels:
                out.append(
                    _Option(
                        Adjustment(
                            item_id=item.id,
                            action="reduce_to",
                            from_month=start,
                            to_month=index_to_month(w_to),
                            monthly=level,
                        ),
                        (item.monthly - level) * months,
                    )
                )
                if item.id in rules:
                    out.append(
                        _Option(
                            Adjustment(
                                item_id=item.id, action="reduce_to", from_month=start, monthly=level
                            ),
                            (item.monthly - level) * months + Decimal("0.01"),
                        )
                    )
    # Stable sort: equal sacrifice keeps the order above, so the search is the same every time.
    return sorted(out, key=lambda o: o.sacrifice)


def _combinations(lists: list[list[_Option]]):
    """Yield one option per list in non-decreasing total sacrifice (a k-smallest-sums walk)."""
    start = tuple(0 for _ in lists)
    heap = [(sum((lst[0].sacrifice for lst in lists), ZERO), start)]
    seen = {start}
    while heap:
        total, idx = heapq.heappop(heap)
        yield [lst[i] for lst, i in zip(lists, idx, strict=True)]
        for pos in range(len(lists)):
            if idx[pos] + 1 < len(lists[pos]):
                nxt = idx[:pos] + (idx[pos] + 1,) + idx[pos + 1 :]
                if nxt not in seen:
                    seen.add(nxt)
                    delta = lists[pos][idx[pos] + 1].sacrifice - lists[pos][idx[pos]].sacrifice
                    heapq.heappush(heap, (total + delta, nxt))


def _vector(inp: RecoveryInput, ev: RecoveryEvaluation, ids: list[str]) -> tuple[Decimal, ...]:
    out: list[Decimal] = []
    for month in ev.months:
        by_item = {i.item_id: i.amount for i in month.items}
        out.extend(by_item[i] for i in ids)
    return tuple(out)


def _dominates(a: tuple[Decimal, ...], b: tuple[Decimal, ...]) -> bool:
    return a != b and all(x >= y for x, y in zip(a, b, strict=True))


def run_search(req: RecoverySearchRequest) -> SearchOutcome:
    inp = req.input
    first = month_to_index(inp.start_month)
    last = first + inp.months - 1
    w_from = month_to_index(req.adjust_from) if req.adjust_from else first
    window = req.adjust_months or (last - w_from + 1)
    w_to = min(last, w_from + window - 1)
    by_id = {i.id: i for i in inp.items}

    ignored: list[str] = []
    lists: list[list[_Option]] = []
    item_ids: list[str] = []
    seen_items: set[str] = set()
    for perm in inp.permissions:
        item = by_id[perm.item_id]
        if perm.item_id in seen_items:
            continue
        seen_items.add(perm.item_id)
        if perm.item_id in req.excluded_item_ids:
            ignored.append(f"{item.label}: you refused any change, so it is left as it is.")
            continue
        if not _is_adjustable(item):
            ignored.append(
                f"{item.label}: protected, so it cannot be changed even though a change was allowed."
            )
            continue
        options = _options_for_item(item, req, w_from, w_to)
        if len(options) == 1:
            ignored.append(f"{item.label}: the limits you set leave no change to try.")
            continue
        lists.append(options)
        item_ids.append(perm.item_id)

    adjustable = [i.id for i in inp.items if _is_adjustable(i)]
    space = 1
    for lst in lists:
        space *= len(lst)
    limits = req.limits
    allowed = min(limits.max_candidates, max(1, WORK_BUDGET // inp.months))
    base_dump = inp.model_dump(mode="json")

    evaluated = duplicates = errors = 0
    first_error = ""
    signatures: set[tuple[Decimal, ...]] = set()
    frontier: list[Candidate] = []
    feasible_found = 0
    rejected_by_kind: dict[str, int] = {}
    rejected: list[Rejected] = []
    unchanged_eval: RecoveryEvaluation | None = None
    base_sum: Decimal | None = None

    def evaluate(adjs: list[Adjustment]) -> RecoveryEvaluation:
        data = {**base_dump, "adjustments": [a.model_dump(mode="json") for a in adjs]}
        return evaluate_recovery(RecoveryInput.model_validate(data))

    for combo in _combinations(lists) if lists else iter([[]]):
        if evaluated + duplicates + errors >= allowed:
            break
        adjs = [o.adjustment for o in combo if o.adjustment is not None]
        try:
            ev = evaluate(adjs)
        except (ValidationError, ValueError) as exc:
            errors += 1
            first_error = first_error or str(exc).splitlines()[0][:200]
            if errors >= SYSTEMIC_ERROR_THRESHOLD and evaluated == 0:
                raise RecoverySearchError(
                    f"Every candidate failed to evaluate: {first_error}"
                ) from None
            continue
        vector = _vector(inp, ev, adjustable)
        if base_sum is None:
            base_sum = sum(vector, ZERO)
            unchanged_eval = ev
        if vector in signatures:
            duplicates += 1
            continue
        signatures.add(vector)
        evaluated += 1
        sacrifice = base_sum - sum(vector, ZERO)
        if ev.feasible:
            feasible_found += 1
            if not any(_dominates(f.vector, vector) for f in frontier):
                frontier.append(Candidate(adjs, ev, sacrifice, vector))
        else:
            v = ev.violations[0]
            rejected_by_kind[v.kind] = rejected_by_kind.get(v.kind, 0) + 1
            if len(rejected) < 200:
                rejected.append(Rejected(adjs, sacrifice, v.kind, v.month, v.message))

    complete = (evaluated + duplicates + errors) >= space or not lists
    if feasible_found:
        status = "found"
    elif complete:
        status = "infeasible"
    else:
        status = "incomplete"

    strongest: Candidate | None = None
    if not feasible_found:
        adjs = [lst[-1].adjustment for lst in lists if lst[-1].adjustment is not None]
        try:
            ev = evaluate(adjs)
            vec = _vector(inp, ev, adjustable)
            strongest = Candidate(adjs, ev, (base_sum or ZERO) - sum(vec, ZERO), vec)
        except ValueError:
            strongest = None

    notes = [
        "Every plan was checked month by month with the same evaluator; none sells assets, borrows, or withdraws protected money.",
        f"Fixed changes last up to {w_to - w_from + 1} months from {index_to_month(w_from)}.",
    ]
    if not complete:
        why = (
            f"the limit of {limits.max_candidates} candidates"
            if allowed == limits.max_candidates
            else f"the size limit for a {inp.months}-month search ({allowed} candidates)"
        )
        notes.append(
            f"The search stopped after {allowed} candidates out of {space} possible combinations because of {why}. "
            "Plans that ask for more were not checked, so a better plan may exist."
        )
    if errors:
        notes.append(f"{errors} candidates could not be evaluated ({first_error}).")

    return SearchOutcome(
        status=status,
        complete=complete,
        space_size=space,
        evaluated=evaluated,
        duplicates=duplicates,
        errors=errors,
        feasible_found=feasible_found,
        rejected_by_kind=rejected_by_kind,
        ignored=ignored,
        notes=notes,
        frontier=sorted(frontier, key=lambda c: (c.sacrifice, c.id)),
        rejected=sorted(rejected, key=lambda r: (r.sacrifice, r.month)),
        unchanged=unchanged_eval,
        strongest=strongest,
        base_input=inp,
        adjustable_ids=adjustable,
    )
