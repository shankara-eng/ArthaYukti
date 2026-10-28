"""Month arithmetic shared by the schemas and the engine.

Months are 'YYYY-MM' strings in the API and integers (year * 12 + month - 1) internally.
"""

import re

MAX_HORIZON_MONTHS = 600

_MONTH = re.compile(r"^(\d{4})-(0[1-9]|1[0-2])$")


def month_to_index(month: str) -> int:
    match = _MONTH.match(month)
    if match is None:
        raise ValueError(f"Not a YYYY-MM month: {month!r}")
    return int(match.group(1)) * 12 + int(match.group(2)) - 1


def index_to_month(index: int) -> str:
    year, month = divmod(index, 12)
    return f"{year:04d}-{month + 1:02d}"


def deadline_index(as_of: str, target: str) -> int:
    """Number of contribution months up to and including the target month.

    as_of 2026-11 and target 2027-10 give 12: months 1..12 are Nov 2026..Oct 2027.
    """
    return month_to_index(target) - month_to_index(as_of) + 1
