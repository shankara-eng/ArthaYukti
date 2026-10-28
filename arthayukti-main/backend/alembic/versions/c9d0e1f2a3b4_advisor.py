"""advisor_analyses, advisor_scenarios, advisor_decisions

Revision ID: c9d0e1f2a3b4
Revises: b7c8d9e0f1a2
Create Date: 2026-10-30 10:00:00.000000

Adds the AI Financial Advisor's storage: one row per analysis (references and the result, not the key or the prompt),
one per isolated scenario result, and one per decision on a recommendation. New tables only: no existing table or row changes.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "c9d0e1f2a3b4"
down_revision: str | Sequence[str] | None = "b7c8d9e0f1a2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "advisor_analyses",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("plan_id", sa.String(length=36), nullable=False),
        sa.Column("snapshot_id", sa.String(length=40), nullable=False),
        sa.Column("snapshot_hash", sa.String(length=64), nullable=False),
        sa.Column("model_version", sa.String(length=40), nullable=False),
        sa.Column("prompt_version", sa.String(length=40), nullable=False),
        sa.Column("ai_used", sa.Boolean(), nullable=False),
        sa.Column("result_json", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_advisor_analyses_user_id", "advisor_analyses", ["user_id"])
    op.create_table(
        "advisor_scenarios",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("analysis_id", sa.String(length=36), nullable=False),
        sa.Column("snapshot_hash", sa.String(length=64), nullable=False),
        sa.Column("tool", sa.String(length=60), nullable=False),
        sa.Column("result_json", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["analysis_id"], ["advisor_analyses.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_advisor_scenarios_user_id", "advisor_scenarios", ["user_id"])
    op.create_index("ix_advisor_scenarios_analysis_id", "advisor_scenarios", ["analysis_id"])
    op.create_table(
        "advisor_decisions",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("analysis_id", sa.String(length=36), nullable=False),
        sa.Column("recommendation_id", sa.String(length=60), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("applied_changes_json", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["analysis_id"], ["advisor_analyses.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("analysis_id", "recommendation_id", name="uq_advisor_decision"),
    )
    op.create_index("ix_advisor_decisions_user_id", "advisor_decisions", ["user_id"])
    op.create_index("ix_advisor_decisions_analysis_id", "advisor_decisions", ["analysis_id"])


def downgrade() -> None:
    op.drop_index("ix_advisor_decisions_analysis_id", table_name="advisor_decisions")
    op.drop_index("ix_advisor_decisions_user_id", table_name="advisor_decisions")
    op.drop_table("advisor_decisions")
    op.drop_index("ix_advisor_scenarios_analysis_id", table_name="advisor_scenarios")
    op.drop_index("ix_advisor_scenarios_user_id", table_name="advisor_scenarios")
    op.drop_table("advisor_scenarios")
    op.drop_index("ix_advisor_analyses_user_id", table_name="advisor_analyses")
    op.drop_table("advisor_analyses")
