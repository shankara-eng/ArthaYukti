"""One error shape for every failure: {"error": {"code", "message", "details"}}."""

import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.schemas.types import ApiModel

logger = logging.getLogger("arthayukti")


class ErrorDetail(ApiModel):
    loc: list[str | int]
    msg: str


class ErrorBody(ApiModel):
    code: str
    message: str
    details: list[ErrorDetail] = []


class ErrorResponse(ApiModel):
    error: ErrorBody


class ApiError(Exception):
    def __init__(self, status_code: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message


def _response(
    status_code: int,
    code: str,
    message: str,
    details: list | None = None,
    headers: dict[str, str] | None = None,
):
    body = ErrorResponse(error=ErrorBody(code=code, message=message, details=details or []))
    return JSONResponse(
        status_code=status_code, content=body.model_dump(mode="json"), headers=headers
    )


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def _api_error(_: Request, exc: ApiError):
        return _response(exc.status_code, exc.code, exc.message)

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_: Request, exc: RequestValidationError):
        details = [
            ErrorDetail(loc=[part for part in err["loc"]], msg=str(err["msg"]))
            for err in exc.errors()
        ]
        return _response(422, "validation_error", "The request is invalid.", details)

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(_: Request, exc: StarletteHTTPException):
        code = {401: "unauthorized", 403: "forbidden", 404: "not_found", 429: "rate_limited"}.get(
            exc.status_code, "http_error"
        )
        return _response(exc.status_code, code, str(exc.detail), headers=dict(exc.headers or {}))

    @app.exception_handler(Exception)
    async def _unexpected(_: Request, exc: Exception):
        logger.exception("Unhandled error", exc_info=exc)
        return _response(500, "internal_error", "Something went wrong on our side.")
