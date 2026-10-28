import logging
import os
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api import (
    advisor,
    ai,
    ai_assist,
    analysis,
    auth,
    calculators,
    debt,
    emergency,
    expenditure,
    financials,
    health,
    household,
    income,
    insurance,
    ledger,
    market,
    plans,
    portfolio,
    recommendations,
    recovery,
    rescue,
    risk,
    samples,
    spending,
    trajectory,
)
from app.api.deps import OPTIONAL_AUTH_PATHS
from app.config import settings
from app.db.init_db import seed_demo_user_if_enabled
from app.errors import ErrorBody, ErrorResponse, register_error_handlers

logger = logging.getLogger("arthayukti")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # The schema is created by `alembic upgrade head`, never here. The only startup work is the
    # optional development demo account, which is off unless explicitly configured.
    seed_demo_user_if_enabled()
    yield


def create_app() -> FastAPI:
    app = FastAPI(
        title="ArthaYukti API",
        version="0.1.0",
        description=(
            "Explainable decision support for families with several competing money goals. "
            "Every number is reproducible and every suggested fix is verified. "
            "Illustrative, not financial advice."
        ),
        lifespan=lifespan,
    )

    origins = os.environ.get("ALLOWED_ORIGINS", settings.ALLOWED_ORIGINS).split(",")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[origin.strip() for origin in origins if origin.strip()],
        allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type", "Authorization", "X-Request-ID"],
        expose_headers=["X-Request-ID", "Retry-After"],
    )

    @app.middleware("http")
    async def limit_body_and_add_request_id(request: Request, call_next):
        req_id = request.headers.get("X-Request-ID") or str(uuid.uuid4())
        declared = request.headers.get("content-length")
        if declared and declared.isdigit() and int(declared) > settings.MAX_REQUEST_BYTES:
            body = ErrorResponse(
                error=ErrorBody(code="payload_too_large", message="The request is too large.")
            )
            response = JSONResponse(status_code=413, content=body.model_dump(mode="json"))
        else:
            response = await call_next(request)
        response.headers["X-Request-ID"] = req_id
        return response

    register_error_handlers(app)

    generate_openapi = app.openapi

    def openapi_with_optional_auth():
        schema = generate_openapi()
        for path in OPTIONAL_AUTH_PATHS:
            for operation in schema["paths"].get(path, {}).values():
                operation["security"] = [{"HTTPBearer": []}, {}]
        return schema

    app.openapi = openapi_with_optional_auth

    for module in (
        health,
        samples,
        analysis,
        plans,
        auth,
        insurance,
        financials,
        rescue,
        market,
        ai,
        household,
        debt,
        risk,
        recommendations,
        income,
        calculators,
        recovery,
        ai_assist,
        emergency,
        expenditure,
        ledger,
        trajectory,
        portfolio,
        spending,
        advisor,
    ):
        app.include_router(module.router, prefix="/api/v1")

    return app


app = create_app()
