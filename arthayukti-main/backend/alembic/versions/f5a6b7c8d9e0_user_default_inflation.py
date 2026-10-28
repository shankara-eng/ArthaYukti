"""user_default_inflation

Revision ID: f5a6b7c8d9e0
Revises: e4f5a6b7c8d9
Create Date: 2026-10-26 10:00:00.000000

Adds the person's own default annual inflation assumption to users. Nullable and additive: existing accounts keep
NULL, which the API reports as the application's starting value, and no saved plan or calculation changes.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "f5a6b7c8d9e0"
down_revision: str | Sequence[str] | None = "e4f5a6b7c8d9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("users", sa.Column("default_inflation_annual", sa.Numeric(8, 6), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.drop_column("default_inflation_annual")
