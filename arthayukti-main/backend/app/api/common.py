from app.errors import ApiError, ErrorResponse

VALIDATION_RESPONSES = {
    422: {"model": ErrorResponse, "description": "The request is invalid."},
}

AUTH_RESPONSES = {
    401: {
        "model": ErrorResponse,
        "description": "Sign in required, or the token is missing, malformed or expired.",
    },
    404: {"model": ErrorResponse, "description": "No such record for this account."},
    429: {"model": ErrorResponse, "description": "Too many attempts. Try again later."},
    **VALIDATION_RESPONSES,
}

ERROR_RESPONSES = {
    **VALIDATION_RESPONSES,
    501: {"model": ErrorResponse, "description": "Not available yet in this milestone."},
}


def not_implemented(feature: str) -> ApiError:
    return ApiError(501, "not_implemented", f"{feature} is not available yet.")
