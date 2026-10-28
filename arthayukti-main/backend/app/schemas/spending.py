"""Expenditure projection module: plans, scheduled changes, categories, settings and the trajectory."""

from typing import Annotated, Literal

from pydantic import Field, StringConstraints, model_validator

from app.schemas.types import Amount, ApiModel, PositiveMoney, Rate

Frequency = Literal["monthly", "yearly"]
Duration = Literal["today_forever", "year_forever", "range"]
ChangeKind = Literal["permanent", "temporary"]
PlanStatus = Literal["active", "stopped"]
RateMode = Literal["recalculate_all", "from_date"]

Year = Annotated[int, Field(ge=2000, le=2200)]
MonthNumber = Annotated[int, Field(ge=1, le=12)]
CategoryName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)]
PlanName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]

MAX_PLANS = 200
MAX_CHANGES_PER_PLAN = 20
MAX_CUSTOM_CATEGORIES = 50
MAX_RATE_CHANGES = 20
MAX_HORIZON_YEARS = 50
HORIZON_PRESETS = (1, 5, 10, 20, 30)


class PlanIn(ApiModel):
    """`category` is a predefined category written `sys:<key>` or the id of one of the person's own categories."""

    category: Annotated[str, StringConstraints(min_length=1, max_length=40)]
    name: PlanName | None = None
    amount: PositiveMoney
    frequency: Frequency
    duration: Duration
    start_year: Year | None = None
    start_month: MonthNumber | None = None
    end_year: Year | None = None
    end_month: MonthNumber | None = None
    inflation_override: Rate | None = None  # None: use the global rate


class ChangeIn(ApiModel):
    kind: ChangeKind
    effective_year: Year
    effective_month: MonthNumber | None = None  # a monthly plan needs it; a yearly plan must not send it
    end_year: Year | None = None  # temporary only
    end_month: MonthNumber | None = None
    amount: PositiveMoney  # in the plan's own frequency: a yearly plan's figure is an annual amount

    @model_validator(mode="after")
    def temporary_needs_an_end(self) -> "ChangeIn":
        if self.kind == "permanent" and (self.end_year is not None or self.end_month is not None):
            raise ValueError("A permanent change has no end; remove end_year and end_month.")
        if self.kind == "temporary" and self.end_year is None:
            raise ValueError("A temporary override needs an end.")
        return self


class ChangeOut(ApiModel):
    id: str
    kind: ChangeKind
    effective_year: int
    effective_month: int | None
    end_year: int | None
    end_month: int | None
    amount: Amount


class PlanOut(ApiModel):
    id: str
    category: str
    category_name: str
    category_hidden: bool
    category_archived: bool
    name: str | None
    amount: Amount
    frequency: Frequency
    monthly_equivalent: Amount
    duration: Duration
    start_year: int
    start_month: int | None
    end_year: int | None
    end_month: int | None
    inflation_override: Amount | None
    inflation_now: Amount  # the rate this plan uses today: its own, or the current global one
    status: PlanStatus
    changes: list[ChangeOut]


class CategoryIn(ApiModel):
    name: CategoryName


class CategoryPatch(ApiModel):
    name: CategoryName | None = None
    archived: bool | None = None


class SystemCategoryPatch(ApiModel):
    hidden: bool


class CategoryOut(ApiModel):
    id: str
    name: str
    kind: Literal["system", "custom"]
    hidden: bool
    archived: bool
    plan_count: int


class RateChangeOut(ApiModel):
    id: str
    effective_year: int
    effective_month: int
    rate: Amount


class SettingsOut(ApiModel):
    base_inflation: Amount
    current_inflation: Amount
    rate_changes: list[RateChangeOut]
    horizon_years: int
    horizon_presets: list[int]


class SettingsPatch(ApiModel):
    horizon_years: Annotated[int, Field(ge=1, le=MAX_HORIZON_YEARS)]


class InflationIn(ApiModel):
    rate: Rate
    mode: RateMode
    effective_year: Year | None = None
    effective_month: MonthNumber | None = None

    @model_validator(mode="after")
    def date_only_when_scheduled(self) -> "InflationIn":
        has_date = self.effective_year is not None or self.effective_month is not None
        if self.mode == "from_date" and (self.effective_year is None or self.effective_month is None):
            raise ValueError("Say the year and month the new rate starts from.")
        if self.mode == "recalculate_all" and has_date:
            raise ValueError("Recalculating the whole projection has no start date; remove the date or choose 'from_date'.")
        return self


class TrajectoryYear(ApiModel):
    year: int
    months_included: int
    annual_with_inflation: Amount
    cumulative_with_inflation: Amount
    cumulative_without_inflation: Amount


class TrajectoryOut(ApiModel):
    starts: str  # YYYY-MM, the current month
    horizon_years: int
    horizon_months: int
    plans_included: int
    current_inflation: Amount
    total_with_inflation: Amount
    total_without_inflation: Amount
    years: list[TrajectoryYear]
