import logging
import secrets
from pathlib import Path
from typing import Literal

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parents[2]
BACKEND_DIR = Path(__file__).resolve().parents[1]

logger = logging.getLogger("arthayukti")

# Environments where a missing signing secret is replaced by a throwaway one. Anything else
# (production, staging, ...) refuses to start without a strong secret.
LENIENT_ENVIRONMENTS = {"development", "test"}
MIN_SECRET_LENGTH = 32
# Values that have appeared in this repository and must never sign real tokens.
KNOWN_PLACEHOLDER_SECRETS = {
    "arthayukti-super-secret-production-grade-key-2026-minimum-32-chars",
    "change-this-in-production-to-a-secure-random-key-at-least-32-characters",
}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(str(BASE_DIR / ".env"), str(BACKEND_DIR / ".env")),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    ENVIRONMENT: str = "development"
    DATABASE_URL: str = "sqlite:///./arthayukti.db"
    # No default: see _require_signing_secret. Generate with `openssl rand -hex 32`.
    SECRET_KEY: str = ""
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 1440  # 24 hours
    ALLOWED_ORIGINS: str = "http://localhost:5173,http://127.0.0.1:5173"

    # Demo account: only ever created in development, and only when asked for explicitly.
    SEED_DEMO_USER: bool = False
    DEMO_USER_PASSWORD: str = ""

    # Abuse limits
    RATE_LIMIT_ENABLED: bool = True
    MAX_REQUEST_BYTES: int = 2_000_000

    # Password reset delivery: "disabled" until a real mail transport is configured.
    MAIL_BACKEND: Literal["disabled", "smtp", "memory"] = "disabled"
    MAIL_FROM: str = "no-reply@arthayukti.invalid"
    SMTP_HOST: str = ""
    SMTP_PORT: int = 587
    SMTP_USERNAME: str = ""
    SMTP_PASSWORD: str = ""
    FRONTEND_BASE_URL: str = "http://localhost:5173"
    PASSWORD_RESET_TTL_MINUTES: int = 60

    # Optional AI help (Gemini). Backend only: the key is never sent to the browser. Empty means the AI
    # features report themselves unavailable and everything else works unchanged.
    GEMINI_API_KEY: str = ""
    GEMINI_MODEL: str = "gemini-3.5-flash-lite"
    GEMINI_TIMEOUT_SECONDS: float = 20.0
    AI_MAX_INPUT_CHARS: int = 1500

    # Stock prices for the portfolio tracker (https://github.com/0xramm/Indian-Stock-Market-API). The backend is the
    # only caller; the browser never sees this address. The project's published address is plain HTTP and was not
    # reachable when this was written: point this at an instance you run (ideally behind HTTPS).
    # Where Indian share prices come from. "indian_api": the Indian-Stock-Market-API service at MARKET_API_BASE_URL (its
    # published address has not answered). "yahoo": Yahoo Finance's public quote endpoints directly, the same upstream data
    # that service wraps (unofficial, not for financial decisions).
    MARKET_PROVIDER: Literal["indian_api", "yahoo"] = "indian_api"
    MARKET_API_BASE_URL: str = "http://65.0.104.9"
    MARKET_API_TIMEOUT_SECONDS: float = 8.0

    # Financial Engine Settings
    DEFAULT_GOAL_INFLATION: str = "0.05"
    MODEL_VERSION: str = "v1.3-constraint-aware"

    @field_validator("DATABASE_URL", mode="before")
    @classmethod
    def _normalise_database_url(cls, value: object) -> object:
        """Accept what hosts hand out. An empty value means the local SQLite default, and the
        `postgres://` / `postgresql://` forms are pointed at the psycopg 3 driver."""
        if not isinstance(value, str) or not value.strip():
            return "sqlite:///./arthayukti.db"
        url = value.strip()
        for prefix in ("postgres://", "postgresql://"):
            if url.startswith(prefix):
                return "postgresql+psycopg://" + url[len(prefix) :]
        return url

    @field_validator("MARKET_API_BASE_URL", mode="after")
    @classmethod
    def _market_api_url(cls, value: str) -> str:
        url = value.strip().rstrip("/")
        if not (url.startswith("http://") or url.startswith("https://")):
            raise ValueError("MARKET_API_BASE_URL must start with http:// or https://")
        return url

    @model_validator(mode="after")
    def _require_signing_secret(self) -> "Settings":
        weak = (
            len(self.SECRET_KEY) < MIN_SECRET_LENGTH or self.SECRET_KEY in KNOWN_PLACEHOLDER_SECRETS
        )
        if not weak:
            return self
        if self.ENVIRONMENT in LENIENT_ENVIRONMENTS:
            # Sessions do not survive a restart in this mode. That is intended for local work.
            self.SECRET_KEY = secrets.token_urlsafe(48)
            logger.warning(
                "SECRET_KEY is not set (or is a placeholder): using a temporary key. "
                "Sign-ins end when the server restarts."
            )
            return self
        raise ValueError(
            "SECRET_KEY must be set to a random value of at least "
            f"{MIN_SECRET_LENGTH} characters when ENVIRONMENT={self.ENVIRONMENT!r}."
        )


settings = Settings()
