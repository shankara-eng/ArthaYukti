"""A small in-process sliding-window limiter for sign-in, sign-up and reset requests.

It protects a single server process. Behind several workers or instances each one keeps its own
counts, so a shared store (for example Redis) is needed for a hard guarantee. The client address
is the direct peer: proxy headers such as X-Forwarded-For are deliberately not trusted.
"""

import threading
import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request, status

from app.config import settings

_lock = threading.Lock()
_hits: dict[str, deque[float]] = defaultdict(deque)


def reset_for_tests() -> None:
    with _lock:
        _hits.clear()


def enforce(request: Request, bucket: str, limit: int, window_seconds: int, *extra: str) -> None:
    """Count one attempt and raise 429 when `limit` attempts happened inside the window."""
    if not settings.RATE_LIMIT_ENABLED:
        return
    host = request.client.host if request.client else "unknown"
    key = "|".join((bucket, host, *extra))
    now = time.monotonic()
    with _lock:
        hits = _hits[key]
        while hits and now - hits[0] > window_seconds:
            hits.popleft()
        if len(hits) >= limit:
            retry_after = max(1, int(window_seconds - (now - hits[0])))
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many attempts. Please wait and try again.",
                headers={"Retry-After": str(retry_after)},
            )
        hits.append(now)
