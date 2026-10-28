"""recovery_agreements

Revision ID: e4f5a6b7c8d9
Revises: d3e4f5a6b7c8
Create Date: 2026-10-25 12:00:00.000000

Adds the Plan B tables: recovery_agreements and their append-only recovery_agreement_versions.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "e4f5a6b7c8d9"
down_revision: str | Sequence[str] | None = "d3e4f5a6b7c8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "recovery_agreements",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.Column("current_version", sa.Integer(), nullable=False),
        sa.Column("client_token", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "name", name="uq_recovery_agreement_user_name"),
        sa.UniqueConstraint("user_id", "client_token", name="uq_recovery_agreement_user_token"),
    )
    op.create_index(
        op.f("ix_recovery_agreements_user_id"), "recovery_agreements", ["user_id"], unique=False
    )
    op.create_table(
        "recovery_agreement_versions",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("agreement_id", sa.String(length=36), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("draft_json", sa.Text(), nullable=False),
        sa.Column("change_note", sa.String(length=1000), nullable=False),
        sa.Column("selected_label", sa.String(length=80), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["agreement_id"], ["recovery_agreements.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("agreement_id", "version", name="uq_recovery_agreement_version"),
    )
    op.create_index(
        op.f("ix_recovery_agreement_versions_agreement_id"),
        "recovery_agreement_versions",
        ["agreement_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_recovery_agreement_versions_agreement_id"),
        table_name="recovery_agreement_versions",
    )
    op.drop_table("recovery_agreement_versions")
    op.drop_index(op.f("ix_recovery_agreements_user_id"), table_name="recovery_agreements")
    op.drop_table("recovery_agreements")
