"""employment_other

Revision ID: b7c8d9e0f1a2
Revises: a6b7c8d9e0f1
Create Date: 2026-10-26 14:00:00.000000

Adds the optional description a person gives when their employment status is "other". Nullable and additive.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "b7c8d9e0f1a2"
down_revision: str | Sequence[str] | None = "a6b7c8d9e0f1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("household_profiles", sa.Column("employment_other", sa.String(length=100), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("household_profiles") as batch:
        batch.drop_column("employment_other")
