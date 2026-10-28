"""expenditure_plans

Revision ID: a6b7c8d9e0f1
Revises: b8c9d0e1f2a3
Create Date: 2026-10-26 12:00:00.000000

Adds the Expenditure projection module: custom categories, per-person settings, global-rate changes, spending plans and
their scheduled changes. Purely additive; no existing table or row is touched.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "a6b7c8d9e0f1"
down_revision: str | Sequence[str] | None = "b8c9d0e1f2a3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "expenditure_categories",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(60), nullable=False),
        sa.Column("archived", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("user_id", "name", name="uq_expenditure_category_user_name"),
    )
    op.create_index("ix_expenditure_categories_user_id", "expenditure_categories", ["user_id"])

    op.create_table(
        "expenditure_settings",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True),
        sa.Column("base_inflation", sa.Numeric(8, 6), nullable=False),
        sa.Column("horizon_years", sa.Integer(), nullable=False),
        sa.Column("hidden_categories_json", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )

    op.create_table(
        "expenditure_rate_changes",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("effective_year", sa.Integer(), nullable=False),
        sa.Column("effective_month", sa.Integer(), nullable=False),
        sa.Column("rate", sa.Numeric(8, 6), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("user_id", "effective_year", "effective_month", name="uq_expenditure_rate_change"),
        sa.CheckConstraint("effective_month BETWEEN 1 AND 12", name="ck_rate_change_month"),
    )
    op.create_index("ix_expenditure_rate_changes_user_id", "expenditure_rate_changes", ["user_id"])

    op.create_table(
        "expenditure_plans",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("category_id", sa.String(36), sa.ForeignKey("expenditure_categories.id", ondelete="RESTRICT"), nullable=True),
        sa.Column("system_category", sa.String(40), nullable=True),
        sa.Column("name", sa.String(80), nullable=True),
        sa.Column("amount", sa.Numeric(20, 2), nullable=False),
        sa.Column("frequency", sa.String(10), nullable=False),
        sa.Column("duration_type", sa.String(20), nullable=False),
        sa.Column("start_year", sa.Integer(), nullable=False),
        sa.Column("start_month", sa.Integer(), nullable=True),
        sa.Column("end_year", sa.Integer(), nullable=True),
        sa.Column("end_month", sa.Integer(), nullable=True),
        sa.Column("inflation_override", sa.Numeric(8, 6), nullable=True),
        sa.Column("status", sa.String(10), nullable=False),
        sa.Column("resume_end_year", sa.Integer(), nullable=True),
        sa.Column("resume_end_month", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("amount > 0", name="ck_expenditure_plan_amount"),
        sa.CheckConstraint("frequency IN ('monthly','yearly')", name="ck_expenditure_plan_frequency"),
        sa.CheckConstraint("status IN ('active','stopped')", name="ck_expenditure_plan_status"),
        sa.CheckConstraint("duration_type IN ('today_forever','year_forever','range')", name="ck_expenditure_plan_duration"),
        sa.CheckConstraint("(category_id IS NULL) <> (system_category IS NULL)", name="ck_expenditure_plan_one_category"),
    )
    op.create_index("ix_expenditure_plans_user_id", "expenditure_plans", ["user_id"])
    op.create_index("ix_expenditure_plans_category_id", "expenditure_plans", ["category_id"])

    op.create_table(
        "expenditure_changes",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("plan_id", sa.String(36), sa.ForeignKey("expenditure_plans.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.String(10), nullable=False),
        sa.Column("effective_year", sa.Integer(), nullable=False),
        sa.Column("effective_month", sa.Integer(), nullable=True),
        sa.Column("end_year", sa.Integer(), nullable=True),
        sa.Column("end_month", sa.Integer(), nullable=True),
        sa.Column("amount", sa.Numeric(20, 2), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("amount > 0", name="ck_expenditure_change_amount"),
        sa.CheckConstraint("kind IN ('permanent','temporary')", name="ck_expenditure_change_kind"),
    )
    op.create_index("ix_expenditure_changes_plan_id", "expenditure_changes", ["plan_id"])


def downgrade() -> None:
    op.drop_table("expenditure_changes")
    op.drop_table("expenditure_plans")
    op.drop_table("expenditure_rate_changes")
    op.drop_table("expenditure_settings")
    op.drop_table("expenditure_categories")
