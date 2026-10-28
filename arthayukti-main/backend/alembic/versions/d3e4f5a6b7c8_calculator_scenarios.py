"""calculator_scenarios

Revision ID: d3e4f5a6b7c8
Revises: c2d3e4f5a6b7
Create Date: 2026-10-25 06:00:00.000000

Adds the calculator_scenarios table: named investment-calculator states, one set per user.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "d3e4f5a6b7c8"
down_revision: str | Sequence[str] | None = "c2d3e4f5a6b7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "calculator_scenarios",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.Column("config_json", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "name", name="uq_calculator_scenario_user_name"),
    )
    op.create_index(
        op.f("ix_calculator_scenarios_user_id"), "calculator_scenarios", ["user_id"], unique=False
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_calculator_scenarios_user_id"), table_name="calculator_scenarios")
    op.drop_table("calculator_scenarios")
