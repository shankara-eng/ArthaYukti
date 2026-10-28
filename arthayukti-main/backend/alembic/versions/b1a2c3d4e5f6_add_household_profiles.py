"""add_household_profiles

Revision ID: b1a2c3d4e5f6
Revises: ac496f5d4c54
Create Date: 2026-10-25 00:20:00.000000

Adds the household_profiles table for life-context, family dependants, and risk capacity indicator modelling.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b1a2c3d4e5f6"
down_revision: str | Sequence[str] | None = "ac496f5d4c54"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "household_profiles",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("primary_earner_age", sa.Integer(), nullable=True),
        sa.Column("household_type", sa.String(length=50), nullable=True),
        sa.Column("dependants_count", sa.Integer(), nullable=True),
        sa.Column("children_count", sa.Integer(), nullable=True),
        sa.Column("elderly_dependants_count", sa.Integer(), nullable=True),
        sa.Column("monthly_family_support", sa.Numeric(precision=20, scale=2), nullable=True),
        sa.Column("job_stability", sa.String(length=50), nullable=True),
        sa.Column("emergency_fund_months_target", sa.Integer(), nullable=True),
        sa.Column("dependants_details_json", sa.Text(), nullable=True),
        sa.Column("planned_events_json", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_household_profiles_user_id"),
        "household_profiles",
        ["user_id"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_household_profiles_user_id"), table_name="household_profiles")
    op.drop_table("household_profiles")
