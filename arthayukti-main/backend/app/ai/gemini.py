"""The only place that talks to Gemini.

Rules this module keeps: the key comes from the backend environment and is only ever sent in a request
header to Google; it is never logged, returned, or put in an error message. Prompts and replies are not logged
either, because they can contain a person's finances. Only the kind of failure is.

No third-party SDK: one HTTPS call with the standard library keeps the dependency list unchanged.
"""

import json
import logging
import re
import time
import urllib.error
import urllib.request
from typing import Any, Protocol

from app.config import settings
from app.errors import ApiError

logger = logging.getLogger("arthayukti.ai")

ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
_MODEL_NAME = re.compile(r"^[A-Za-z0-9._-]{1,80}$")
MAX_REPLY_BYTES = 200_000


class AIFailure(Exception):
    """A provider problem, already worded for the person. Never carries the key, prompt or reply."""

    def __init__(self, status_code: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message


class GeminiClient(Protocol):
    def generate_json(self, system: str, user: str, max_output_tokens: int = 1200) -> Any:
        """Ask for a JSON answer and return it parsed. Raises AIFailure."""


class HttpGeminiClient:
    def __init__(
        self,
        api_key: str,
        model: str,
        timeout: float,
        max_retries: int = 1,
        retry_delay: float = 0.25,
    ) -> None:
        self._key = api_key
        self._model = model
        self._timeout = timeout
        self._max_retries = max_retries
        self._retry_delay = retry_delay

    def generate_json(self, system: str, user: str, max_output_tokens: int = 1200) -> Any:
        body = {
            "systemInstruction": {"parts": [{"text": system}]},
            "contents": [{"role": "user", "parts": [{"text": user}]}],
            "generationConfig": {
                "responseMimeType": "application/json",
                "temperature": 0.2,
                "maxOutputTokens": max_output_tokens,
            },
        }
        request = urllib.request.Request(
            ENDPOINT.format(model=self._model),
            data=json.dumps(body).encode("utf-8"),
            headers={"Content-Type": "application/json", "x-goog-api-key": self._key},
            method="POST",
        )
        total_attempts = 1 + max(0, self._max_retries)
        raw = b""
        for attempt in range(total_attempts):
            try:
                with urllib.request.urlopen(request, timeout=self._timeout) as response:  # noqa: S310
                    raw = response.read(MAX_REPLY_BYTES + 1)
                break
            except urllib.error.HTTPError as error:
                logger.warning(
                    "gemini request refused: http %s (attempt %d/%d)",
                    error.code,
                    attempt + 1,
                    total_attempts,
                )
                if error.code == 429:
                    raise AIFailure(
                        429, "ai_rate_limited", "The AI service is busy. Try again in a minute."
                    ) from None
                if error.code in (400, 401, 403, 404):
                    # Bad key, wrong model name or blocked project: an operator problem, not the person's.
                    raise AIFailure(
                        503, "ai_unavailable", "AI help is not working on this server right now."
                    ) from None
                if error.code in (502, 503) and attempt < total_attempts - 1:
                    time.sleep(self._retry_delay)
                    continue
                raise AIFailure(
                    502, "ai_unavailable", "The AI service had a problem. Try again later."
                ) from None
            except TimeoutError as error:
                logger.warning("gemini request timed out: %s", type(error).__name__)
                raise AIFailure(
                    504, "ai_timeout", "The AI service did not answer in time. Try again."
                ) from None
            except (urllib.error.URLError, OSError) as error:
                logger.warning(
                    "gemini request failed: %s (attempt %d/%d)",
                    type(error).__name__,
                    attempt + 1,
                    total_attempts,
                )
                if attempt < total_attempts - 1:
                    time.sleep(self._retry_delay)
                    continue
                raise AIFailure(
                    504, "ai_timeout", "The AI service did not answer in time. Try again."
                ) from None

        if len(raw) > MAX_REPLY_BYTES:
            raise AIFailure(502, "ai_bad_response", "The AI service sent an unusable answer.")
        try:
            parsed = json.loads(raw)
            candidate = parsed["candidates"][0]
            finish_reason = candidate.get("finishReason")
            if finish_reason and finish_reason not in ("STOP", "MAX_TOKENS"):
                logger.warning("gemini generation stopped early: %s", finish_reason)
                raise AIFailure(
                    502, "ai_bad_response", "The AI service could not complete the response."
                )
            text = candidate["content"]["parts"][0]["text"]
            return json.loads(text)
        except AIFailure:
            raise
        except (ValueError, KeyError, IndexError, TypeError):
            logger.warning("gemini reply was not the expected JSON")
            raise AIFailure(502, "ai_bad_response", "The AI service sent an unusable answer.") from None


def ai_configured() -> bool:
    return bool(settings.GEMINI_API_KEY.strip()) and bool(_MODEL_NAME.match(settings.GEMINI_MODEL))


def get_gemini() -> GeminiClient:
    """FastAPI dependency. Tests replace it with a fake, so the suite never needs a key or the network."""
    if not ai_configured():
        raise ApiError(503, "ai_not_configured", "AI help is not set up on this server.")
    return HttpGeminiClient(settings.GEMINI_API_KEY.strip(), settings.GEMINI_MODEL, settings.GEMINI_TIMEOUT_SECONDS)
