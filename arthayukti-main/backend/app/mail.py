"""Password-reset delivery.

MAIL_BACKEND selects the transport:
  disabled  (default) nothing can be sent, so the reset flow reports itself unavailable
  smtp      sends through SMTP_HOST using the SMTP_* settings
  memory    keeps messages in `outbox` for automated tests only

The token is only ever placed in the message body. It is never logged or returned by the API.
"""

import smtplib
from email.message import EmailMessage

from app.config import settings

# Used by tests with MAIL_BACKEND=memory.
outbox: list[dict[str, str]] = []


class MailUnavailableError(RuntimeError):
    """No usable mail transport is configured."""


def mail_available() -> bool:
    if settings.MAIL_BACKEND == "memory":
        return True
    return settings.MAIL_BACKEND == "smtp" and bool(settings.SMTP_HOST)


def send_password_reset(to_email: str, token: str) -> None:
    link = f"{settings.FRONTEND_BASE_URL.rstrip('/')}/#/reset-password?token={token}"
    subject = "Reset your ArthaYukti password"
    body = (
        "Someone asked to reset the password for this account.\n\n"
        f"Open this link within {settings.PASSWORD_RESET_TTL_MINUTES} minutes:\n{link}\n\n"
        "If this was not you, ignore this message. Your password stays the same."
    )
    if settings.MAIL_BACKEND == "memory":
        outbox.append({"to": to_email, "subject": subject, "body": body, "token": token})
        return
    if not mail_available():
        raise MailUnavailableError("No mail transport is configured.")
    message = EmailMessage()
    message["From"] = settings.MAIL_FROM
    message["To"] = to_email
    message["Subject"] = subject
    message.set_content(body)
    with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=15) as smtp:
        smtp.starttls()
        if settings.SMTP_USERNAME:
            smtp.login(settings.SMTP_USERNAME, settings.SMTP_PASSWORD)
        smtp.send_message(message)
